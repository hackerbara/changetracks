#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repo = process.cwd();
const configPath = path.join(repo, 'changedown-plugin', 'codex.mcp.json');
const configDir = path.dirname(configPath);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const server = config.mcpServers.cd;
const cwd = path.resolve(configDir, server.cwd ?? '.');
const child = spawn(server.command, server.args, {
  cwd,
  env: {
    ...process.env,
    CHANGEDOWN_PROJECT_DIR: repo,
    CHANGEDOWN_MCP_PORT: process.env.CHANGEDOWN_MCP_PORT ?? '40219',
    CHANGEDOWN_MCP_USE_HTTP: '1'
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
let nextId = 1;
const pending = new Map();
let buffer = '';
let childClosed = false;
let failing = false;

child.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  stdout += text;
  buffer += text;
  while (true) {
    const idx = buffer.indexOf('\n');
    if (idx === -1) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      void fail(`Invalid JSON from MCP stdout: ${line}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
      const slot = pending.get(msg.id);
      if (slot) {
        pending.delete(msg.id);
        slot.resolve(msg);
      }
    }
  }
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8');
});

child.on('close', () => {
  childClosed = true;
});

child.on('exit', (code, signal) => {
  for (const [, slot] of pending) {
    slot.reject(new Error(`MCP exited before response: code=${code} signal=${signal}\nstderr=${stderr}`));
  }
  pending.clear();
});

function waitForChildClose(timeoutMs) {
  if (childClosed) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref();

    function finish(closed) {
      clearTimeout(timeout);
      child.off('close', onClose);
      resolve(closed);
    }

    function onClose() {
      finish(true);
    }

    child.once('close', onClose);
  });
}

async function cleanupChild() {
  if (childClosed) return;

  try { child.kill('SIGTERM'); } catch {}
  if (await waitForChildClose(1500)) return;

  try { child.kill('SIGKILL'); } catch {}
  await waitForChildClose(500);
}

async function fail(message) {
  if (failing) return;
  failing = true;

  await cleanupChild();
  console.error(message);
  if (stderr) console.error(`--- stderr ---\n${stderr}`);
  if (stdout) console.error(`--- stdout ---\n${stdout}`);
  process.exit(1);
}

function send(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(JSON.stringify(payload) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 5000).unref();
  });
}

function notify(method, params = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

try {
  const init = await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'changedown-codex-smoke', version: '0.0.0' }
  });
  if (init.error) await fail(`initialize failed: ${JSON.stringify(init.error)}`);

  notify('notifications/initialized');

  const tools = await send('tools/list', {});
  if (tools.error) await fail(`tools/list failed: ${JSON.stringify(tools.error)}`);

  const names = tools.result?.tools?.map((tool) => tool.name) ?? [];
  const expected = [
    'read_tracked_file',
    'propose_change',
    'review_changes',
    'amend_change',
    'list_changes',
    'supersede_change',
    'resolve_thread'
  ];
  const missing = expected.filter((name) => !names.includes(name));
  if (missing.length) await fail(`Missing tools: ${missing.join(', ')}`);

  await cleanupChild();
  console.log(`Codex MCP smoke passed (${names.length} tools)`);
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
