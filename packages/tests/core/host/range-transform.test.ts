import { describe, it, expect } from 'vitest';
import { transformRange } from '@changedown/core/host';

describe('transformRange', () => {
  it('shifts range forward when edit is entirely before', () => {
    const range = { start: 10, end: 20 };
    transformRange(range, 0, 0, 5); // insert 5 chars at offset 0
    expect(range).toEqual({ start: 15, end: 25 });
  });

  it('does not change range when edit is entirely after', () => {
    const range = { start: 10, end: 20 };
    transformRange(range, 25, 30, -5); // delete 5 chars at offset 25
    expect(range).toEqual({ start: 10, end: 20 });
  });

  it('expands range when edit is entirely inside', () => {
    const range = { start: 10, end: 20 };
    transformRange(range, 12, 12, 3); // insert 3 chars at offset 12
    expect(range).toEqual({ start: 10, end: 23 });
  });

  it('contracts range when deletion is entirely inside', () => {
    const range = { start: 10, end: 20 };
    transformRange(range, 12, 15, -3); // delete 3 chars inside range
    expect(range).toEqual({ start: 10, end: 17 });
  });

  it('adjusts end and clamps when edit spans range boundary', () => {
    const range = { start: 10, end: 20 };
    transformRange(range, 5, 15, -10); // delete from 5 to 15
    expect(range).toEqual({ start: 10, end: 10 });
  });

  it('handles edit at exact range start (editEnd === range.start)', () => {
    const range = { start: 10, end: 20 };
    transformRange(range, 5, 10, 3); // insert at exact start boundary
    expect(range).toEqual({ start: 13, end: 23 });
  });

  it('handles edit at exact range end (editStart === range.end)', () => {
    const range = { start: 10, end: 20 };
    transformRange(range, 20, 25, -5); // delete at exact end boundary
    expect(range).toEqual({ start: 10, end: 20 });
  });

  it('handles zero-width range', () => {
    const range = { start: 10, end: 10 };
    transformRange(range, 5, 5, 3); // insert before collapsed range
    expect(range).toEqual({ start: 13, end: 13 });
  });
});
