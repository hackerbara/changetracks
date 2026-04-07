// packages/tests/core/host/document-state-manager-events.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentStateManager } from '@changedown/core/host';

describe('DocumentStateManager onDidChangeChanges', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires after 120ms debounce on setCachedDecorations', () => {
    const dsm = new DocumentStateManager();
    dsm.ensureState('file:///a.md', 'x', 1);
    const listener = vi.fn();
    dsm.onDidChangeChanges(listener);

    // Non-empty payload differs from the initial empty cachedChanges, so it fires.
    const changes = [{ id: 'cn-1', range: { start: 0, end: 5 }, status: 'proposed' } as any];
    dsm.setCachedDecorations('file:///a.md', changes, 1);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(119);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledWith(['file:///a.md']);
  });

  it('batches multiple URIs in one event within debounce window', () => {
    const dsm = new DocumentStateManager();
    dsm.ensureState('file:///a.md', 'x', 1);
    dsm.ensureState('file:///b.md', 'y', 1);
    const listener = vi.fn();
    dsm.onDidChangeChanges(listener);

    // Non-empty payloads differ from the initial empty cachedChanges, so both fire.
    const changesA = [{ id: 'cn-a', range: { start: 0, end: 5 }, status: 'proposed' } as any];
    const changesB = [{ id: 'cn-b', range: { start: 0, end: 5 }, status: 'proposed' } as any];
    dsm.setCachedDecorations('file:///a.md', changesA, 1);
    dsm.setCachedDecorations('file:///b.md', changesB, 1);
    // Same payload as changesA — deduped, but 'a.md' is already pending from first call
    dsm.setCachedDecorations('file:///a.md', changesA, 1);

    vi.advanceTimersByTime(120);
    expect(listener).toHaveBeenCalledTimes(1);
    const call = listener.mock.calls[0][0] as string[];
    expect(call.sort()).toEqual(['file:///a.md', 'file:///b.md']);
  });

  it('fires separate events for separate debounce windows', () => {
    const dsm = new DocumentStateManager();
    dsm.ensureState('file:///a.md', 'x', 1);
    const listener = vi.fn();
    dsm.onDidChangeChanges(listener);

    const changes1 = [{ id: 'cn-1', range: { start: 0, end: 5 }, status: 'proposed' } as any];
    dsm.setCachedDecorations('file:///a.md', changes1, 1);
    vi.advanceTimersByTime(120);
    expect(listener).toHaveBeenCalledTimes(1);

    // Different payload — must fire again
    const changes2 = [{ id: 'cn-2', range: { start: 0, end: 5 }, status: 'proposed' } as any];
    dsm.setCachedDecorations('file:///a.md', changes2, 2);
    vi.advanceTimersByTime(120);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not fire when version is older than cached', () => {
    const dsm = new DocumentStateManager();
    dsm.ensureState('file:///a.md', 'x', 1);
    const listener = vi.fn();
    dsm.onDidChangeChanges(listener);

    const changes = [{ id: 'cn-1', range: { start: 0, end: 5 }, status: 'proposed' } as any];
    dsm.setCachedDecorations('file:///a.md', changes, 5);
    vi.advanceTimersByTime(120);
    expect(listener).toHaveBeenCalledTimes(1);

    dsm.setCachedDecorations('file:///a.md', changes, 3); // older — rejected before dedup check
    vi.advanceTimersByTime(120);
    expect(listener).toHaveBeenCalledTimes(1); // still just 1
  });

  it('does not fire for unknown URI (no state)', () => {
    const dsm = new DocumentStateManager();
    const listener = vi.fn();
    dsm.onDidChangeChanges(listener);

    dsm.setCachedDecorations('file:///unknown.md', [], 1);
    vi.advanceTimersByTime(120);
    expect(listener).not.toHaveBeenCalled();
  });

  it('dispose clears pending timer and prevents fires', () => {
    const dsm = new DocumentStateManager();
    dsm.ensureState('file:///a.md', 'x', 1);
    const listener = vi.fn();
    dsm.onDidChangeChanges(listener);

    const changes = [{ id: 'cn-1', range: { start: 0, end: 5 }, status: 'proposed' } as any];
    dsm.setCachedDecorations('file:///a.md', changes, 1);
    dsm.dispose();
    vi.advanceTimersByTime(120);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not fire when changes are identical to cached', () => {
    const dsm = new DocumentStateManager();
    dsm.ensureState('file:///a.md', 'x', 1);
    const changes = [{ id: 'cn-1', range: { start: 0, end: 10 }, status: 'proposed' } as any];
    const listener = vi.fn();
    dsm.onDidChangeChanges(listener);

    dsm.setCachedDecorations('file:///a.md', changes, 1);
    vi.advanceTimersByTime(120);
    expect(listener).toHaveBeenCalledTimes(1);

    // Identical payload — should not re-fire
    dsm.setCachedDecorations('file:///a.md', [...changes], 2);
    vi.advanceTimersByTime(120);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
