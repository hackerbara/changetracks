import { parseTimestamp, type DiscussionComment } from "@changedown/core";

export interface WordChangeDownCommentReply {
  author: string;
  date: string;
  label?: string;
  text: string;
}

export interface WordChangeDownCommentMetadata {
  cnId: string;
  author: string;
  reason?: string;
  replies: WordChangeDownCommentReply[];
}

const HEADER_BLOCK_RE = /^\\?\[changedown\s+(cn-[^\]\s]+)\]\s*$/u;
const HEADER_INLINE_RE = /^\\?\[changedown\s+(cn-[^\]\s]+)\][^\S\r\n]+Author:\s*([^\r\n]*?)(?:[^\S\r\n]+Reason:\s*([^\r\n]*))?$/u;
const AUTHOR_RE = /^Author:\s*(.*?)\s*$/u;
const REASON_RE = /^Reason:\s*([\s\S]*?)\s*$/u;
const DISCUSSION_RE = /^(@?\S+)\s+(\S+)(?:\s+\[([^\]]+)\])?:\s*([\s\S]*)$/u;

export function serializeWordChangeDownCommentMetadata(input: {
  cnId: string;
  author: string;
  reason?: string;
  replies?: readonly WordChangeDownCommentReply[];
}): string {
  const lines = [`[changedown ${input.cnId}]`, `Author: ${input.author}`];
  const reason = input.reason?.trim();
  if (reason) lines.push(`Reason: ${escapeMetadataField(reason)}`);
  for (const reply of input.replies ?? []) {
    const author = normalizeChangeDownAuthorHandle(reply.author);
    const label = reply.label ? ` [${reply.label}]` : "";
    lines.push(`${author} ${reply.date}${label}: ${escapeMetadataField(reply.text)}`);
  }
  return lines.join("\n");
}

export function parseWordChangeDownCommentMetadata(
  text: string | undefined
): WordChangeDownCommentMetadata | undefined {
  if (!text) return undefined;
  const normalized = text.trim().replace(/\\\[/u, "[");
  const inline = normalized.match(HEADER_INLINE_RE);
  if (inline) {
    const cnId = inline[1];
    const author = inline[2]?.trim();
    if (!cnId || !author) return undefined;
    const reason = inline[3] ? unescapeMetadataField(inline[3].trim()) : undefined;
    return {
      cnId,
      author,
      ...(reason ? { reason } : {}),
      replies: [],
    };
  }

  const lines = normalized
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const header = lines[0]?.match(HEADER_BLOCK_RE);
  if (!header?.[1]) return undefined;

  let author: string | undefined;
  let reason: string | undefined;
  const replies: WordChangeDownCommentReply[] = [];

  for (const line of lines.slice(1)) {
    const authorMatch = line.match(AUTHOR_RE);
    if (authorMatch) {
      author = authorMatch[1]?.trim();
      continue;
    }
    const reasonMatch = line.match(REASON_RE);
    if (reasonMatch) {
      reason = unescapeMetadataField(reasonMatch[1]?.trim() ?? "");
      continue;
    }
    const discussionMatch = line.match(DISCUSSION_RE);
    if (discussionMatch?.[1] && discussionMatch[2]) {
      replies.push({
        author: discussionMatch[1],
        date: discussionMatch[2],
        ...(discussionMatch[3] ? { label: discussionMatch[3] } : {}),
        text: unescapeMetadataField(discussionMatch[4] ?? ""),
      });
      continue;
    }
    if (reason !== undefined) {
      reason = `${reason}\n${unescapeMetadataField(line)}`;
    }
  }

  if (!author) return undefined;
  return {
    cnId: header[1],
    author,
    ...(reason ? { reason } : {}),
    replies,
  };
}

export function isChangedownCompareCommentMetadataText(text: string | undefined): boolean {
  return parseWordChangeDownCommentMetadata(text) !== undefined;
}

export function normalizeChangeDownAuthorHandle(author: string): string {
  const trimmed = author.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function toChangeDownDiscussion(
  metadata: WordChangeDownCommentMetadata,
  fallbackDate: string
): DiscussionComment[] {
  const discussion: DiscussionComment[] = [];
  if (metadata.reason?.trim()) {
    discussion.push({
      author: normalizeChangeDownAuthorHandle(metadata.author),
      date: fallbackDate,
      timestamp: parseTimestamp(fallbackDate),
      label: "reason",
      text: metadata.reason.trim(),
      depth: 0,
    });
  }
  for (const reply of metadata.replies) {
    discussion.push({
      author: normalizeChangeDownAuthorHandle(reply.author),
      date: reply.date,
      timestamp: parseTimestamp(reply.date),
      ...(reply.label ? { label: reply.label } : {}),
      text: reply.text,
      depth: 0,
    });
  }
  return discussion;
}

function escapeMetadataField(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/\r?\n/gu, "\\n");
}

function unescapeMetadataField(value: string): string {
  return value.replace(/\\(\\|n)/gu, (_match, escaped: string) =>
    escaped === "n" ? "\n" : "\\"
  );
}
