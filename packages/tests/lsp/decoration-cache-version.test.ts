import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentStateManager } from '@changedown/core/host';
import { ChangeType, ChangeStatus } from '@changedown/core';
import type { ChangeNode } from '@changedown/core';

function makeNode(start: number, end: number): ChangeNode {
  return {
    id: 'cn-1', type: ChangeType.Insertion, status: ChangeStatus.Proposed,
    range: { start, end }, contentRange: { start, end },
    level: 1, anchored: false,
  } as ChangeNode;
}

describe('decoration cache version (via DocumentStateManager)', () => {
  let mgr: DocumentStateManager;

  beforeEach(() => {
    mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'hello world', 0);
  });

  it('stores documentVersion via setCachedDecorations', () => {
    mgr.setCachedDecorations('file:///a.md', [makeNode(0, 5)], 3);
    expect(mgr.getCachedDecorations('file:///a.md', 3)).not.toBeNull();
  });

  it('rejects stale version', () => {
    mgr.setCachedDecorations('file:///a.md', [makeNode(0, 5)], 5);
    const accepted = mgr.setCachedDecorations('file:///a.md', [makeNode(0, 3)], 3);
    expect(accepted).toBe(false);
  });

  it('getCachedDecorations returns null when version too new', () => {
    mgr.setCachedDecorations('file:///a.md', [makeNode(0, 5)], 1);
    expect(mgr.getCachedDecorations('file:///a.md', 2)).toBeNull();
  });

  it('applyContentChange bumps version', () => {
    mgr.setCachedDecorations('file:///a.md', [makeNode(6, 11)], 0);
    mgr.applyContentChange('file:///a.md', 'Xhello world', 1, [
      { rangeOffset: 0, rangeLength: 0, text: 'X' },
    ]);
    const state = mgr.getState('file:///a.md')!;
    expect(state.version).toBe(1);
  });

  it('invalidateCache clears changes', () => {
    mgr.setCachedDecorations('file:///a.md', [makeNode(0, 5)], 1);
    mgr.invalidateCache('file:///a.md');
    const state = mgr.getState('file:///a.md')!;
    expect(state.cachedChanges).toEqual([]);
    expect(state.cacheVersion).toBe(-1);
  });
});
