// packages/tests/mcp/pane-endpoint.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { attachPaneEndpoints, type PaneEndpointHandle } from '@changedown/mcp/transport/pane-endpoint';
import { attachStreamableHttp } from '@changedown/mcp/transport/streamable-http';

function closeServer(s: http.Server): Promise<void> {
  return new Promise((resolve) => {
    s.closeAllConnections();
    s.close(() => resolve());
  });
}

async function httpGet(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, headers: { Connection: 'close', ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c: string) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw }));
    });
    req.on('error', reject);
  });
}

async function httpPost(port: number, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Connection: 'close', ...headers },
      },
      (res) => {
        let raw = '';
        res.on('data', (c: string) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

async function httpOptions(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'OPTIONS',
        headers: { Connection: 'close', ...headers },
      },
      (res) => {
        let raw = '';
        res.on('data', (c: string) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('pane-endpoint', () => {
  let httpServer: http.Server;
  let handle: PaneEndpointHandle;
  let paneTestPort: number;

  beforeEach(async () => {
    httpServer = http.createServer();
    handle = attachPaneEndpoints(httpServer);
    httpServer.on('request', handle.handleHttpRequest);
    await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', res));
    paneTestPort = (httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    handle.detach();
    await closeServer(httpServer);
  });

  describe('sendRequest timeout', () => {
    let timeoutServer: http.Server;
    let timeoutHandle: PaneEndpointHandle;
    let timeoutTestPort: number;

    beforeEach(async () => {
      timeoutServer = http.createServer();
      timeoutHandle = attachPaneEndpoints(timeoutServer, { requestTimeoutMs: 200 });
      timeoutServer.on('request', timeoutHandle.handleHttpRequest);
      await new Promise<void>((res) => timeoutServer.listen(0, '127.0.0.1', res));
      timeoutTestPort = (timeoutServer.address() as { port: number }).port;
    });

    afterEach(async () => {
      timeoutHandle.detach();
      await closeServer(timeoutServer);
    });

    it('sendRequest rejects with timeout error when pane never responds', async () => {
      // Register a pane
      const regResp = await httpPost(timeoutTestPort, '/backend/register', {
        scheme: 'word', sessionId: 'sess-timeout-test', capabilities: ['read', 'write'],
      });
      const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

      // Open the SSE stream (don't close it — we want the stream open but no response POSTed)
      const sseReq = http.get(
        { hostname: '127.0.0.1', port: timeoutTestPort, path: `/backend/stream/${registrationId}`, headers: { Accept: 'text/event-stream' } },
        (_res) => { /* keep stream open, never respond */ },
      );

      // Give the stream a moment to establish before calling sendRequest
      await new Promise<void>((res) => setTimeout(res, 20));

      const t0 = Date.now();
      await expect(
        timeoutHandle.sendRequest(registrationId, 'applyChange', {}),
      ).rejects.toThrow(/timed out after 200 ms.*method: applyChange/);
      const elapsed = Date.now() - t0;

      // Should have rejected promptly (well under vitest's outer timeout)
      expect(elapsed).toBeLessThan(800);

      sseReq.destroy();
    }, 2000 /* vitest per-test timeout — must be > requestTimeoutMs but much less than default */);
  });

  describe('poll-rpc fallback transport', () => {
    let pollServer: http.Server;
    let pollHandle: PaneEndpointHandle;
    let pollPort: number;

    beforeEach(async () => {
      pollServer = http.createServer();
      pollHandle = attachPaneEndpoints(pollServer, { requestTimeoutMs: 500 });
      pollServer.on('request', pollHandle.handleHttpRequest);
      await new Promise<void>((res) => pollServer.listen(0, '127.0.0.1', res));
      pollPort = (pollServer.address() as { port: number }).port;
    });

    afterEach(async () => {
      pollHandle.detach();
      await closeServer(pollServer);
    });

    it('delivers a host request through /backend/poll and resolves from /backend/response', async () => {
      const regResp = await httpPost(pollPort, '/backend/register', {
        scheme: 'word',
        sessionId: 'sess-poll-rpc',
        capabilities: ['read', 'poll-rpc'],
      });
      const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

      const requestPromise = pollHandle.sendRequest(registrationId, 'read', { uri: 'word://sess-poll-rpc' });
      const pollResp = await httpGet(pollPort, `/backend/poll/${registrationId}`);
      expect(pollResp.status).toBe(200);
      const polled = JSON.parse(pollResp.body) as { id: string; method: string; params: Record<string, unknown> };
      expect(polled).toMatchObject({
        method: 'read',
        params: { uri: 'word://sess-poll-rpc' },
      });

      await httpPost(pollPort, `/backend/response/${registrationId}`, {
        id: polled.id,
        ok: true,
        result: { text: 'hello', format: 'L2', version: '1' },
      });

      await expect(requestPromise).resolves.toEqual({ text: 'hello', format: 'L2', version: '1' });
    });

    it('accepts POST /backend/poll because the Word pane polls with POST', async () => {
      const regResp = await httpPost(pollPort, '/backend/register', {
        scheme: 'word',
        sessionId: 'sess-poll-post',
        capabilities: ['read', 'poll-rpc'],
      });
      const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

      const requestPromise = pollHandle.sendRequest(registrationId, 'read', { transport: 'post' });
      const pollResp = await httpPost(pollPort, `/backend/poll/${registrationId}`, {});
      expect(pollResp.status).toBe(200);
      const polled = JSON.parse(pollResp.body) as { id: string; method: string; params: Record<string, unknown> };
      expect(polled).toMatchObject({
        method: 'read',
        params: { transport: 'post' },
      });

      await httpPost(pollPort, `/backend/response/${registrationId}`, {
        id: polled.id,
        ok: true,
        result: { ok: true },
      });
      await expect(requestPromise).resolves.toEqual({ ok: true });
    });

    it('times out idle polls with 204 and still delivers the next request to a fresh poll', async () => {
      const regResp = await httpPost(pollPort, '/backend/register', {
        scheme: 'word',
        sessionId: 'sess-poll-timeout',
        capabilities: ['read', 'poll-rpc'],
      });
      const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

      const idlePoll = await httpPost(pollPort, `/backend/poll/${registrationId}`, {});
      expect(idlePoll.status).toBe(204);

      const requestPromise = pollHandle.sendRequest(registrationId, 'read', { after: 'idle-timeout' });
      const freshPoll = await httpPost(pollPort, `/backend/poll/${registrationId}`, {});
      expect(freshPoll.status).toBe(200);
      const polled = JSON.parse(freshPoll.body) as { id: string; params: Record<string, unknown> };
      expect(polled.params).toEqual({ after: 'idle-timeout' });

      await httpPost(pollPort, `/backend/response/${registrationId}`, {
        id: polled.id,
        ok: true,
        result: { delivered: true },
      });
      await expect(requestPromise).resolves.toEqual({ delivered: true });
    }, 2000);

    it('keeps poll delivery available even when an SSE stream is also open', async () => {
      const regResp = await httpPost(pollPort, '/backend/register', {
        scheme: 'word',
        sessionId: 'sess-poll-with-sse',
        capabilities: ['read', 'poll-rpc'],
      });
      const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

      const sseReq = http.get(
        {
          hostname: '127.0.0.1',
          port: pollPort,
          path: `/backend/stream/${registrationId}`,
          headers: { Accept: 'text/event-stream' },
        },
        () => {},
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const requestPromise = pollHandle.sendRequest(registrationId, 'read', { uri: 'word://sess-poll-with-sse' });
      const pollResp = await httpGet(pollPort, `/backend/poll/${registrationId}`);
      expect(pollResp.status).toBe(200);
      const polled = JSON.parse(pollResp.body) as { id: string; method: string };
      expect(polled.method).toBe('read');

      await httpPost(pollPort, `/backend/response/${registrationId}`, {
        id: polled.id,
        ok: true,
        result: { text: 'fallback', format: 'L2', version: '1' },
      });

      await expect(requestPromise).resolves.toEqual({ text: 'fallback', format: 'L2', version: '1' });
      sseReq.destroy();
    });

    it('does not redeliver an already-polled request before the pane response arrives', async () => {
      const regResp = await httpPost(pollPort, '/backend/register', {
        scheme: 'word',
        sessionId: 'sess-poll-once',
        capabilities: ['read', 'poll-rpc'],
      });
      const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

      const requestPromise = pollHandle.sendRequest(registrationId, 'read', { seq: 1 });
      const firstPoll = await httpGet(pollPort, `/backend/poll/${registrationId}`);
      expect(firstPoll.status).toBe(200);
      const { id } = JSON.parse(firstPoll.body) as { id: string };

      // No redelivery should happen while the first request is already marked
      // delivered. The next poll is held open and fulfilled by the next host
      // request rather than receiving request #1 again.
      const secondPollPromise = httpGet(pollPort, `/backend/poll/${registrationId}`);
      const secondRequestPromise = pollHandle.sendRequest(registrationId, 'read', { seq: 2 });
      const secondPoll = await secondPollPromise;
      expect(secondPoll.status).toBe(200);
      const second = JSON.parse(secondPoll.body) as { id: string; params: Record<string, unknown> };
      expect(second.id).not.toBe(id);
      expect(second.params).toEqual({ seq: 2 });

      await httpPost(pollPort, `/backend/response/${registrationId}`, {
        id,
        ok: true,
        result: { text: 'done', format: 'L2', version: '2' },
      });
      await httpPost(pollPort, `/backend/response/${registrationId}`, {
        id: second.id,
        ok: true,
        result: { text: 'second', format: 'L2', version: '3' },
      });

      await expect(requestPromise).resolves.toEqual({ text: 'done', format: 'L2', version: '2' });
      await expect(secondRequestPromise).resolves.toEqual({ text: 'second', format: 'L2', version: '3' });
    }, 1000);
  });

  it('GET /health returns service identity', async () => {
    const { status, body } = await httpGet(paneTestPort, '/health');
    expect(status).toBe(200);
    const parsed = JSON.parse(body) as { service: string; version: string; capabilities: string[] };
    expect(parsed.service).toBe('changedown-mcp');
    expect(parsed.capabilities).toContain('backend-register');
    expect(parsed.capabilities).toContain('mcp-streamable');
  });

  describe('CORS for hosted Word pane', () => {
    it('allows the hosted pane origin exactly and grants PNA only on allowed preflight requests', async () => {
      const { status, headers } = await httpOptions(paneTestPort, '/backend/register', {
        Origin: 'https://changedown.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
        'Access-Control-Request-Private-Network': 'true',
      });

      expect(status).toBe(204);
      expect(headers['access-control-allow-origin']).toBe('https://changedown.com');
      expect(headers.vary).toBe('Origin');
      expect(headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
      expect(headers['access-control-allow-headers']).toBe('Content-Type');
      expect(headers['access-control-max-age']).toBe('600');
      expect(headers['access-control-allow-private-network']).toBe('true');
    });

    it('allows local dev pane origins without wildcarding arbitrary loopback ports', async () => {
      const allowed = await httpOptions(paneTestPort, '/backend/register', {
        Origin: 'https://127.0.0.1:3000',
        'Access-Control-Request-Method': 'POST',
      });
      const wrongPort = await httpOptions(paneTestPort, '/backend/register', {
        Origin: 'https://127.0.0.1:5173',
        'Access-Control-Request-Method': 'POST',
      });

      expect(allowed.headers['access-control-allow-origin']).toBe('https://127.0.0.1:3000');
      expect(wrongPort.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('omits CORS and PNA headers for disallowed origins', async () => {
      const { status, headers } = await httpOptions(paneTestPort, '/backend/register', {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      });

      expect(status).toBe(204);
      expect(headers['access-control-allow-origin']).toBeUndefined();
      expect(headers['access-control-allow-private-network']).toBeUndefined();
    });

    it('applies exact CORS to POST and SSE responses from allowed origins', async () => {
      const regResp = await httpPost(paneTestPort, '/backend/register', {
        scheme: 'word', sessionId: 'sess-cors', capabilities: ['read'],
      }, { Origin: 'https://changedown.com' });
      const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

      expect(regResp.status).toBe(200);
      expect(regResp.headers['access-control-allow-origin']).toBe('https://changedown.com');

      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          {
            hostname: '127.0.0.1',
            port: paneTestPort,
            path: `/backend/stream/${registrationId}`,
            headers: { Accept: 'text/event-stream', Origin: 'https://changedown.com' },
          },
          (res) => {
            expect(res.statusCode).toBe(200);
            expect(res.headers['access-control-allow-origin']).toBe('https://changedown.com');
            expect(res.headers['content-type']).toMatch(/text\/event-stream/);
            res.destroy();
            resolve();
          },
        );
        req.on('error', reject);
      });
    });

    it('allows extra origins from CHANGEDOWN_PANE_ORIGINS', async () => {
      const original = process.env.CHANGEDOWN_PANE_ORIGINS;
      const envServer = http.createServer();
      let envHandle: PaneEndpointHandle | undefined;
      try {
        process.env.CHANGEDOWN_PANE_ORIGINS = 'https://preview.changedown.com, https://www.changedown.com/word/';
        envHandle = attachPaneEndpoints(envServer);
        envServer.on('request', envHandle.handleHttpRequest);
        await new Promise<void>((res) => envServer.listen(0, '127.0.0.1', res));
        const envPort = (envServer.address() as { port: number }).port;

        const preview = await httpOptions(envPort, '/backend/register', {
          Origin: 'https://preview.changedown.com',
          'Access-Control-Request-Method': 'POST',
        });
        const www = await httpOptions(envPort, '/backend/register', {
          Origin: 'https://www.changedown.com',
          'Access-Control-Request-Method': 'POST',
        });

        expect(preview.headers['access-control-allow-origin']).toBe('https://preview.changedown.com');
        expect(www.headers['access-control-allow-origin']).toBe('https://www.changedown.com');
      } finally {
        if (original === undefined) delete process.env.CHANGEDOWN_PANE_ORIGINS;
        else process.env.CHANGEDOWN_PANE_ORIGINS = original;
        envHandle?.detach();
        await closeServer(envServer);
      }
    });
  });

  it('POST /backend/register returns registrationId and keepaliveMs', async () => {
    const { status, body } = await httpPost(paneTestPort, '/backend/register', {
      scheme: 'word',
      sessionId: 'sess-abc123',
      capabilities: ['read', 'write'],
    });
    expect(status).toBe(200);
    const parsed = JSON.parse(body) as { registrationId: string; keepaliveMs: number };
    expect(parsed.registrationId).toBeTruthy();
    expect(parsed.keepaliveMs).toBeGreaterThan(0);
  });

  it('POST /backend/register rejects malformed payload without crashing the host', async () => {
    const bad = await httpPost(paneTestPort, '/backend/register', {
      sessionUri: 'word://wrong-field',
      capabilities: [],
    });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body)).toEqual({ error: 'invalid pane registration payload' });

    const health = await httpGet(paneTestPort, '/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ service: 'changedown-mcp' });
  });

  it('GET /backend/stream/:id opens SSE stream for registered backend', async () => {
    // Register first
    const regResp = await httpPost(paneTestPort, '/backend/register', {
      scheme: 'word', sessionId: 'sess-def456', capabilities: ['read'],
    });
    const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        { hostname: '127.0.0.1', port: paneTestPort, path: `/backend/stream/${registrationId}`, headers: { Accept: 'text/event-stream' } },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          res.destroy();
          resolve();
        }
      );
      req.on('error', reject);
    });
  });

  it('GET /backend/stream/:id returns 404 for unknown registrationId', async () => {
    const { status } = await httpGet(paneTestPort, '/backend/stream/nonexistent-id');
    expect(status).toBe(404);
  });

  it('POST /backend/response/:id returns 200 for a valid registrationId', async () => {
    const regResp = await httpPost(paneTestPort, '/backend/register', {
      scheme: 'word', sessionId: 'sess-ghi789', capabilities: ['read'],
    });
    const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

    const { status } = await httpPost(paneTestPort, `/backend/response/${registrationId}`, {
      id: '1',
      result: { text: 'hello', format: 'L3', version: '1' },
    });
    expect(status).toBe(200);
  });

  it('POST /backend/response/:id returns 404 for unknown registrationId', async () => {
    const { status } = await httpPost(paneTestPort, '/backend/response/bad-id', { id: '1', result: {} });
    expect(status).toBe(404);
  });

  describe('ok:false defense-in-depth guard', () => {
    /** Register a pane and open an SSE stream. Returns the registrationId and a
     *  Promise that resolves to the first non-ping SSE event data string. */
    async function registerAndOpenStream(sessionId: string): Promise<{
      registrationId: string;
      firstEventData: () => Promise<string>;
      destroyStream: () => void;
    }> {
      const regResp = await httpPost(paneTestPort, '/backend/register', {
        scheme: 'word', sessionId, capabilities: ['read'],
      });
      const { registrationId } = JSON.parse(regResp.body) as { registrationId: string };

      let resolveEvent!: (data: string) => void;
      const eventPromise = new Promise<string>((res) => { resolveEvent = res; });

      let sseReq!: http.ClientRequest;
      await new Promise<void>((resolve, reject) => {
        sseReq = http.get(
          {
            hostname: '127.0.0.1',
            port: paneTestPort,
            path: `/backend/stream/${registrationId}`,
            headers: { Accept: 'text/event-stream' },
          },
          (res) => {
            expect(res.statusCode).toBe(200);
            let buf = '';
            res.on('data', (chunk: string) => {
              buf += chunk;
              // Split on double-newline SSE boundaries; keep any incomplete trailing fragment
              const events = buf.split('\n\n');
              buf = events.pop() ?? '';
              for (const event of events) {
                const m = event.match(/^data: (.+)$/m);
                if (!m) continue;
                const parsed = JSON.parse(m[1]!) as { type?: string };
                // Skip keepalive pings — wait for a real request event
                if (parsed.type !== 'ping') {
                  resolveEvent(m[1]!);
                  break;
                }
              }
            });
            resolve();
          },
        );
        sseReq.on('error', reject);
      });

      return {
        registrationId,
        firstEventData: () => eventPromise,
        destroyStream: () => sseReq.destroy(),
      };
    }

    it('rejects with "pane indicated failure" when ok:false and no error field', async () => {
      const { registrationId, firstEventData, destroyStream } = await registerAndOpenStream('sess-ok-false-no-error');

      // Attach the rejection handler immediately to avoid unhandled-rejection warnings
      // before we get the id back and POST the response.
      const requestPromise = handle.sendRequest(registrationId, 'read', {});
      const assertionPromise = expect(requestPromise).rejects.toThrow(/pane indicated failure/i);

      // Extract the id from the SSE event the server emitted
      const rawData = await firstEventData();
      const { id } = JSON.parse(rawData) as { id: string };

      // POST ok:false with no error field
      await httpPost(paneTestPort, `/backend/response/${registrationId}`, { id, ok: false });

      await assertionPromise;

      destroyStream();
    });

    it('rejects with the error message when ok:false and error field is populated', async () => {
      const { registrationId, firstEventData, destroyStream } = await registerAndOpenStream('sess-ok-false-with-error');

      // Attach the rejection handler immediately to avoid unhandled-rejection warnings
      // before we get the id back and POST the response.
      const requestPromise = handle.sendRequest(registrationId, 'read', {});
      const assertionPromise = expect(requestPromise).rejects.toThrow(/boom/);

      const rawData = await firstEventData();
      const { id } = JSON.parse(rawData) as { id: string };

      // POST ok:false with an error field — existing behaviour
      await httpPost(paneTestPort, `/backend/response/${registrationId}`, { id, ok: false, error: 'boom' });

      await assertionPromise;

      destroyStream();
    });
  });

  describe('composed dispatcher regression (Bug D)', () => {
    let composedServer: http.Server;

    afterEach(async () => {
      if (composedServer) {
        composedServer.closeAllConnections?.();
        await new Promise<void>((res) => composedServer.close(() => res()));
      }
    });

    it('/health responds 200 with valid JSON when both transports are composed', async () => {
      composedServer = http.createServer();

      const mcpServer = new Server(
        { name: 'changedown', version: '0.1.0' },
        { capabilities: { tools: {} } },
      );

      const paneHandle = attachPaneEndpoints(composedServer);
      const httpHandle = await attachStreamableHttp(mcpServer, composedServer);

      // Composed dispatcher: mirrors what index.ts wires in production.
      composedServer.on('request', (req, res) => {
        const url = req.url ?? '';
        if (url.startsWith('/mcp')) {
          httpHandle.handleHttpRequest(req, res);
        } else {
          paneHandle.handleHttpRequest(req, res);
        }
      });

      await new Promise<void>((res) => composedServer.listen(0, '127.0.0.1', res));
      const composedTestPort = (composedServer.address() as { port: number }).port;

      const { status, body } = await httpGet(composedTestPort, '/health');
      expect(status).toBe(200);
      expect(JSON.parse(body)).toMatchObject({ service: 'changedown-mcp' });

      paneHandle.detach();
      httpHandle.detach();
    });
  });
});
