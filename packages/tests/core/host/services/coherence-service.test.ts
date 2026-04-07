import { describe, it, expect, vi } from 'vitest';
import { CoherenceService } from '@changedown/core/host';

describe('CoherenceService', () => {
  it('stores and retrieves coherence state', () => {
    const service = new CoherenceService();
    service.update('file:///a.md', 85, 3, 70);
    const state = service.getCoherence('file:///a.md');
    expect(state).toEqual({ rate: 85, unresolvedCount: 3, threshold: 70 });
  });

  it('returns undefined for unknown URI', () => {
    const service = new CoherenceService();
    expect(service.getCoherence('file:///unknown.md')).toBeUndefined();
  });

  it('fires onDidChangeCoherence event on update', () => {
    const service = new CoherenceService();
    const listener = vi.fn();
    service.onDidChangeCoherence(listener);
    service.update('file:///a.md', 90, 1, 70);
    expect(listener).toHaveBeenCalledWith({
      uri: 'file:///a.md', rate: 90, unresolvedCount: 1, threshold: 70,
    });
  });

  it('removes state', () => {
    const service = new CoherenceService();
    service.update('file:///a.md', 100, 0, 70);
    service.remove('file:///a.md');
    expect(service.getCoherence('file:///a.md')).toBeUndefined();
  });

  it('disposes without error', () => {
    const service = new CoherenceService();
    expect(() => service.dispose()).not.toThrow();
  });
});
