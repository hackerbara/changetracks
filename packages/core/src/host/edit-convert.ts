import type { RangeEdit, OffsetEdit } from './types.js';
import { computeLineStarts, offsetToLine } from './decorations/helpers.js';

function offsetToPosition(lineStarts: number[], offset: number): { line: number; character: number } {
  const line = offsetToLine(lineStarts, offset);
  return { line, character: offset - lineStarts[line] };
}

function positionToOffset(lineStarts: number[], pos: { line: number; character: number }): number {
  return (lineStarts[pos.line] ?? 0) + pos.character;
}

export function offsetToRange(text: string, edit: OffsetEdit): RangeEdit {
  const lineStarts = computeLineStarts(text);
  const start = offsetToPosition(lineStarts, edit.offset);
  const end = offsetToPosition(lineStarts, edit.offset + edit.length);
  return { range: { start, end }, newText: edit.newText };
}

export function rangeToOffset(text: string, edit: RangeEdit): OffsetEdit {
  const lineStarts = computeLineStarts(text);
  const offset = positionToOffset(lineStarts, edit.range.start);
  const endOffset = positionToOffset(lineStarts, edit.range.end);
  return { offset, length: endOffset - offset, newText: edit.newText };
}

/** Batch-convert multiple RangeEdits using a single lineStarts computation. */
export function rangeToOffsetBatch(text: string, edits: RangeEdit[]): OffsetEdit[] {
  const lineStarts = computeLineStarts(text);
  return edits.map(edit => {
    const offset = positionToOffset(lineStarts, edit.range.start);
    const endOffset = positionToOffset(lineStarts, edit.range.end);
    return { offset, length: endOffset - offset, newText: edit.newText };
  });
}
