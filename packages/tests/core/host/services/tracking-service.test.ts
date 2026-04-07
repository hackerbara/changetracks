import { describe, it, expect, vi } from 'vitest';
import { TrackingService } from '@changedown/core/host';

describe('TrackingService', () => {
  describe('tracking state', () => {
    it('tracking is disabled by default', () => {
      const service = new TrackingService();
      expect(service.isTrackingEnabled('file:///test.md')).toBe(false);
    });

    it('enables and disables tracking per URI', () => {
      const service = new TrackingService();
      service.setTrackingEnabled('file:///test.md', true);
      expect(service.isTrackingEnabled('file:///test.md')).toBe(true);
      service.setTrackingEnabled('file:///test.md', false);
      expect(service.isTrackingEnabled('file:///test.md')).toBe(false);
    });

    it('toggles tracking', () => {
      const service = new TrackingService();
      service.setTrackingEnabled('file:///test.md', true);
      service.toggleTracking('file:///test.md');
      expect(service.isTrackingEnabled('file:///test.md')).toBe(false);
    });

    it('fires onDidChangeTrackingState', () => {
      const service = new TrackingService();
      const handler = vi.fn();
      service.onDidChangeTrackingState(handler);
      service.setTrackingEnabled('file:///test.md', true);
      expect(handler).toHaveBeenCalledWith({ uri: 'file:///test.md', enabled: true });
    });

    it('does not fire when state does not change', () => {
      const service = new TrackingService();
      service.setTrackingEnabled('file:///test.md', true);
      const handler = vi.fn();
      service.onDidChangeTrackingState(handler);
      service.setTrackingEnabled('file:///test.md', true);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('crystallization', () => {
    it('does not process changes when tracking is disabled', () => {
      const service = new TrackingService();
      const handler = vi.fn();
      service.onDidCrystallize(handler);

      const processed = service.handleContentChange(
        'file:///test.md', 'insertion', 0, 'Hello', '', 'Hello',
      );
      expect(processed).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('routes changes to PEM when tracking is enabled', () => {
      const service = new TrackingService({ pauseThresholdMs: 0 });
      service.setTrackingEnabled('file:///test.md', true);

      const processed = service.handleContentChange(
        'file:///test.md', 'insertion', 0, 'H', '', 'H',
      );
      expect(processed).toBe(true);
    });

    it('expectEcho/consumeEcho delegates to PEM', () => {
      const service = new TrackingService();
      service.setTrackingEnabled('file:///test.md', true);

      service.expectEcho('file:///test.md');
      const processed = service.handleContentChange(
        'file:///test.md', 'insertion', 0, 'echo', '', 'echo',
      );
      expect(processed).toBe(false);
    });

    it('closeDocument cleans up PEM and tracking state', () => {
      const service = new TrackingService();
      service.setTrackingEnabled('file:///test.md', true);
      expect(service.isTrackingEnabled('file:///test.md')).toBe(true);

      service.closeDocument('file:///test.md');
      expect(service.isTrackingEnabled('file:///test.md')).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('dispose prevents further event emission', () => {
      const service = new TrackingService();
      const handler = vi.fn();
      service.onDidChangeTrackingState(handler);
      service.dispose();
      service.toggleTracking('file:///test.md');
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
