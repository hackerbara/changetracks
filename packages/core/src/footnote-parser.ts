/**
 * Lightweight footnote parser for metadata extraction.
 *
 * Parses `[^ct-N]: @author | date | type | status` header lines and their
 * indented continuation lines (metadata key-value pairs and thread replies).
 *
 * This serves a different purpose from CriticMarkupParser.parseFootnoteDefinitions()
 * which builds a full AST FootnoteDefinition. This module provides lightweight
 * FootnoteInfo records with line positions, suitable for meta-rendering and
 * committed-view computation.
 */

/**
 * Parsed footnote definition.
 * Extracted from `[^ct-N]: @author | date | type | status` header lines
 * plus indented metadata and thread reply lines.
 */
import { FOOTNOTE_DEF_LENIENT, FOOTNOTE_DEF_START, FOOTNOTE_CONTINUATION } from './footnote-patterns.js';
import { parseTimestamp, type Timestamp } from './timestamp.js';

export interface FootnoteInfo {
  id: string;             // e.g. "ct-1", "ct-2.3"
  author: string;         // e.g. "@alice", "@ai:claude-opus-4.6"
  /** @deprecated Use timestamp.date */
  date: string;           // e.g. "2026-02-17"
  timestamp: Timestamp;   // parsed timestamp from the footnote header
  type: 'ins' | 'del' | 'sub' | 'comment' | 'highlight' | 'image' | string;  // e.g. "sub", "ins", "image"
  status: string;         // e.g. "proposed", "accepted", "rejected"
  reason: string;         // the "reason: ..." value, or empty
  replyCount: number;     // number of thread reply lines
  /** First line index (0-based) of this footnote definition */
  startLine: number;
  /** Last line index (0-based, inclusive) of this footnote definition */
  endLine: number;
  /** Image dimensions from import, format: { widthIn, heightIn } in inches */
  imageDimensions?: { widthIn: number; heightIn: number };
}

/**
 * Regex matching a thread reply line (indented, starts with @author date:).
 * e.g. `    @bob 2026-02-17: I think 1000 is correct`
 */
const RE_THREAD_REPLY = /^\s+@\S+\s+\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?Z?)?:/;

/**
 * Regex matching a footnote metadata line (indented, key: value).
 * e.g. `    reason: spelling fix`
 */
const RE_FOOTNOTE_META = /^\s+([\w-]+):\s*(.*)/;

/**
 * Parse all footnote definitions from file content.
 * Returns a Map keyed by the footnote ID (e.g. "ct-1").
 */
export function parseFootnotes(content: string): Map<string, FootnoteInfo> {
  const lines = content.split('\n');
  const footnotes = new Map<string, FootnoteInfo>();

  const blockStart = findFootnoteBlockStart(lines);
  for (let i = blockStart; i < lines.length; i++) {
    const match = lines[i].match(FOOTNOTE_DEF_LENIENT);
    if (!match) continue;

    const info: FootnoteInfo = {
      id: match[1],
      author: `@${match[2]}`,
      date: match[3],
      timestamp: parseTimestamp(match[3]),
      type: match[4],
      status: match[5],
      reason: '',
      replyCount: 0,
      startLine: i,
      endLine: i,
    };

    // Scan indented continuation lines
    let j = i + 1;
    while (j < lines.length && (lines[j].match(/^\s+\S/) || lines[j].match(/^\s*$/))) {
      // Skip blank lines that are followed by more indented content of the same footnote
      if (lines[j].match(/^\s*$/)) {
        // Check if the next non-blank line is still indented (part of this footnote)
        let k = j + 1;
        while (k < lines.length && lines[k].match(/^\s*$/)) k++;
        if (k < lines.length && lines[k].match(/^\s+\S/)) {
          j++;
          continue;
        }
        break;
      }

      if (RE_THREAD_REPLY.test(lines[j])) {
        info.replyCount++;
      } else {
        const metaMatch = lines[j].match(RE_FOOTNOTE_META);
        if (metaMatch && metaMatch[1] === 'reason') {
          info.reason = metaMatch[2];
        } else if (metaMatch && metaMatch[1] === 'image-dimensions') {
          const dimMatch = metaMatch[2].match(/^([\d.]+)in\s*x\s*([\d.]+)in$/);
          if (dimMatch) {
            info.imageDimensions = {
              widthIn: parseFloat(dimMatch[1]),
              heightIn: parseFloat(dimMatch[2]),
            };
          }
        }
      }
      info.endLine = j;
      j++;
    }

    footnotes.set(info.id, info);
  }

  return footnotes;
}

/**
 * Find the 0-based line index where the terminal footnote block starts.
 * Returns `lines.length` if no footnote definitions exist.
 *
 * Uses a backward scan from end-of-file, exploiting the structural invariant
 * that real footnotes are always a contiguous block at the end. This avoids
 * false positives from [^ct- patterns inside code blocks, CriticMarkup, or
 * literal body text.
 *
 * Uses FOOTNOTE_DEF_START (matches `[^ct-N]:` at column 0) rather than
 * FOOTNOTE_DEF_LENIENT for resilience against malformed trailing footnotes.
 */
export function findFootnoteBlockStart(lines: string[]): number {

  // Phase 1: Find the last footnote definition (scanning backward)
  let lastDefIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FOOTNOTE_DEF_START.test(lines[i])) {
      lastDefIdx = i;
      break;
    }
  }

  if (lastDefIdx === -1) {
    return lines.length; // No footnotes
  }

  // Phase 1b: Verify the block containing lastDefIdx is truly terminal.
  // Walk forward from lastDefIdx through footnote defs, continuations, and
  // blank lines. If we encounter non-blank, non-footnote body content before
  // reaching EOF, this "footnote" is inside body text (e.g. a code fence) and
  // we must scan backward for the next candidate.
  let candidate = lastDefIdx;
  while (candidate >= 0) {
    let j = candidate + 1;
    let isTerminal = true;
    while (j < lines.length) {
      const line = lines[j];
      if (FOOTNOTE_DEF_START.test(line) || FOOTNOTE_CONTINUATION.test(line)) {
        j++;
      } else if (line.trim() === '') {
        j++;
      } else {
        isTerminal = false;
        break;
      }
    }
    if (isTerminal) {
      lastDefIdx = candidate;
      break;
    }
    // Not terminal — scan backward for the next candidate
    candidate--;
    while (candidate >= 0 && !FOOTNOTE_DEF_START.test(lines[candidate])) {
      candidate--;
    }
  }

  if (candidate < 0) {
    return lines.length; // No terminal footnote block
  }

  // Phase 2: Scan backward from lastDefIdx through the contiguous block.
  // Blank lines are included only if a footnote def or continuation appears before them.
  let blockStart = lastDefIdx;
  for (let i = lastDefIdx - 1; i >= 0; i--) {
    const line = lines[i];
    if (FOOTNOTE_DEF_START.test(line) || FOOTNOTE_CONTINUATION.test(line)) {
      blockStart = i;
    } else if (line.trim() === '') {
      // Include this blank only if there is a footnote def or continuation before it
      let hasFootnoteBefore = false;
      for (let k = i - 1; k >= 0; k--) {
        if (lines[k].trim() === '') continue;
        if (FOOTNOTE_DEF_START.test(lines[k]) || FOOTNOTE_CONTINUATION.test(lines[k])) {
          hasFootnoteBefore = true;
        }
        break;
      }
      if (hasFootnoteBefore) {
        blockStart = i;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return blockStart;
}
