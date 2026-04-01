import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackingService } from '@changedown/core/host/services';
import { type LspConnection, type Disposable } from '@changedown/core/host';

function createMockConnection(): LspConnection & {
  _handlers: Map<string, Function>;
  _simulate(method: string, params: unknown): void;
} {
  const handlers = new Map<string, Function>();
  return {
    sendRequest: vi.fn(),
    sendNotification: vi.fn(),
    onNotification: vi.fn((method: string, handler: Function) => {
      handlers.set(method, handler);
      return { dispose: () => handlers.delete(method) } as Disposable;
    }),
    _handlers: handlers,
    _simulate(method: string, params: unknown) { handlers.get(method)?.(params); },
  };
}

describe('TrackingService', () => {
  let conn: ReturnType<typeof createMockConnection>;
  let service: TrackingService;

  beforeEach(() => {
    conn = createMockConnection();
    service = new TrackingService(conn);
  });

  it('defaults to tracking disabled for unknown URIs', () => {
    expect(service.isTrackingEnabled('file:///a.md')).toBe(false);
  });

  it('toggleTracking flips state and sends notification', () => {
    service.toggleTracking('file:///a.md');
    expect(service.isTrackingEnabled('file:///a.md')).toBe(true);
    expect(conn.sendNotification).toHaveBeenCalledWith(
      'changedown/setDocumentState',
      expect.objectContaining({ textDocument: { uri: 'file:///a.md' } }),
    );
  });

  it('toggleTracking twice returns to disabled', () => {
    service.toggleTracking('file:///a.md');
    service.toggleTracking('file:///a.md');
    expect(service.isTrackingEnabled('file:///a.md')).toBe(false);
  });

  it('setTrackingEnabled sets explicit state', () => {
    service.setTrackingEnabled('file:///a.md', true);
    expect(service.isTrackingEnabled('file:///a.md')).toBe(true);
  });

  it('fires onDidChangeTrackingState on toggle', () => {
    const listener = vi.fn();
    service.onDidChangeTrackingState.event(listener);
    service.toggleTracking('file:///a.md');
    expect(listener).toHaveBeenCalledWith({ uri: 'file:///a.md', enabled: true });
  });

  it('updates state from LSP documentState notification', () => {
    conn._simulate('changedown/documentState', {
      textDocument: { uri: 'file:///a.md' },
      tracking: { enabled: true, source: 'header' },
    });
    expect(service.isTrackingEnabled('file:///a.md')).toBe(true);
  });

  it('fires event on LSP documentState notification', () => {
    const listener = vi.fn();
    service.onDidChangeTrackingState.event(listener);
    conn._simulate('changedown/documentState', {
      textDocument: { uri: 'file:///a.md' },
      tracking: { enabled: true, source: 'header' },
    });
    expect(listener).toHaveBeenCalledWith({ uri: 'file:///a.md', enabled: true });
  });

  it('dispose cleans up', () => {
    const listener = vi.fn();
    service.onDidChangeTrackingState.event(listener);
    service.dispose();
    service.toggleTracking('file:///a.md');
    expect(listener).not.toHaveBeenCalled();
  });
});
