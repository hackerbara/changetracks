import type { DocumentBackend } from '@changedown/core/backend';

export interface WordReviewOperation {
  changeId: string;
  decision: 'approve' | 'reject' | 'request_changes' | 'withdraw';
  reason?: string;
  blocking?: boolean;
  label?: string;
}

export interface PreparedWordReviewChanges {
  ok: true;
  operations: WordReviewOperation[];
}

export interface WordReviewValidationError {
  ok: false;
  message: string;
}

const VALID_DECISIONS = new Set(['approve', 'reject', 'request_changes', 'withdraw']);

function parseMaybeJsonArray(value: unknown, name: string): unknown[] | WordReviewValidationError | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') {
    return { ok: false, message: `Word review_changes expected "${name}" to be an array.` };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return { ok: false, message: `Word review_changes "${name}" JSON parsed to ${typeof parsed}, not an array.` };
    }
    return parsed;
  } catch {
    return { ok: false, message: `Word review_changes "${name}" was a string but not valid JSON.` };
  }
}

export function prepareWordReviewChanges(args: Record<string, unknown>): PreparedWordReviewChanges | WordReviewValidationError {
  const responses = parseMaybeJsonArray(args.responses, 'responses');
  if (responses && 'ok' in responses) return responses;
  if (responses && responses.length > 0) {
    return { ok: false, message: 'Word review_changes does not support thread responses yet; use the single approve/reject review path only.' };
  }
  if (args.settle === true || args.settle === 'true') {
    return { ok: false, message: 'Word review_changes does not support settle yet; approve/reject mutates native Word tracked changes directly.' };
  }

  const reviews = parseMaybeJsonArray(args.reviews, 'reviews');
  if (!reviews || ('ok' in reviews)) {
    return reviews && 'ok' in reviews ? reviews : { ok: false, message: 'Word review_changes requires exactly one review item.' };
  }
  if (reviews.length !== 1) {
    return { ok: false, message: `Word review_changes basic path supports exactly one review item, got ${reviews.length}.` };
  }

  const operations: WordReviewOperation[] = [];
  for (let idx = 0; idx < reviews.length; idx++) {
    const item = reviews[idx];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, message: `Word review_changes review item #${idx} must be an object.` };
    }
    const review = item as Record<string, unknown>;
    const changeId = typeof review.change_id === 'string' ? review.change_id : undefined;
    const decision = typeof review.decision === 'string' ? review.decision : undefined;
    const reason = typeof review.reason === 'string' ? review.reason : undefined;
    if (!changeId || !decision || !reason) {
      return { ok: false, message: `Word review_changes review item #${idx} requires change_id, decision, and reason.` };
    }
    if (!VALID_DECISIONS.has(decision)) {
      return { ok: false, message: `Word review_changes review item #${idx} has invalid decision "${decision}".` };
    }
    if (decision !== 'approve' && decision !== 'reject') {
      return { ok: false, message: `Word review_changes basic path supports approve/reject only, got "${decision}".` };
    }
    operations.push({
      changeId,
      decision: decision as WordReviewOperation['decision'],
      reason,
      blocking: review.blocking === true ? true : undefined,
      label: typeof review.label === 'string' ? review.label : undefined,
    });
  }

  return { ok: true, operations };
}

export async function applyWordReviewChanges(args: Record<string, unknown>, backend: DocumentBackend, uri: string): Promise<Record<string, unknown>> {
  const prepared = prepareWordReviewChanges(args);
  if (!prepared.ok) throw new Error(prepared.message);

  const author = typeof args.author === 'string' ? args.author : undefined;
  const results: Array<{ change_id: string; decision: string; status_updated: boolean; reason?: string }> = [];

  for (const op of prepared.operations) {
    const result = await backend.applyChange({ uri }, {
      kind: 'review',
      args: {
        cnId: op.changeId,
        decision: op.decision,
        reason: op.reason,
        author,
        blocking: op.blocking,
        label: op.label,
      },
    });
    if (result.applied === false) {
      throw new Error(result.text ?? `Word review_changes did not apply ${op.changeId}`);
    }
    results.push({
      change_id: op.changeId,
      decision: op.decision,
      status_updated: true,
    });
  }

  const remaining = (await backend.listChanges({ uri }, { status: 'proposed' })).filter((c) => c.status === 'proposed' || c.status === 'Proposed').length;
  return {
    file: uri,
    results,
    document_state: {
      remaining_proposed: remaining,
      all_resolved: remaining === 0,
    },
    ...(remaining === 0 ? { note: 'All changes in this Word session are now resolved. No proposed changes remain.' } : {}),
  };
}
