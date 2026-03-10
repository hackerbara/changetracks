import { findFootnoteBlock, findDiscussionInsertionIndex } from '../footnote-utils.js';
import { nowTimestamp } from '../timestamp.js';

export interface ReplyOptions {
  text: string;
  author: string;
  label?: string;
  date?: string;  // Defaults to nowTimestamp().raw
}

export type ReplyResult =
  | { isError: false; text: string }
  | { isError: true; error: string };

/**
 * Pure computation: formats a discussion reply and inserts it into the
 * correct position within a footnote block.
 *
 * Mirrors the logic from `respond-to-thread.ts#formatResponseLines`:
 * - 4-space indent for the first line: `    @author date [label]: text`
 * - 6-space indent for continuation lines: `      text`
 *
 * The reply is inserted after existing metadata and discussion entries,
 * but before approval/resolution lines.
 *
 * Returns the full document text with the reply inserted, or an error
 * if the footnote block is not found.
 */
export function computeReplyEdit(
  docText: string,
  changeId: string,
  opts: ReplyOptions
): ReplyResult {
  const lines = docText.split('\n');
  const block = findFootnoteBlock(lines, changeId);
  if (!block) {
    return { isError: true, error: `Footnote not found for ${changeId}` };
  }

  const date = opts.date ?? nowTimestamp().raw;
  const labelPart = opts.label ? ` [${opts.label}]` : '';
  const replyLines = opts.text.split('\n');

  // 4-space indent for first line, 6-space indent for continuation
  const indent = '    ';
  const continuationIndent = '      ';

  const firstLine = `${indent}@${opts.author} ${date}${labelPart}: ${replyLines[0]}`;
  const continuationLines = replyLines.slice(1).map(l => `${continuationIndent}${l}`);
  const newLines = [firstLine, ...continuationLines];

  const insertIndex = findDiscussionInsertionIndex(lines, block.headerLine, block.blockEnd) + 1;
  lines.splice(insertIndex, 0, ...newLines);

  return { isError: false, text: lines.join('\n') };
}
