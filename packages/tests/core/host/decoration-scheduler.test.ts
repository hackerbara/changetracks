// packages/tests/core/host/decoration-scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecorationScheduler } from '@changedown/core/host';

describe('DecorationScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('schedule fires after debounce period', () => {
    const update = vi.fn();
    const scheduler = new DecorationScheduler(update);
    scheduler.schedule('file:///a.md');
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(update).toHaveBeenCalledWith('file:///a.md');
  });

  it('coalesces rapid calls to same URI', () => {
    const update = vi.fn();
    const scheduler = new DecorationScheduler(update);
    scheduler.schedule('file:///a.md');
    scheduler.schedule('file:///a.md');
    scheduler.schedule('file:///a.md');
    vi.advanceTimersByTime(50);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('separate URIs get separate timers', () => {
    const update = vi.fn();
    const scheduler = new DecorationScheduler(update);
    scheduler.schedule('file:///a.md');
    scheduler.schedule('file:///b.md');
    vi.advanceTimersByTime(50);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('updateNow cancels a pending scheduled timer', () => {
    const update = vi.fn();
    const scheduler = new DecorationScheduler(update);
    scheduler.schedule('file:///a.md');
    scheduler.updateNow('file:///a.md');
    vi.advanceTimersByTime(100);
    expect(update).toHaveBeenCalledTimes(1); // fired once (immediately), not twice
  });

  it('updateNow fires immediately', () => {
    const update = vi.fn();
    const scheduler = new DecorationScheduler(update);
    scheduler.updateNow('file:///a.md');
    expect(update).toHaveBeenCalledWith('file:///a.md');
  });

  it('dispose cancels pending timers', () => {
    const update = vi.fn();
    const scheduler = new DecorationScheduler(update);
    scheduler.schedule('file:///a.md');
    scheduler.dispose();
    vi.advanceTimersByTime(100);
    expect(update).not.toHaveBeenCalled();
  });
});
