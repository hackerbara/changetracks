import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewService } from '@changedown/core/host/services';
import { type LspConnection, type Disposable, type ReviewResult } from '@changedown/core/host';

function createMockConnection(): LspConnection & { _handlers: Map<string, Function> } {
  const handlers = new Map<string, Function>();
  return {
    sendRequest: vi.fn(),
    sendNotification: vi.fn(),
    onNotification: vi.fn((method: string, handler: Function) => {
      handlers.set(method, handler);
      return { dispose: () => handlers.delete(method) } as Disposable;
    }),
    _handlers: handlers,
  };
}

describe('ReviewService', () => {
  let conn: ReturnType<typeof createMockConnection>;
  let service: ReviewService;

  beforeEach(() => {
    conn = createMockConnection();
    service = new ReviewService(conn);
  });

  it('acceptChange sends reviewChange request with accept decision', async () => {
    const edits = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'hello' }];
    (conn.sendRequest as any).mockResolvedValue({ edits });

    const listener = vi.fn();
    service.onDidCompleteReview.event(listener);

    await service.acceptChange('file:///a.md', 'cn-1', { reason: 'looks good' });

    expect(conn.sendRequest).toHaveBeenCalledWith('changedown/reviewChange', {
      textDocument: { uri: 'file:///a.md' },
      changeId: 'cn-1',
      decision: 'accept',
      reason: 'looks good',
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      uri: 'file:///a.md',
      success: true,
      edits,
    }));
  });

  it('rejectChange sends reviewChange request with reject decision', async () => {
    (conn.sendRequest as any).mockResolvedValue({ edits: [] });

    await service.rejectChange('file:///a.md', 'cn-1');

    expect(conn.sendRequest).toHaveBeenCalledWith('changedown/reviewChange', {
      textDocument: { uri: 'file:///a.md' },
      changeId: 'cn-1',
      decision: 'reject',
      reason: undefined,
    });
  });

  it('acceptAll sends reviewAll request', async () => {
    (conn.sendRequest as any).mockResolvedValue({ edits: [] });

    await service.acceptAll('file:///a.md');

    expect(conn.sendRequest).toHaveBeenCalledWith('changedown/reviewAll', {
      textDocument: { uri: 'file:///a.md' },
      decision: 'accept',
    });
  });

  it('rejectAll sends reviewAll request with reject', async () => {
    (conn.sendRequest as any).mockResolvedValue({ edits: [] });

    await service.rejectAll('file:///a.md');

    expect(conn.sendRequest).toHaveBeenCalledWith('changedown/reviewAll', {
      textDocument: { uri: 'file:///a.md' },
      decision: 'reject',
    });
  });

  it('fires onReviewError on transport failure', async () => {
    (conn.sendRequest as any).mockRejectedValue(new Error('connection lost'));

    const errorListener = vi.fn();
    service.onReviewError.event(errorListener);

    await service.acceptChange('file:///a.md', 'cn-1');

    expect(errorListener).toHaveBeenCalledWith({
      uri: 'file:///a.md',
      message: 'connection lost',
    });
  });

  it('amendChange sends amendChange request', async () => {
    (conn.sendRequest as any).mockResolvedValue({ edits: [] });

    await service.amendChange('file:///a.md', 'cn-1', 'updated text');

    expect(conn.sendRequest).toHaveBeenCalledWith('changedown/amendChange', {
      textDocument: { uri: 'file:///a.md' },
      changeId: 'cn-1',
      newText: 'updated text',
    });
  });
});
