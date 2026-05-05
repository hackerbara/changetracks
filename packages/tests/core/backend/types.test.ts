// packages/tests/core/backend/types.test.ts
import { describe, it, expect } from 'vitest';
import { parseUri } from '@changedown/core/backend';

describe('parseUri', () => {
  it('parses a file:// URI into scheme + rest', () => {
    const result = parseUri('file:///home/user/doc.md');
    expect(result).toEqual({ scheme: 'file', rest: '///home/user/doc.md' });
  });

  it('parses a word:// URI', () => {
    const result = parseUri('word://sess-abc123');
    expect(result).toEqual({ scheme: 'word', rest: '//sess-abc123' });
  });

  it('throws on a URI with no scheme separator', () => {
    expect(() => parseUri('nodoublecolon')).toThrow('Invalid URI');
  });

  it('throws on an empty string', () => {
    expect(() => parseUri('')).toThrow('Invalid URI');
  });

  it('scheme is lowercased', () => {
    const result = parseUri('FILE:///upper');
    expect(result.scheme).toBe('file');
  });
});
