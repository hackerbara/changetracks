import { describe, it, expect } from 'vitest';
import { UriKeyedStore } from '@changedown/core/host';

describe('UriKeyedStore', () => {
  class TestStore extends UriKeyedStore<{ count: number }> {}

  it('ensures entries with defaults', () => {
    const store = new TestStore();
    const entry = store.ensure('file:///a.md', () => ({ count: 0 }));
    expect(entry.count).toBe(0);
  });

  it('returns same entry on repeat ensure calls', () => {
    const store = new TestStore();
    const first = store.ensure('file:///a.md', () => ({ count: 1 }));
    const second = store.ensure('file:///a.md', () => ({ count: 99 }));
    expect(second).toBe(first);
    expect(second.count).toBe(1);
  });

  it('get returns undefined for missing', () => {
    const store = new TestStore();
    expect(store.get('file:///a.md')).toBeUndefined();
  });

  it('delete removes entry', () => {
    const store = new TestStore();
    store.ensure('file:///a.md', () => ({ count: 1 }));
    store.delete('file:///a.md');
    expect(store.get('file:///a.md')).toBeUndefined();
  });

  it('clear removes all entries', () => {
    const store = new TestStore();
    store.ensure('file:///a.md', () => ({ count: 1 }));
    store.ensure('file:///b.md', () => ({ count: 2 }));
    store.clear();
    expect(store.get('file:///a.md')).toBeUndefined();
    expect(store.get('file:///b.md')).toBeUndefined();
  });

  it('size reports entry count', () => {
    const store = new TestStore();
    expect(store.size).toBe(0);
    store.ensure('file:///a.md', () => ({ count: 1 }));
    expect(store.size).toBe(1);
  });

  it('has returns true for existing entries, false otherwise', () => {
    const store = new TestStore();
    expect(store.has('file:///a.md')).toBe(false);
    store.ensure('file:///a.md', () => ({ count: 1 }));
    expect(store.has('file:///a.md')).toBe(true);
  });

  it('set overwrites or creates entry', () => {
    const store = new TestStore();
    store.set('file:///a.md', { count: 5 });
    expect(store.get('file:///a.md')).toEqual({ count: 5 });
    store.set('file:///a.md', { count: 10 });
    expect(store.get('file:///a.md')).toEqual({ count: 10 });
  });

  it('iterates entries with Symbol.iterator', () => {
    const store = new TestStore();
    store.ensure('file:///a.md', () => ({ count: 1 }));
    store.ensure('file:///b.md', () => ({ count: 2 }));
    const entries = Array.from(store);
    expect(entries.length).toBe(2);
    expect(entries.map(([uri]) => uri).sort()).toEqual(['file:///a.md', 'file:///b.md']);
  });
});
