import { describe, it, expect } from 'vitest';
import { normalizeUri, UriMap, UriSet, type DocumentUri } from '@changedown/core/host';

describe('normalizeUri', () => {
  it('lowercases scheme and authority', () => {
    const result = normalizeUri('FILE:///Users/foo.md');
    expect(result).toBe('file:///Users/foo.md');
  });

  it('decodes unreserved percent-encoded characters', () => {
    const result = normalizeUri('file:///Users/%66oo.md');
    expect(result).toBe('file:///Users/foo.md');
  });

  it('removes trailing slashes', () => {
    const result = normalizeUri('file:///Users/project/');
    expect(result).toBe('file:///Users/project');
  });

  it('returns branded DocumentUri type', () => {
    const result = normalizeUri('file:///test.md');
    const _check: DocumentUri = result;
    expect(typeof result).toBe('string');
  });

  it('handles plain paths (no scheme)', () => {
    const result = normalizeUri('/user/document.md');
    expect(result).toBe('/user/document.md');
  });
});

describe('UriMap', () => {
  it('stores and retrieves by DocumentUri', () => {
    const map = new UriMap<number>();
    const uri = normalizeUri('file:///test.md');
    map.set(uri, 42);
    expect(map.get(uri)).toBe(42);
  });

  it('has() returns correct boolean', () => {
    const map = new UriMap<string>();
    const uri = normalizeUri('file:///test.md');
    expect(map.has(uri)).toBe(false);
    map.set(uri, 'value');
    expect(map.has(uri)).toBe(true);
  });

  it('delete() removes entry', () => {
    const map = new UriMap<string>();
    const uri = normalizeUri('file:///test.md');
    map.set(uri, 'value');
    map.delete(uri);
    expect(map.has(uri)).toBe(false);
  });

  it('supports iteration', () => {
    const map = new UriMap<number>();
    map.set(normalizeUri('file:///a.md'), 1);
    map.set(normalizeUri('file:///b.md'), 2);
    expect(map.size).toBe(2);
  });
});

describe('UriSet', () => {
  it('add and has work correctly', () => {
    const set = new UriSet();
    const uri = normalizeUri('file:///test.md');
    expect(set.has(uri)).toBe(false);
    set.add(uri);
    expect(set.has(uri)).toBe(true);
  });

  it('delete removes entry', () => {
    const set = new UriSet();
    const uri = normalizeUri('file:///test.md');
    set.add(uri);
    set.delete(uri);
    expect(set.has(uri)).toBe(false);
  });
});
