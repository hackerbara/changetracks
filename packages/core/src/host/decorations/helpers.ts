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
  _fullRange: OffsetRange,
  contentRange: OffsetRange,
  ghostDelimiters: OffsetDecoration[],
  openDelimiter: string,
  closeDelimiter: string,
): void {
  // Bug 4 fix: emit unconditionally. Previously this function
  // was guarded by `fullRange.start < contentRange.start` and `contentRange.end
  // < fullRange.end`, which silently suppressed emission for L3 documents
  // where the parser sets contentRange = { ...range }. Callers (specifically
  // hideOrGhostDelimiters) already gate on L3 + showGhostDelimiters, so this
  // is the correct layer to drop the guard. _fullRange stays in the signature
  // for caller compatibility.
  ghostDelimiters.push({
    range: { start: contentRange.start, end: contentRange.start },
    renderBefore: { contentText: openDelimiter },
  });
  ghostDelimiters.push({
    range: { start: contentRange.end, end: contentRange.end },
    renderAfter: { contentText: closeDelimiter },
  });
}

/**
 * Hide real delimiter bytes or inject ghost delimiters, depending on whether
 * the change has inline delimiters. No format metadata is read — the caller
 * derives `hasInlineDelimiters` from `range` vs `contentRange` inset.
 */
export function hideOrGhostDelimiters(
  fullRange: OffsetRange,
  contentRange: OffsetRange,
  plan: DecorationPlan,
  hasInlineDelimiters: boolean,
  showGhostDelimiters: boolean,
  openDelim: string,
  closeDelim: string,
): void {
  if (hasInlineDelimiters) {
    hideDelimiters(fullRange, contentRange, plan.hiddens);
  } else if (showGhostDelimiters) {
    injectGhostDelimiters(fullRange, contentRange, plan.ghostDelimiters, openDelim, closeDelim);
  }
}

/**
 * Returns true when the change has real delimiter bytes in the document body
 * (i.e. range extends beyond contentRange on either side). This is the inverse
 * of the L3 sidecar shape where range === contentRange.
 *
 * Callers derive this once per change and pass the boolean to
 * hideOrGhostDelimiters — no format metadata is read here.
 */
export function hasInlineDelimiters(change: ChangeNode): boolean {
  return change.range.start < change.contentRange.start
      || change.range.end > change.contentRange.end;
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
    decidedRefs: [], decidedDims: [],
    ghostDeletions: [], consumedRanges: [],
    consumingOpAnnotations: [],
    ghostDelimiters: [], ghostRefs: [],
    hiddenOffsets: [],
    authorDecorations: new Map(),
  };
}
