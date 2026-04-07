import { describe, it, expect } from 'vitest';
import { applyTextEdits } from '@changedown/vienna-plugin';

describe('applyTextEdits', () => {
  const text = 'line one\nline two\nline three\n';

  it('applies a single replacement', () => {
    const result = applyTextEdits(text, [{
      range: { start: { line: 1, character: 5 }, end: { line: 1, character: 8 } },
      newText: '2',
    }]);
    expect(result).toBe('line one\nline 2\nline three\n');
  });

  it('applies multiple edits in correct order', () => {
    const result = applyTextEdits(text, [
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } }, newText: '1' },
      { range: { start: { line: 2, character: 5 }, end: { line: 2, character: 10 } }, newText: '3' },
    ]);
    expect(result).toBe('line 1\nline two\nline 3\n');
  });

  it('handles insertion (empty range)', () => {
    const result = applyTextEdits(text, [{
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
      newText: ' zero',
    }]);
    expect(result).toBe('line zero one\nline two\nline three\n');
  });

  it('handles deletion (empty newText)', () => {
    const result = applyTextEdits(text, [{
      range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
      newText: '',
    }]);
    expect(result).toBe('line one\nline three\n');
  });

  it('returns original text for empty edits array', () => {
    expect(applyTextEdits(text, [])).toBe(text);
  });
});
