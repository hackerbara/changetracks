import { parseForFormat } from '@changedown/core';
import type { ChangeDownConfig } from '../config.js';
import type { SessionState } from '../state.js';
import { resolveAuthor } from '../author.js';
import { applyProposeChange } from '../file-ops.js';
import { optionalStrArg, strArg } from '../args.js';
import { computeAffectedLines, type AffectedLineEntry } from './propose-utils.js';
import { settleOnDemandIfNeeded } from './settle-on-demand.js';

export interface ProposeChangeResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface PrepareClassicProposeInput {
  args: Record<string, unknown>;
  filePath: string;
  relativePath: string;
  fileContent: string;
  config: ChangeDownConfig;
  state: SessionState;
  allowSettleOnDemand?: boolean;
}

export interface PreparedClassicPropose {
  ok: true;
  changeId: string;
  author: string;
  reasoning?: string;
  oldL2: string;
  newL2: string;
  responseData: Record<string, unknown>;
  toolResult: ProposeChangeResult;
  changeType: 'ins' | 'del' | 'sub' | 'highlight' | 'comment';
}

export type PrepareClassicProposeResult =
  | PreparedClassicPropose
  | { ok: false; toolResult: ProposeChangeResult };

function fail(message: string, code = 'VALIDATION_ERROR', details?: Record<string, unknown>): PrepareClassicProposeResult {
  const content: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: message }];
  content.push({ type: 'text', text: JSON.stringify({ error: { message, code, ...(details ?? {}) } }) });
  return { ok: false, toolResult: { content, isError: true } };
}

function documentState(modifiedText: string): Record<string, unknown> {
  const footnoteCount = (modifiedText.match(/^\[\^cn-\d+(?:\.\d+)?\]:/gm) || []).length;
  const proposedCount = (modifiedText.match(/\|\s*proposed\s*$/gm) || []).length;
  const acceptedCount = (modifiedText.match(/\|\s*accepted\s*$/gm) || []).length;
  const authorMatches = modifiedText.match(/^\[\^cn-\d+(?:\.\d+)?\]:\s*@([^\s|]+)/gm) || [];
  const uniqueAuthors = new Set(authorMatches.map((m) => m.match(/@([^\s|]+)/)?.[1]).filter(Boolean));
  return {
    total_changes: footnoteCount,
    proposed: proposedCount,
    accepted: acceptedCount,
    authors: uniqueAuthors.size,
  };
}

function normalizeSingleClassicChange(args: Record<string, unknown>): Record<string, unknown> | PrepareClassicProposeResult {
  const changes = args.changes;
  if (!Array.isArray(changes)) return args;
  if (changes.length !== 1) {
    return fail('word:// currently accepts one proposal per call; split multi-change arrays into separate calls.', 'WORD_MULTI_CHANGE_UNSUPPORTED');
  }
  const change = changes[0] as Record<string, unknown>;
  return {
    file: args.file,
    author: args.author,
    reason: change.reason ?? args.reason,
    level: args.level,
    old_text: change.old_text,
    new_text: change.new_text,
    insert_after: change.insert_after ?? change.after_text,
  };
}

function hasOnlyFootnoteRefDifference(oldText: string, newText: string): boolean {
  const strippedOld = oldText.replace(/\[\^?cn-\d+(?:\.\d+)?\]/g, '').trim();
  const strippedNew = newText.replace(/\[\^?cn-\d+(?:\.\d+)?\]/g, '').trim();
  return strippedOld === strippedNew;
}

export async function prepareClassicProposeChange(
  input: PrepareClassicProposeInput,
): Promise<PrepareClassicProposeResult> {
  const normalized = normalizeSingleClassicChange(input.args);
  if ((normalized as PrepareClassicProposeResult).ok === false) {
    return normalized as PrepareClassicProposeResult;
  }

  const args = normalized as Record<string, unknown>;
  if (typeof args.at === 'string' || typeof args.op === 'string') {
    return fail('Mixed proposal families are not supported: use either old_text/new_text or at/op, not both.', 'MIXED_PROPOSAL_FAMILY');
  }

  const oldText = strArg(args, 'old_text', 'oldText');
  const newText = strArg(args, 'new_text', 'newText');
  const insertAfter = optionalStrArg(args, 'insert_after', 'insertAfter');
  const reasoning = args.reason as string | undefined;
  const level = (args.level as 1 | 2 | undefined) ?? 2;

  if (oldText === '' && newText === '') {
    return fail('Both old_text and new_text are empty — nothing to change.', 'VALIDATION_ERROR');
  }
  if (oldText && newText && hasOnlyFootnoteRefDifference(oldText, newText)) {
    return fail('No prose changes detected (only footnote references differ). Use review_changes to manage change history.', 'VALIDATION_ERROR');
  }

  const { author, error: authorError } = resolveAuthor(args.author as string | undefined, input.config, 'propose_change');
  if (authorError) return fail(authorError.message, 'AUTHOR_RESOLUTION_FAILED');
  if (input.config.protocol.reasoning === 'required' && !reasoning) {
    return fail('This project requires reasoning on proposals. Include a reason parameter in your propose_change call.', 'REASONING_REQUIRED');
  }

  try {
    parseForFormat(input.fileContent, { skipCodeBlocks: false });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 'PARSE_FAILED');
  }

  const changeId = input.state.getNextId(input.filePath, input.fileContent);
  let baseText = input.fileContent;
  if (oldText && !insertAfter) {
    const settleResult = settleOnDemandIfNeeded(baseText, oldText);
    if (settleResult.settled) {
      if (input.allowSettleOnDemand === false) {
        return fail(
          'This proposal would require settling accepted/rejected changes before applying the new proposal; word:// classic preparation requires an exact current-source match.',
          'SETTLE_ON_DEMAND_UNSUPPORTED',
        );
      }
      baseText = settleResult.content;
    }
  }

  try {
    const applied = await applyProposeChange({
      text: baseText,
      oldText,
      newText,
      changeId,
      author: author!,
      reasoning,
      insertAfter,
      level,
    });
    let affectedLines: AffectedLineEntry[] = [];
    try {
      affectedLines = computeAffectedLines(applied.modifiedText, 1, applied.modifiedText.split('\n').length, {
        hashlineEnabled: input.config.hashline.enabled,
      });
    } catch {
      affectedLines = [];
    }
    const responseData: Record<string, unknown> = {
      change_id: changeId,
      file: input.relativePath,
      type: applied.changeType,
      document_state: documentState(applied.modifiedText),
    };
    if (affectedLines.length > 0 && input.config.response?.affected_lines) responseData.affected_lines = affectedLines;
    const ds = responseData.document_state as { total_changes: number; proposed: number; accepted: number; authors: number };
    responseData.state_summary = `📋 ${ds.total_changes} tracked change(s) | ${ds.proposed} proposed, ${ds.accepted} accepted | ${ds.authors} author(s)`;
    return {
      ok: true,
      changeId,
      author: author!,
      reasoning,
      oldL2: input.fileContent,
      newL2: applied.modifiedText,
      responseData,
      toolResult: { content: [{ type: 'text', text: JSON.stringify(responseData) }] },
      changeType: applied.changeType,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 'CLASSIC_PROPOSE_FAILED', { file: input.relativePath });
  }
}
