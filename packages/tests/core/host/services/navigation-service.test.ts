import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationService } from '@changedown/core/host/services';
import { DocumentStateManager } from '@changedown/core/host';
import type { ChangeNode } from '@changedown/core';

function makeChange(start: number, end: number, id: string): ChangeNode {
  return {
    id,
    type: 'Insert' as any,
    range: { start, end },
    status: 'Pending' as any,
    level: 1,
  } as ChangeNode;
}

describe('NavigationService', () => {
  let stateManager: DocumentStateManager;
  let service: NavigationService;
  const uri = 'file:///a.md';

  beforeEach(() => {
    stateManager = new DocumentStateManager();
    service = new NavigationService(stateManager);
    stateManager.ensureState(uri, 'some text with changes', 0);
    stateManager.setCachedDecorations(uri, [
      makeChange(10, 20, 'cn-1'),
      makeChange(30, 40, 'cn-2'),
      makeChange(50, 60, 'cn-3'),
    ], 1);
  });

  it('nextChange returns change after current offset', () => {
    const result = service.nextChange(uri, 5);
    expect(result?.id).toBe('cn-1');
  });

  it('nextChange skips change containing current offset', () => {
    const result = service.nextChange(uri, 15);
    expect(result?.id).toBe('cn-2');
  });

  it('nextChange returns null past last change', () => {
    const result = service.nextChange(uri, 55);
    expect(result).toBeNull();
  });

  it('previousChange returns change before current offset', () => {
    const result = service.previousChange(uri, 55);
    expect(result?.id).toBe('cn-3');
  });

  it('previousChange skips change containing current offset', () => {
    const result = service.previousChange(uri, 35);
    expect(result?.id).toBe('cn-1');
  });

  it('previousChange returns null before first change', () => {
    const result = service.previousChange(uri, 5);
    expect(result).toBeNull();
  });

  it('getChangeAtOffset returns change when inside range', () => {
    const result = service.getChangeAtOffset(uri, 15);
    expect(result?.id).toBe('cn-1');
  });

  it('getChangeAtOffset returns null when between changes', () => {
    const result = service.getChangeAtOffset(uri, 25);
    expect(result).toBeNull();
  });

  it('getChangeAtOffset returns null for unknown URI', () => {
    const result = service.getChangeAtOffset('file:///unknown.md', 15);
    expect(result).toBeNull();
  });

  it('updateCursorContext fires event on boundary crossing', () => {
    const listener = vi.fn();
    service.onDidChangeCursorContext.event(listener);

    service.updateCursorContext(uri, 15); // enter cn-1
    expect(listener).toHaveBeenCalledWith({ uri, change: expect.objectContaining({ id: 'cn-1' }) });

    listener.mockClear();
    service.updateCursorContext(uri, 25); // leave cn-1
    expect(listener).toHaveBeenCalledWith({ uri, change: null });
  });

  it('updateCursorContext does not fire when staying in same change', () => {
    const listener = vi.fn();
    service.onDidChangeCursorContext.event(listener);

    service.updateCursorContext(uri, 15); // enter cn-1
    listener.mockClear();
    service.updateCursorContext(uri, 18); // still in cn-1
    expect(listener).not.toHaveBeenCalled();
  });
});
