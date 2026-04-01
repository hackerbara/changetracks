// packages/core/src/host/decorations/helpers.ts
import { diffChars } from 'diff';
import type { ChangeNode } from '../../model/types.js';
import type { OffsetRange, OffsetDecoration, DecorationPlan } from './types.js';

/** Precompute byte offsets of each line start for O(log n) offset→line lookup. */
export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Binary-search line number for a UTF-16 offset. */
export function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function isOffsetInRange(offset: number, range: OffsetRange): boolean {
  return offset >= range.start && offset <= range.end;
}

export function hideDelimiters(
  fullRange: OffsetRange,
  contentRange: OffsetRange,
  hiddens: OffsetDecoration[],
): void {
  if (fullRange.start < contentRange.start) {
    hiddens.push({ range: { start: fullRange.start, end: contentRange.start } });
  }
  if (contentRange.end < fullRange.end) {
    hiddens.push({ range: { start: contentRange.end, end: fullRange.end } });
  }
}

export function revealDelimiters(
  fullRange: OffsetRange,
  contentRange: OffsetRange,
  unfoldedDelimiters: OffsetDecoration[],
): void {
  if (fullRange.start < contentRange.start) {
    unfoldedDelimiters.push({ range: { start: fullRange.start, end: contentRange.start } });
  }
  if (contentRange.end < fullRange.end) {
    unfoldedDelimiters.push({ range: { start: contentRange.end, end: fullRange.end } });
  }
}

export function injectGhostDelimiters(
  fullRange: OffsetRange,
  contentRange: OffsetRange,
  ghostDelimiters: OffsetDecoration[],
  openDelimiter: string,
  closeDelimiter: string,
): void {
  if (fullRange.start < contentRange.start) {
    ghostDelimiters.push({
      range: { start: contentRange.start, end: contentRange.start },
      renderBefore: { contentText: openDelimiter },
    });
  }
  if (contentRange.end < fullRange.end) {
    ghostDelimiters.push({
      range: { start: contentRange.end, end: contentRange.end },
      renderAfter: { contentText: closeDelimiter },
    });
  }
}

/**
 * Combined hide-or-ghost dispatcher: hides real delimiters for L2, injects
 * ghost delimiters for L3, or does nothing when L3 + ghosts disabled.
 */
export function hideOrGhostDelimiters(
  fullRange: OffsetRange,
  contentRange: OffsetRange,
  plan: DecorationPlan,
  isL3: boolean,
  showGhostDelimiters: boolean,
  openDelim: string,
  closeDelim: string,
): void {
  if (isL3 && showGhostDelimiters) {
    injectGhostDelimiters(fullRange, contentRange, plan.ghostDelimiters, openDelim, closeDelim);
  } else if (!isL3) {
    hideDelimiters(fullRange, contentRange, plan.hiddens);
  }
}

/** Compute character-level highlight ranges for a substitution node using diff. */
export function getCharLevelRanges(change: ChangeNode): OffsetRange[] {
  if (!change.originalText || !change.modifiedText) return [];
  if (change.originalText.includes('\n') || change.modifiedText.includes('\n')) return [];
  const charDiffs = diffChars(change.originalText, change.modifiedText);
  const ranges: OffsetRange[] = [];
  let modOffset = 0;
  for (const diff of charDiffs) {
    if (diff.added) {
      ranges.push({
        start: change.contentRange.start + modOffset,
        end: change.contentRange.start + modOffset + diff.value.length,
      });
      modOffset += diff.value.length;
    } else if (!diff.removed) {
      modOffset += diff.value.length;
    }
  }
  return ranges;
}

export function createEmptyPlan(): DecorationPlan {
  return {
    insertions: [], deletions: [],
    substitutionOriginals: [], substitutionModifieds: [],
    highlights: [], comments: [],
    hiddens: [], unfoldedDelimiters: [],
    commentIcons: [], activeHighlights: [],
    moveFroms: [], moveTos: [],
    settledRefs: [], settledDims: [],
    ghostDeletions: [], consumedRanges: [],
    consumingOpAnnotations: [],
    ghostDelimiters: [], ghostRefs: [],
    hiddenOffsets: [],
    authorDecorations: new Map(),
  };
}
