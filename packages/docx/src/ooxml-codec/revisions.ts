import type { OoxmlEvent } from "./index.js";

export interface ChangeDownRecord {
  readonly id: string;
  readonly author: string;
  readonly date: string;
  readonly type: string;
  readonly status: string;
  readonly reviewable: boolean;
  readonly metadata: Readonly<Record<string, string>>;
  readonly bodyLines: readonly string[];
}

export interface OoxmlProjectedRevision {
  readonly type: "ins" | "del";
  readonly text: string;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly author?: string;
  readonly date?: string;
}

export interface OoxmlRevisionProjection {
  readonly body: string;
  readonly revisions: readonly OoxmlProjectedRevision[];
  readonly records: readonly ChangeDownRecord[];
}

interface ActiveRevision {
  type: "ins" | "del";
  author?: string;
  date?: string;
  start: number;
  text: string;
}

export function projectOoxmlRevisionsToCurrentBody(
  events: readonly OoxmlEvent[]
): OoxmlRevisionProjection {
  let body = "";
  const stack: ActiveRevision[] = [];
  const revisions: OoxmlProjectedRevision[] = [];

  for (const event of events) {
    if (event.kind === "revisionStart") {
      stack.push({
        type: event.type,
        author: event.author,
        date: event.date,
        start: body.length,
        text: "",
      });
      continue;
    }

    if (event.kind === "text") {
      const active = stack[stack.length - 1];
      if (active) {
        active.text += event.text;
      }
      if (!active || active.type === "ins") {
        body += event.text;
      }
      continue;
    }

    if (event.kind === "revisionEnd") {
      const active = stack.pop();
      if (!active) {
        continue;
      }
      revisions.push({
        type: active.type,
        text: active.text,
        bodyStart: active.start,
        bodyEnd:
          active.type === "ins"
            ? active.start + active.text.length
            : active.start,
        author: active.author,
        date: active.date,
      });
    }
  }

  return {
    body,
    revisions,
    records: revisions.map((revision, index) => revisionToRecord(revision, index)),
  };
}

function revisionToRecord(
  revision: OoxmlProjectedRevision,
  index: number
): ChangeDownRecord {
  return {
    id: `cn-${index + 1}`,
    author: normalizeAuthor(revision.author),
    date: revision.date ?? "undated",
    type: revision.type,
    status: "proposed",
    reviewable: true,
    metadata: {
      source: "semantic-word-revision",
      "body-start": String(revision.bodyStart),
      "body-end": String(revision.bodyEnd),
    },
    bodyLines: revision.text ? [revision.text] : [],
  };
}

function normalizeAuthor(author: string | undefined): string {
  if (!author) {
    return "@unknown";
  }
  return author.startsWith("@") ? author : `@${author}`;
}
