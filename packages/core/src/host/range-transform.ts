// packages/core/src/host/range-transform.ts

/**
 * Byte-offset content change — matches the shape provided natively by both
 * Monaco's onDidChangeModelContent and VS Code's onDidChangeTextDocument.
 */
export interface OffsetContentChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

/**
 * Adjust a single offset range by an edit delta. Mutates in-place.
 *
 * Four cases:
 * 1. Edit entirely before range → shift both endpoints
 * 2. Edit entirely after range → no change
 * 3. Edit entirely inside range → expand/contract end
 * 4. Edit spans boundary → adjust end, clamp to start
 */
export function transformRange(
  range: { start: number; end: number },
  editStart: number,
  editEnd: number,
  delta: number,
): void {
  if (editEnd <= range.start) {
    range.start += delta;
    range.end += delta;
  } else if (editStart >= range.end) {
    // no change
  } else if (editStart >= range.start && editEnd <= range.end) {
    range.end += delta;
  } else {
    range.end = Math.max(range.start, range.end + delta);
  }
}
