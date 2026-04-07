import { describe, it, expect } from 'vitest';
import { offsetToRange, rangeToOffset, type RangeEdit, type OffsetEdit } from '@changedown/core/host';

describe('offsetToRange', () => {
  const text = 'line one\nline two\nline three';

  it('converts insertion at start of line 2', () => {
    const edit: OffsetEdit = { offset: 9, length: 0, newText: 'hello ' };
    const result = offsetToRange(text, edit);
    expect(result).toEqual({
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      },
      newText: 'hello ',
    });
  });

  it('converts deletion spanning characters', () => {
    const edit: OffsetEdit = { offset: 5, length: 3, newText: '' };
    const result = offsetToRange(text, edit);
    expect(result).toEqual({
      range: {
        start: { line: 0, character: 5 },
        end: { line: 0, character: 8 },
      },
      newText: '',
    });
  });

  it('converts substitution crossing newline', () => {
    const edit: OffsetEdit = { offset: 7, length: 3, newText: 'X' };
    const result = offsetToRange(text, edit);
    expect(result).toEqual({
      range: {
        start: { line: 0, character: 7 },
        end: { line: 1, character: 1 },
      },
      newText: 'X',
    });
  });
});

describe('rangeToOffset', () => {
  const text = 'line one\nline two\nline three';

  it('converts range at start of line 2 to offset', () => {
    const edit: RangeEdit = {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
      newText: 'LINE',
    };
    const result = rangeToOffset(text, edit);
    expect(result).toEqual({ offset: 9, length: 4, newText: 'LINE' });
  });

  it('converts zero-width range (insertion)', () => {
    const edit: RangeEdit = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: 'prefix ',
    };
    const result = rangeToOffset(text, edit);
    expect(result).toEqual({ offset: 0, length: 0, newText: 'prefix ' });
  });

  it('converts range spanning multiple lines', () => {
    const edit: RangeEdit = {
      range: { start: { line: 0, character: 5 }, end: { line: 1, character: 5 } },
      newText: '',
    };
    const result = rangeToOffset(text, edit);
    expect(result).toEqual({ offset: 5, length: 9, newText: '' });
  });
});
