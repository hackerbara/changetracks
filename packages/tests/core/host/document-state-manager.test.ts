// packages/tests/core/host/document-state-manager.test.ts
import { describe, it, expect } from 'vitest';
import { DocumentStateManager } from '@changedown/core/host';
import type { ChangeNode } from '@changedown/core';
import { ChangeType, ChangeStatus } from '@changedown/core';

describe('DocumentStateManager', () => {
  it('ensureState creates a new state bag', () => {
    const mgr = new DocumentStateManager();
    const state = mgr.ensureState('file:///a.md', 'hello', 1);
    expect(state.uri).toBe('file:///a.md');
    expect(state.text).toBe('hello');
    expect(state.version).toBe(1);
    expect(state.cachedChanges).toEqual([]);
    expect(state.cacheVersion).toBe(-1);
  });

  it('ensureState returns existing state if already created', () => {
    const mgr = new DocumentStateManager();
    const s1 = mgr.ensureState('file:///a.md', 'hello', 1);
    s1.text = 'modified';
    const s2 = mgr.ensureState('file:///a.md', 'ignored', 2);
    expect(s2.text).toBe('modified');
  });

  it('getState returns undefined for unknown URI', () => {
    const mgr = new DocumentStateManager();
    expect(mgr.getState('file:///nope')).toBeUndefined();
  });

  it('removeState deletes the state bag', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'hello', 1);
    mgr.removeState('file:///a.md');
    expect(mgr.getState('file:///a.md')).toBeUndefined();
  });

  it('setCachedDecorations stores changes when version >= cached', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', '', 1);
    const changes = [{ type: 'Insertion', range: { start: 0, end: 5 } }] as any;
    const accepted = mgr.setCachedDecorations('file:///a.md', changes, 1);
    expect(accepted).toBe(true);
    expect(mgr.getCachedDecorations('file:///a.md', 1)).toBe(changes);
  });

  it('setCachedDecorations rejects stale version', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', '', 5);
    mgr.setCachedDecorations('file:///a.md', [{ type: 'Insertion' }] as any, 5);
    const accepted = mgr.setCachedDecorations('file:///a.md', [{ type: 'Deletion' }] as any, 3);
    expect(accepted).toBe(false);
  });

  it('getCachedDecorations returns null if version mismatch', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', '', 1);
    mgr.setCachedDecorations('file:///a.md', [{ type: 'Insertion' }] as any, 1);
    expect(mgr.getCachedDecorations('file:///a.md', 2)).toBeNull();
  });
});

function makeNode(start: number, end: number): ChangeNode {
  return {
    id: 'cn-1',
    type: ChangeType.Insertion,
    status: ChangeStatus.Proposed,
    range: { start, end },
    contentRange: { start, end },
    level: 1,
    anchored: false,
  } as ChangeNode;
}

