// packages/tests/mcp/client-proxy.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { Readable, Writable, PassThrough } from 'node:stream';
import { startClientProxy, type ClientProxyHandle } from '@changedown/mcp/transport/client-proxy';

const PROXY_TEST_PORT = 39994;

// Minimal fake host: echoes POST /mcp back with a session id on initialize,
// and serves /health for heartbeat.
function makeFakeHost(port: number): Promise<http.Server> {
  let sessionCounter = 0;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ service: 'changedown-mcp', version: '0.1.0', capabilities: ['mcp-streamable'] }));
        return;
      }
      if (req.url === '/mcp' && req.method === 'POST') {
        let body = '';
        req.on('data', (c: string) => { body += c; });
        req.on('end', () => {
          const env = JSON.parse(body) as { method?: string; id?: number };
          const isInit = env.method === 'initialize';
          const isInitializedNotification = env.method === 'notifications/initialized';
          const sid = `test-session-${++sessionCounter}`;
          const responseHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
          if (isInit) responseHeaders['Mcp-Session-Id'] = sid;
          if (isInitializedNotification) {
            res.writeHead(202, responseHeaders);
            res.end();
            return;
          }
          res.writeHead(200, responseHeaders);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: env.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function closeServer(s: http.Server): Promise<void> {
  return new Promise((resolve) => s.close(() => resolve()));
}

describe('startClientProxy', () => {
  const servers: http.Server[] = [];
  const handles: ClientProxyHandle[] = [];

  afterEach(async () => {
    for (const h of handles) h.stop();
    handles.length = 0;
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it('initialize from parent stdio is forwarded to host /mcp and response appears on stdout', async () => {
    const fake = await makeFakeHost(PROXY_TEST_PORT);
    servers.push(fake);

    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const handle = await startClientProxy({
      hostUrl: `http://127.0.0.1:${PROXY_TEST_PORT}`,
      stdin: stdin as unknown as Readable,
      stdout: stdout as unknown as Writable,
    });
    handles.push(handle);

    // Write an initialize request to stdin
    const initMsg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    stdin.write(initMsg + '\n');

    // Wait for response on stdout
    const responseText = await new Promise<string>((resolve) => {
      let buf = '';
      stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        if (buf.includes('\n')) resolve(buf.trim());
      });
    });

    const parsed = JSON.parse(responseText) as { jsonrpc: string; id: number; result?: unknown };
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(1);
    expect(parsed.result).toBeTruthy();
  });

  it('stdin EOF causes the proxy to exit cleanly', async () => {
    const fake = await makeFakeHost(PROXY_TEST_PORT);
    servers.push(fake);

    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const handle = await startClientProxy({
      hostUrl: `http://127.0.0.1:${PROXY_TEST_PORT}`,
      stdin: stdin as unknown as Readable,
      stdout: stdout as unknown as Writable,
    });
    handles.push(handle);

    const closed = new Promise<void>((resolve) => handle.onClose(resolve));
    stdin.end(); // EOF
    await expect(closed).resolves.toBeUndefined();
  });

  it('does not write a blank stdout frame for notification responses with empty HTTP bodies', async () => {
    const fake = await makeFakeHost(PROXY_TEST_PORT);
    servers.push(fake);

    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const handle = await startClientProxy({
      hostUrl: `http://127.0.0.1:${PROXY_TEST_PORT}`,
      stdin: stdin as unknown as Readable,
      stdout: stdout as unknown as Writable,
    });
    handles.push(handle);

    const chunks: string[] = [];
    stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chunks.join('')).toBe('');
  });

  it('synthesizes a JSON-RPC error when a request receives an empty HTTP body', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/mcp' && req.method === 'POST') {
        req.resume();
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(PROXY_TEST_PORT, '127.0.0.1', resolve);
      server.on('error', reject);
    });
    servers.push(server);

    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const handle = await startClientProxy({
      hostUrl: `http://127.0.0.1:${PROXY_TEST_PORT}`,
      stdin: stdin as unknown as Readable,
      stdout: stdout as unknown as Writable,
    });
    handles.push(handle);

    const response = new Promise<string>((resolve) => {
      stdout.once('data', (chunk: Buffer) => resolve(chunk.toString().trim()));
    });

    stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/list',
      params: {},
    }) + '\n');

    const parsed = JSON.parse(await response) as { id: number; error?: { message: string } };
    expect(parsed.id).toBe(9);
    expect(parsed.error?.message).toContain('empty response body');
  });
});
