/**
 * findMarkupRangeById — two-pass forward-scan for CriticMarkup by change ID.
 *
 * Locates the CriticMarkup span (open + matching close) whose close is
 * immediately followed by `[^changeId]`. Returns the byte range of the full
 * construct (open .. close + ref pattern) plus the markup kind.
 *
 * The forward stack-based scan correctly handles multi-type nesting:
 *   {~~outer{++middle~~}[^cn-2]++}[^cn-1]
 * A backward-only scan would misidentify cn-1's open here because the first
 * `~~}` encountered going backward belongs to cn-2, not cn-1.
 *
 * Per spec §3.3 / Tranche 8 Task 8.1.
 */

import { buildCodeZoneMask } from '../parser/code-zones.js';

export type MarkupKind = 'sub' | 'ins' | 'del' | 'highlight' | 'comment';

export interface MarkupRangeById {
  start: number;
  end: number;
  type: MarkupKind;
}

interface PairEntry {
  kind: MarkupKind;
  open: number;  // offset of first char of open delimiter
  close: number; // offset of first char of close delimiter (3 chars)
}

const OPEN_KINDS: Record<string, MarkupKind> = {
  '{~~': 'sub',
  '{++': 'ins',
  '{--': 'del',
  '{==': 'highlight',
  '{>>': 'comment',
};

const CLOSE_KINDS: Record<string, MarkupKind> = {
  '~~}': 'sub',
  '++}': 'ins',
  '--}': 'del',
  '==}': 'highlight',
  '<<}': 'comment',
};

// Characters that can start a close delimiter (first char).
const CLOSE_FIRST = new Set(['+', '-', '~', '=', '<']);

/**
 * Scans `text` forward with a kind-aware stack. Returns all matched
 * open+close pairs in document order (paired by kind).
 *
 * Stack discipline:
 * - Push on any open delimiter (regardless of stack depth).
 * - On a close delimiter: if the TOP of the stack has the same kind, pop and emit a Pair.
 *   If the top has a DIFFERENT kind, leave the stack as-is (skip the close).
 *   This handles the case where an inner span's close comes first.
 *
 * Code zones are skipped.
 */
function scanPairs(text: string): PairEntry[] {
  const inCodeZone = buildCodeZoneMask(text);
  const pairs: PairEntry[] = [];

  // Stack entries: {kind, openOffset}
  const stack: Array<{ kind: MarkupKind; openOffset: number }> = [];

  let pos = 0;
  while (pos < text.length) {
    if (inCodeZone[pos]) {
      pos++;
      continue;
    }

    const ch = text[pos];

    // ── Check for close delimiter ─────────────────────────────────────────────
    // Only enter this branch when the current character could start a close
    // delimiter AND there is at least one open on the stack.
    if (CLOSE_FIRST.has(ch) && stack.length > 0) {
      let closeMatched = false;
      for (const [closeDelim, closeKind] of Object.entries(CLOSE_KINDS)) {
        if (text.startsWith(closeDelim, pos)) {
          closeMatched = true;
          // Find the LAST (innermost) stack entry with this kind.
          let matchIdx = -1;
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].kind === closeKind) {
              matchIdx = i;
              break;
            }
          }
          if (matchIdx >= 0) {
            const entry = stack[matchIdx];
            pairs.push({
              kind: closeKind,
              open: entry.openOffset,
              close: pos,
            });
            stack.splice(matchIdx, 1);
            pos += closeDelim.length;
          } else {
            // A close delimiter that has no matching open on the stack — skip it.
            pos += closeDelim.length;
          }
          break; // only one close can match at a given position
        }
      }
      if (!closeMatched) {
        // Character looks like it could start a close but no delimiter matched —
        // advance by 1 so we don't loop forever.
        pos++;
      }
      continue;
    }

    // ── Check for open delimiter ('{' starts all opens) ───────────────────────
    if (ch === '{') {
      let matched = false;
      for (const [openDelim, openKind] of Object.entries(OPEN_KINDS)) {
        if (text.startsWith(openDelim, pos)) {
          stack.push({ kind: openKind, openOffset: pos });
          pos += openDelim.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        pos++;
      }
      continue;
    }

    pos++;
  }

  return pairs;
}

/**
 * Finds the CriticMarkup span associated with the given change ID.
 *
 * The scan builds all matched pairs, then looks for a pair whose close
 * delimiter is immediately followed by `[^changeId]`.
 *
 * Returns null for:
 * - orphan refs (no markup span precedes the `[^changeId]`)
 * - IDs not present in the text
 */
export function findMarkupRangeById(
  text: string,
  changeId: string,
): MarkupRangeById | null {
  const pairs = scanPairs(text);
  const refPattern = `[^${changeId}]`;
  const closeDelimLen = 3; // all close delimiters are exactly 3 chars

  for (const p of pairs) {
    // The position immediately after the close delimiter is p.close + 3.
    const afterClose = p.close + closeDelimLen;
    if (text.startsWith(refPattern, afterClose)) {
      return {
        start: p.open,
        end: afterClose + refPattern.length,
        type: p.kind,
      };
    }
  }
  return null;
}

/**
 * Removes the CriticMarkup span (open + content + close + `[^changeId]`)
 * for the given change ID from `text`.
 *
 * Returns the unchanged text if the ID is not found.
 */
export function removeMarkupById(text: string, changeId: string): string {
  const range = findMarkupRangeById(text, changeId);
  if (!range) return text;
  return text.slice(0, range.start) + text.slice(range.end);
}
