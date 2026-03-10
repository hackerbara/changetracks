/**
 * Level descent (compaction): L2 → L1 (footnote to adjacent comment), L1 → L0 (remove adjacent comment).
 */
import { CriticMarkupParser } from '../parser/parser.js';
import { findFootnoteBlock, parseFootnoteHeader } from '../footnote-utils.js';

/**
 * Finds the footnote definition block for changeId and returns the header fields
 * plus byte-offset range [start, end] in text. Wraps the canonical findFootnoteBlock
 * and parseFootnoteHeader from footnote-utils.
 */
function findFootnoteBlockWithOffsets(
  text: string,
  changeId: string,
): { author: string; date: string; type: string; status: string; start: number; end: number } | null {
  const lines = text.split('\n');
  const block = findFootnoteBlock(lines, changeId);
  if (!block) return null;

  const header = parseFootnoteHeader(block.headerContent);

  // Compute byte offsets from line indices
  let start = 0;
  for (let i = 0; i < block.headerLine; i++) {
    start += lines[i].length + 1; // +1 for \n
  }
  let end = start + lines[block.headerLine].length;
  for (let j = block.headerLine + 1; j <= block.blockEnd; j++) {
    end += 1 + lines[j].length; // +1 for \n before this line
  }

  return {
    author: header?.author ? `@${header.author}` : '',
    date: header?.date ?? '',
    type: header?.type ?? '',
    status: header?.status ?? '',
    start,
    end,
  };
}

/**
 * Compacts the change with the given footnote id from Level 2 to Level 1:
 * removes the footnote ref and definition, inserts an adjacent comment with the header fields.
 */
export function compactToLevel1(text: string, changeId: string): string {
  const parser = new CriticMarkupParser();
  const doc = parser.parse(text);
  const changes = doc.getChanges();
  const change = changes.find((c) => c.id === changeId);
  if (!change) return text;
  const refStr = `[^${changeId}]`;
  const refIndex = text.indexOf(refStr, change.range.start);
  if (refIndex === -1) return text;
  const block = findFootnoteBlockWithOffsets(text, changeId);
  if (!block) return text;
  const authorPart = block.author ? `${block.author}|` : '';
  const comment = `{>>${authorPart}${block.date}|${block.type}|${block.status}<<}`;

  // Safety guard: check if there is non-whitespace content between ref and footnote block.
  // The old code did `beforeRef + comment + afterBlock` which discards everything in between.
  const refEnd = refIndex + refStr.length;
  const textBetween = text.slice(refEnd, block.start);
  if (textBetween.trim().length > 0) {
    // Content exists between ref and footnote — handle separately to preserve it.
    // Remove footnote block first (comes later in text, so offsets stay valid).
    let result = text.slice(0, block.start) + text.slice(block.end);
    // Then replace the ref with the inline comment.
    result = result.slice(0, refIndex) + comment + result.slice(refIndex + refStr.length);
    return result;
  }

  // No content between ref and footnote — safe to concatenate directly
  const beforeRef = text.slice(0, refIndex);
  const afterBlock = text.slice(block.end);
  return beforeRef + comment + afterBlock;
}

/**
 * Compacts the change at changeIndex from Level 1 to Level 0 by removing its adjacent comment.
 */
export function compactToLevel0(text: string, changeIndex: number): string {
  const parser = new CriticMarkupParser();
  const doc = parser.parse(text);
  const changes = doc.getChanges();
  if (changeIndex < 0 || changeIndex >= changes.length) return text;
  const change = changes[changeIndex];
  if (change.level !== 1) return text;
  // The metadata comment is the last {>>...<<} block in the change range,
  // ending at change.range.end.  Search backwards from the end to find
  // the correct {>> opening — avoids accidentally removing a user-facing
  // comment that precedes the metadata comment (e.g. on highlights).
  const closeTag = '<<}';
  const openTag = '{>>';
  const commentCloseEnd = change.range.end;
  const commentCloseStart = commentCloseEnd - closeTag.length;
  if (text.substring(commentCloseStart, commentCloseEnd) !== closeTag) return text;
  const commentOpenStart = text.lastIndexOf(openTag, commentCloseStart - 1);
  if (commentOpenStart === -1 || commentOpenStart < change.range.start) return text;
  return text.slice(0, commentOpenStart) + text.slice(commentCloseEnd);
}
