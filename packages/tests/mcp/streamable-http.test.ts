// packages/tests/mcp/streamable-http.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { attachStreamableHttp, type StreamableHttpHandle } from '@changedown/mcp/transport/streamable-http';

const TEST_PORT = 39993;

// Six tool names the plan specifies the transport must surface
const EXPECTED_TOOLS = [
  'propose_change',
  'review_changes',
  'read_tracked_file',
  'amend_change',
  'list_changes',
  'supersede_change',
];

async function postMcp(port: number, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // MCP spec requires Accept to include both application/json and text/event-stream
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
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

describe('attachStreamableHttp', () => {
  let mcpServer: Server;
  let httpServer: http.Server;
  let handle: StreamableHttpHandle;

  beforeEach(async () => {
    mcpServer = new Server(
      { name: 'changedown', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    // Fix: the bare Server has no ListToolsRequestSchema handler, so the
    // tools/list test would error. Register stub handlers for the 6 expected
    // tools so the test can verify the transport wires them correctly.
    // (Test-authoring gap in the plan — noted in task report.)
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: EXPECTED_TOOLS.map((name) => ({ name, description: `stub ${name}`, inputSchema: { type: 'object' as const, properties: {} } })),
    }));

    httpServer = http.createServer();
    handle = await attachStreamableHttp(mcpServer, httpServer);
    httpServer.on('request', handle.handleHttpRequest);
    await new Promise<void>((res) => httpServer.listen(TEST_PORT, '127.0.0.1', res));
  });

  afterEach(async () => {
    handle.detach();
    // closeAllConnections() forcibly destroys keep-alive sockets so the port
    // is released before the next beforeEach binds to the same port.
    httpServer.closeAllConnections?.();
    await new Promise<void>((res) => httpServer.close(() => res()));
  });

  it('POST /mcp with initialize returns 200 and Mcp-Session-Id header', async () => {
    const resp = await postMcp(TEST_PORT, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.1' },
      },
    });
    expect(resp.status).toBe(200);
    expect(resp.headers['mcp-session-id']).toBeTruthy();
  });

  it('two concurrent sessions get independent Mcp-Session-Id values', async () => {
    const initPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.1' },
      },
    };
    const [r1, r2] = await Promise.all([
      postMcp(TEST_PORT, initPayload),
      postMcp(TEST_PORT, initPayload),
    ]);
    expect(r1.headers['mcp-session-id']).toBeTruthy();
    expect(r2.headers['mcp-session-id']).toBeTruthy();
    expect(r1.headers['mcp-session-id']).not.toBe(r2.headers['mcp-session-id']);
  });

  it('tools/list returns at least the 6 listed tools', async () => {
    // Initialize first
    const initResp = await postMcp(TEST_PORT, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.1' },
      },
    });
    const sessionId = initResp.headers['mcp-session-id'] as string;

    const listResp = await postMcp(TEST_PORT,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { 'Mcp-Session-Id': sessionId }
    );
    expect(listResp.status).toBe(200);
    const parsed = JSON.parse(listResp.body) as { result?: { tools: Array<{ name: string }> } };
    const names = parsed.result?.tools.map((t) => t.name) ?? [];
    expect(names).toContain('propose_change');
    expect(names).toContain('review_changes');
    expect(names).toContain('read_tracked_file');
    expect(names).toContain('amend_change');
    expect(names).toContain('list_changes');
    expect(names).toContain('supersede_change');
  });

  it('request without Mcp-Session-Id after initialize returns 400', async () => {
    const resp = await postMcp(TEST_PORT, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    // No session header — server must reject
    expect(resp.status).toBe(400);
  });

  it('GET /mcp/events/:sessionId opens an SSE stream', async () => {
    // Initialize to get a session
    const initResp = await postMcp(TEST_PORT, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.1' },
      },
    });
    const sessionId = initResp.headers['mcp-session-id'] as string;

    // Open SSE stream
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: `/mcp/events/${sessionId}`,
          headers: { Accept: 'text/event-stream' },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          res.destroy(); // we just need to confirm the header
          resolve();
        }
      );
      req.on('error', reject);
    });
  });
});