describe('applyContentChange', () => {
  it('returns false when URI has no state', () => {
    const mgr = new DocumentStateManager();
    const result = mgr.applyContentChange('file:///nope', 'x', 1, []);
    expect(result).toBe(false);
  });

  it('returns false and updates text when cache is empty', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'old', 0);
    const result = mgr.applyContentChange('file:///a.md', 'new', 1, [
      { rangeOffset: 0, rangeLength: 3, text: 'new' },
    ]);
    expect(result).toBe(false);
    const state = mgr.getState('file:///a.md')!;
    expect(state.text).toBe('new');
    expect(state.version).toBe(1);
  });

  it('transforms cached ranges when insert is before a change', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'hello world', 0);
    mgr.setCachedDecorations('file:///a.md', [makeNode(6, 11)], 0);

    const result = mgr.applyContentChange('file:///a.md', 'XXXhello world', 1, [
      { rangeOffset: 0, rangeLength: 0, text: 'XXX' },
    ]);

    expect(result).toBe(true);
    const state = mgr.getState('file:///a.md')!;
    expect(state.cachedChanges[0].range).toEqual({ start: 9, end: 14 });
    expect(state.text).toBe('XXXhello world');
    expect(state.version).toBe(1);
  });

  it('handles multi-change batch sequentially', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'abcdef', 0);
    mgr.setCachedDecorations('file:///a.md', [makeNode(4, 6)], 0);

    // Two inserts: 2 chars at offset 0, then 3 chars at offset 2 (in post-first-edit text)
    mgr.applyContentChange('file:///a.md', 'XXabcYYYdef', 1, [
      { rangeOffset: 0, rangeLength: 0, text: 'XX' },
      { rangeOffset: 2, rangeLength: 0, text: 'YYY' },
    ]);

    const state = mgr.getState('file:///a.md')!;
    // Original node at [4,6] shifted by +2 (first edit) then +3 (second edit before it)
    expect(state.cachedChanges[0].range).toEqual({ start: 9, end: 11 });
  });

  it('keeps zero-width ranges after transform (collapsed positions)', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'abcdefghij', 0);
    mgr.setCachedDecorations('file:///a.md', [makeNode(2, 5)], 0);

    // Delete that spans and collapses the node's range to zero-width
    mgr.applyContentChange('file:///a.md', 'aj', 1, [
      { rangeOffset: 1, rangeLength: 8, text: '' },
    ]);

    const state = mgr.getState('file:///a.md')!;
    // Node range becomes zero-width [2,2] — kept as collapsed position
    expect(state.cachedChanges.length).toBe(1);
    expect(state.cachedChanges[0].range).toEqual({ start: 2, end: 2 });
  });

  it('getCachedDecorations returns data after applyContentChange', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'hello world', 0);
    mgr.setCachedDecorations('file:///a.md', [makeNode(6, 11)], 0);

    mgr.applyContentChange('file:///a.md', 'Xhello world', 1, [
      { rangeOffset: 0, rangeLength: 0, text: 'X' },
    ]);

    // cacheVersion must be bumped so getCachedDecorations returns data
    const cached = mgr.getCachedDecorations('file:///a.md', 1);
    expect(cached).not.toBeNull();
    expect(cached![0].range).toEqual({ start: 7, end: 12 });
  });

  it('transforms originalRange and modifiedRange when present', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'hello world', 0);
    const node = makeNode(6, 11);
    node.originalRange = { start: 6, end: 8 };
    node.modifiedRange = { start: 8, end: 11 };
    mgr.setCachedDecorations('file:///a.md', [node], 0);

    mgr.applyContentChange('file:///a.md', 'XXhello world', 1, [
      { rangeOffset: 0, rangeLength: 0, text: 'XX' },
    ]);

    const state = mgr.getState('file:///a.md')!;
    const n = state.cachedChanges[0];
    expect(n.range).toEqual({ start: 8, end: 13 });
    expect(n.originalRange).toEqual({ start: 8, end: 10 });
    expect(n.modifiedRange).toEqual({ start: 10, end: 13 });
  });
});

describe('invalidateCache', () => {
  it('clears cached changes and resets version', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', '', 0);
    mgr.setCachedDecorations('file:///a.md', [makeNode(0, 5)], 1);
    mgr.invalidateCache('file:///a.md');
    const state = mgr.getState('file:///a.md')!;
    expect(state.cachedChanges).toEqual([]);
    expect(state.cacheVersion).toBe(-1);
  });

  it('no-ops for unknown URI', () => {
    const mgr = new DocumentStateManager();
    mgr.invalidateCache('file:///nope'); // should not throw
  });
});

describe('migrateState', () => {
  it('moves state from old URI to new URI', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///old.md', 'content', 1);
    mgr.setCachedDecorations('file:///old.md', [makeNode(0, 5)], 1);
    mgr.migrateState('file:///old.md', 'file:///new.md');
    expect(mgr.getState('file:///old.md')).toBeUndefined();
    const state = mgr.getState('file:///new.md')!;
    expect(state.text).toBe('content');
    expect(state.cachedChanges.length).toBe(1);
  });

  it('no-ops for unknown URI', () => {
    const mgr = new DocumentStateManager();
    mgr.migrateState('file:///nope', 'file:///new.md'); // should not throw
    expect(mgr.getState('file:///new.md')).toBeUndefined();
  });
});
