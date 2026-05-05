// packages/tests/mcp/bootstrap-mode-select.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as path from 'node:path';

const MCP_BIN = path.resolve(
  process.cwd(),
  '../../changedown-plugin/mcp-server/dist/index.js',
);
const TEST_PORT = 39997;

function waitForLine(proc: ChildProcess, pattern: RegExp, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for pattern: ${pattern}`)), timeoutMs);
    const check = (chunk: Buffer) => {
      const line = chunk.toString();
      if (pattern.test(line)) {
        clearTimeout(timer);
        proc.stderr!.removeListener('data', check);
        resolve(line.trim());
      }
    };
    proc.stderr!.on('data', check);
  });
}

async function probeHealth(): Promise<{ service: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: TEST_PORT, path: '/health', timeout: 2000 },
      (res) => {
        let raw = '';
        res.on('data', (c: string) => { raw += c; });
        res.on('end', () => resolve(JSON.parse(raw) as { service: string }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('health timeout')); });
  });
}

describe('bootstrap mode-select', () => {
  const procs: ChildProcess[] = [];

  afterEach(async () => {
    const exits = procs.map((p) => new Promise<void>((resolve) => {
      if (p.exitCode !== null || p.signalCode !== null) {
        resolve();
        return;
      }
      p.once('exit', () => resolve());
      try { p.kill('SIGTERM'); } catch { resolve(); }
      setTimeout(() => {
        if (p.exitCode === null && p.signalCode === null) {
          try { p.kill('SIGKILL'); } catch { /* already exited */ }
        }
        resolve();
      }, 1000).unref();
    }));
    await Promise.all(exits);
    procs.length = 0;
    // Allow the test port to free up
    await new Promise((res) => setTimeout(res, 300));
  });

  function childEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      CHANGEDOWN_PROJECT_DIR: '/tmp',
      CHANGEDOWN_MCP_PORT: String(TEST_PORT),
      CHANGEDOWN_MCP_USE_HTTP: '1',
    };
  }

  it('first process becomes host and /health responds with changedown-mcp identity', async () => {
    const proc = spawn(process.execPath, [MCP_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(),
    });
    procs.push(proc);

    // Wait for host to log its ready message
    await waitForLine(proc, new RegExp(`host mode.*${TEST_PORT}|running.*${TEST_PORT}`, 'i'));

    const health = await probeHealth();
    expect(health.service).toBe('changedown-mcp');
  }, 10000);

  it('second process detects host and logs client mode', async () => {
    const host = spawn(process.execPath, [MCP_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(),
    });
    procs.push(host);
    await waitForLine(host, new RegExp(`host mode.*${TEST_PORT}|running.*${TEST_PORT}`, 'i'));

    const client = spawn(process.execPath, [MCP_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(),
    });
    procs.push(client);
    await waitForLine(client, new RegExp(`client mode.*${TEST_PORT}`, 'i'));
    expect(true).toBe(true);
  }, 15000);

  it('client process can respond to a tools/list call on stdio while host holds the port', async () => {
    const host = spawn(process.execPath, [MCP_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(),
    });
    procs.push(host);
    await waitForLine(host, new RegExp(`host mode.*${TEST_PORT}|running.*${TEST_PORT}`, 'i'));

    const client = spawn(process.execPath, [MCP_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(),
    });
    procs.push(client);
    await waitForLine(client, new RegExp(`client mode.*${TEST_PORT}`, 'i'));

    // Send initialize then tools/list on the client's stdin
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    client.stdin!.write(init + '\n');

    // Read the initialize response
    const initLine = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for initialize response')), 5000);
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('"id":1')) {
          clearTimeout(timer);
          client.stdout!.removeListener('data', onData);
          resolve(text.trim());
        }
      };
      client.stdout!.on('data', onData);
    });
    expect(initLine).toContain('"result"');

    const listMsg = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    client.stdin!.write(listMsg + '\n');

    const listLine = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for tools/list response')), 5000);
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('"id":2')) {
          clearTimeout(timer);
          client.stdout!.removeListener('data', onData);
          resolve(text.trim());
        }
      };
      client.stdout!.on('data', onData);
    });
    const parsed = JSON.parse(listLine) as { result?: { tools: Array<{ name: string }> } };
    expect(parsed.result?.tools.map((t) => t.name)).toContain('propose_change');
  }, 20000);
});
