export interface AcceptedHistoryCoherenceRecord {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly markdown?: string;
}

export interface AcceptedHistoryCoherenceInput {
  readonly currentBody: string;
  readonly records: readonly AcceptedHistoryCoherenceRecord[];
}

export interface AcceptedHistoryCoherenceResult {
  ok: boolean;
  body0: string;
  diagnostics: string[];
}

interface ReplayStep {
  readonly record: AcceptedHistoryCoherenceRecord;
  readonly markdown: string;
  readonly index: number | null;
}

export function verifyAcceptedHistoryCoherence(
  input: AcceptedHistoryCoherenceInput
): AcceptedHistoryCoherenceResult {
  const diagnostics: string[] = [];
  const currentBody = normalizeBody(input.currentBody);
  const acceptedRecords = input.records.filter(
    (record) => record.status === "accepted"
  );
  const replaySteps: ReplayStep[] = [];
  let scrubbedBody = currentBody;

  for (let i = acceptedRecords.length - 1; i >= 0; i--) {
    const record = acceptedRecords[i]!;
    const markdown = getRecordMarkdown(record);
    if (markdown === undefined) {
      diagnostics.push(
        `${record.id}: accepted history record is missing markdown for replay`
      );
      continue;
    }

    if (isMalformedGenesisRecord(record)) {
      diagnostics.push(
        `${record.id}: accepted genesis record requires source initial-word-body and document scope`
      );
      continue;
    }

    if (isGenesisRecord(record)) {
      if (scrubbedBody !== markdown) {
        diagnostics.push(
          `${record.id}: accepted genesis markdown does not match scrubbed body`
        );
        continue;
      }
      scrubbedBody = "";
      replaySteps.unshift({ record, markdown, index: null });
      continue;
    }

    if (record.type !== "ins") {
      diagnostics.push(
        `${record.id}: unsupported accepted history type ${JSON.stringify(
          record.type
        )}`
      );
      continue;
    }

    const index = scrubbedBody.lastIndexOf(markdown);
    if (index < 0) {
      diagnostics.push(
        `${record.id}: accepted insertion markdown was not found in current body`
      );
      continue;
    }

    scrubbedBody =
      scrubbedBody.slice(0, index) +
      scrubbedBody.slice(index + markdown.length);
    replaySteps.unshift({ record, markdown, index });
  }

  let replayedBody = scrubbedBody;
  for (const step of replaySteps) {
    if (isGenesisRecord(step.record)) {
      replayedBody = step.markdown;
      continue;
    }

    const index = step.index ?? replayedBody.length;
    if (index < 0 || index > replayedBody.length) {
      diagnostics.push(
        `${step.record.id}: replay index ${index} is outside body bounds`
      );
      continue;
    }
    replayedBody =
      replayedBody.slice(0, index) + step.markdown + replayedBody.slice(index);
  }

  if (replayedBody !== currentBody) {
    diagnostics.push("accepted history replay did not reproduce current body");
  }

  return {
    ok: diagnostics.length === 0,
    body0: scrubbedBody,
    diagnostics,
  };
}

function isGenesisRecord(record: AcceptedHistoryCoherenceRecord): boolean {
  return (
    record.id === "cn-1" &&
    record.type === "ins" &&
    record.status === "accepted" &&
    record.metadata?.source === "initial-word-body" &&
    record.metadata?.scope === "document"
  );
}

function isMalformedGenesisRecord(
  record: AcceptedHistoryCoherenceRecord
): boolean {
  const isGenesisCandidate =
    record.id === "cn-1" || record.metadata?.source === "initial-word-body";
  return isGenesisCandidate && !isGenesisRecord(record);
}

function getRecordMarkdown(
  record: AcceptedHistoryCoherenceRecord
): string | undefined {
  return typeof record.markdown === "string"
    ? normalizeBody(record.markdown)
    : undefined;
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n?/gu, "\n");
}
