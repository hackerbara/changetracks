// packages/tests/mcp/fixed-port-leader.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { bindOrForward, HttpsRequiredError } from '@changedown/mcp/transport/fixed-port-leader';

// Helper: spin up a fake "other changedown-mcp" that owns a port
function fakeChangedownHost(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          service: 'changedown-mcp',
          version: '0.1.0',
          capabilities: ['backend-register', 'mcp-streamable'],
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// Helper: spin up a fake server that returns a non-changedown /health response
function fakeOtherHost(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ service: 'some-other-app' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

const TEST_PORT = 39991; // use a different port so real 39990 is untouched in CI

describe('bindOrForward', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it('hosted pane mode allows the default HTTP loopback path', async () => {
    const originalPaneMode = process.env.CHANGEDOWN_PANE_MODE;
    try {
      process.env.CHANGEDOWN_PANE_MODE = 'hosted';
      const result = await bindOrForward(TEST_PORT, { useHttps: false });
      expect(result.mode).toBe('host');
      if (result.mode === 'host') servers.push(result.server);
    } finally {
      if (originalPaneMode === undefined) delete process.env.CHANGEDOWN_PANE_MODE;
      else process.env.CHANGEDOWN_PANE_MODE = originalPaneMode;
    }
  });

  it('explicit HTTPS-required fallback refuses HTTP', async () => {
    await expect(bindOrForward(TEST_PORT, { useHttps: false, requireHttps: true })).rejects.toBeInstanceOf(HttpsRequiredError);
  });

  it('returns {mode: "host"} and a bound server when port is free', async () => {
    const result = await bindOrForward(TEST_PORT, { useHttps: false, requireHttps: false });
    expect(result.mode).toBe('host');
    if (result.mode === 'host') {
      servers.push(result.server);
      const addr = result.server.address() as AddressInfo;
      expect(addr.port).toBe(TEST_PORT);
      expect(addr.address).toBe('127.0.0.1');
    }
  });

  it('returns {mode: "client", hostUrl} when a changedown-mcp already holds the port', async () => {
    const fake = await fakeChangedownHost(TEST_PORT);
    servers.push(fake);

    const result = await bindOrForward(TEST_PORT, { useHttps: false, requireHttps: false });
    expect(result.mode).toBe('client');
    if (result.mode === 'client') {
      expect(result.hostUrl).toBe(`http://127.0.0.1:${TEST_PORT}`);
    }
  });

  it('throws PortConflictError when the port holder is NOT a changedown-mcp', async () => {
    const fake = await fakeOtherHost(TEST_PORT);
    servers.push(fake);

    await expect(bindOrForward(TEST_PORT, { useHttps: false, requireHttps: false })).rejects.toThrow('PortConflictError');
  });

  it('client heartbeat: two consecutive health failures trigger re-bind attempt', async () => {
    // Start as client pointing at a fake host
    const fake = await fakeChangedownHost(TEST_PORT);
    servers.push(fake);

    const clientResult = await bindOrForward(TEST_PORT, { useHttps: false, requireHttps: false });
    expect(clientResult.mode).toBe('client');
    if (clientResult.mode !== 'client') return;

    // Kill the fake host
    await closeServer(fake);
    servers.splice(servers.indexOf(fake), 1);

    // startHeartbeat returns a promise that resolves with a new LeaderResult
    // when two consecutive failures are detected and re-bind succeeds
    const promoted = await clientResult.startHeartbeat({ intervalMs: 50, failThreshold: 2 });
    expect(promoted.mode).toBe('host');
    if (promoted.mode === 'host') {
      servers.push(promoted.server);
    }
  }, 5000);

  it('host: registers stdin-close handlers that close the server and call process.exit', async () => {
    // Bind as host; this attaches the stdin handlers.
    // Do NOT push to `servers` — we manage the server lifecycle manually here
    // so afterEach doesn't double-close it (which would re-fire the process.exit callback).
    const result = await bindOrForward(TEST_PORT, { useHttps: false, requireHttps: false });
    expect(result.mode).toBe('host');
    if (result.mode !== 'host') return;

    // Capture stdin listeners added by bindOrForward so we can remove them cleanly.
    const stdinEndListeners = process.stdin.listeners('end').slice();
    const stdinErrorListeners = process.stdin.listeners('error').slice();

    // Mock process.exit BEFORE emitting 'end' so the close-callback doesn't
    // actually exit — and keep the mock alive until the server finishes closing.
    const exitCalls: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls.push(code ?? 0);
    }) as any);

    // Emit 'end' on stdin to simulate parent (Claude Code) pipe closure.
    // The handler calls server.close(cb) where cb calls process.exit(0).
    // Wait for the server to finish closing so the callback has a chance to fire.
    const serverClosed = new Promise<void>(resolve => result.server.once('close', resolve));
    process.stdin.emit('end');
    await serverClosed;

    // process.exit(0) should have been called from inside server.close callback
    expect(exitCalls).toContain(0);

    // Clean up stdin listeners added by bindOrForward
    process.stdin.removeAllListeners('end');
    process.stdin.removeAllListeners('error');
    for (const l of stdinEndListeners) process.stdin.on('end', l as (...args: unknown[]) => void);
    for (const l of stdinErrorListeners) process.stdin.on('error', l as (...args: unknown[]) => void);
    exitSpy.mockRestore();
  });
});
