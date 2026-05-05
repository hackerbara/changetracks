import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { attachPaneEndpoints, type PaneEndpointHandle } from '@changedown/mcp/transport/pane-endpoint';
import type { BackendEvent } from '@changedown/core/backend';

function closeServer(s: http.Server): Promise<void> {
  return new Promise((resolve) => {
    s.closeAllConnections();
    s.close(() => resolve());
  });
}

async function httpPost(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'close',
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c: string) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** Like httpPost but sends `rawBody` as-is (no JSON.stringify), for testing malformed input. */
async function httpPostRaw(
  port: number,
  path: string,
  rawBody: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody),
          Connection: 'close',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c: string) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    req.end(rawBody);
  });
}

describe('pane→host notification round-trip', () => {
  let httpServer: http.Server;
  let handle: PaneEndpointHandle;
  let registrationId: string;
  let notifyTestPort: number;

  beforeEach(async () => {
    httpServer = http.createServer();
    handle = attachPaneEndpoints(httpServer);
    httpServer.on('request', handle.handleHttpRequest);
    await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', res));
    notifyTestPort = (httpServer.address() as { port: number }).port;

    // Register a backend so we have a valid registrationId to notify against.
    const regResp = await httpPost(notifyTestPort, '/backend/register', {
      scheme: 'word',
      sessionId: 'sess-roundtrip-test',
      capabilities: ['subscribe'],
    });
    const parsed = JSON.parse(regResp.body) as { registrationId: string };
    registrationId = parsed.registrationId;
  });

  afterEach(async () => {
    handle.detach();
    await closeServer(httpServer);
  });

  it('POST to /backend/notify/:id triggers onPaneNotification listener with the event payload', async () => {
    const received: BackendEvent[] = [];
    handle.onPaneNotification(registrationId, (event) => received.push(event));

    const { status } = await httpPost(
      notifyTestPort,
      `/backend/notify/${registrationId}`,
      { event: { kind: 'document_changed', version: '42' } },
    );

    expect(status).toBe(204);
    expect(received).toHaveLength(1);
    expect(received[0]!.kind).toBe('document_changed');
  });

  it('POST to /backend/notify/:id with unknown registrationId returns 404', async () => {
    const { status } = await httpPost(
      notifyTestPort,
      '/backend/notify/no-such-id',
      { event: { kind: 'document_changed', version: '1' } },
    );

    expect(status).toBe(404);
  });

  it('POST to /backend/notify/:id with malformed JSON body returns 400', async () => {
    const { status } = await httpPostRaw(
      notifyTestPort,
      `/backend/notify/${registrationId}`,
      '{not json',
    );

    expect(status).toBe(400);
  });

  it('onPaneNotification with unknown registrationId returns a no-op Disposable; cb is never invoked', async () => {
    const received: BackendEvent[] = [];

    // Subscribe against an id that was never registered.
    const disposable = handle.onPaneNotification('no-such-reg', (event) => received.push(event));

    // Fire a real notification against the valid registrationId so we know the
    // emitter path is exercised — the cb for 'no-such-reg' must not be called.
    const realReceived: BackendEvent[] = [];
    handle.onPaneNotification(registrationId, (e) => realReceived.push(e));

    const { status } = await httpPost(
      notifyTestPort,
      `/backend/notify/${registrationId}`,
      { event: { kind: 'document_changed', version: '77' } },
    );

    expect(status).toBe(204);
    expect(realReceived).toHaveLength(1);   // real listener fired
    expect(received).toHaveLength(0);       // unknown-id cb was never called

    // dispose() must be idempotent and must not throw.
    expect(() => disposable.dispose()).not.toThrow();
    expect(() => disposable.dispose()).not.toThrow();

    // Disposing the no-op Disposable must not have removed the real listener.
    const { status: status2 } = await httpPost(
      notifyTestPort,
      `/backend/notify/${registrationId}`,
      { event: { kind: 'document_changed', version: '78' } },
    );
    expect(status2).toBe(204);
    expect(realReceived).toHaveLength(2);   // still receiving — real listener intact
  });

  it('onPaneNotification listener is not called after the registration is removed', async () => {
    const received: BackendEvent[] = [];
    handle.onPaneNotification(registrationId, (event) => received.push(event));

    // Unregister by calling detach (which calls removeRegistration for all IDs)
    // then re-attach so afterEach detach still works on a fresh handle.
    handle.detach();
    handle = attachPaneEndpoints(httpServer);

    // Attempt to POST a notification for the now-removed registrationId — should 404.
    const { status } = await httpPost(
      notifyTestPort,
      `/backend/notify/${registrationId}`,
      { event: { kind: 'document_changed', version: '99' } },
    );

    // 404 because the registration is gone; listener should never have fired.
    expect(status).toBe(404);
    expect(received).toHaveLength(0);
  });
});
