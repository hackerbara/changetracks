import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { spawnDetachedTool } from './office-tools.js';

export const MCP_PORT = 39990;
export const MCP_SCHEME = process.env.CHANGEDOWN_MCP_REQUIRE_HTTPS === '1' || process.env.CHANGEDOWN_MCP_USE_HTTPS === '1' ? 'https' : 'http';
export const MCP_BASE_URL = `${MCP_SCHEME}://127.0.0.1:${MCP_PORT}`;
export const MCP_HEALTH_URL = `${MCP_BASE_URL}/health`;
export const HOSTED_ORIGIN = 'https://changedown.com';

export interface HealthResult {
  ok: boolean;
  service?: string;
  error?: string;
}

function requestModuleForScheme(scheme: 'http' | 'https'): typeof http | typeof https {
  return scheme === 'https' ? https : http;
}

function requestOptions(scheme: 'http' | 'https', path: string, timeoutMs: number, extra: Record<string, unknown> = {}): http.RequestOptions | https.RequestOptions {
  return {
    hostname: '127.0.0.1',
    port: MCP_PORT,
    path,
    timeout: timeoutMs,
    ...(scheme === 'https' ? { rejectUnauthorized: false } : {}),
    ...extra,
  };
}

export function probeMcpHealth(timeoutMs = 1500, scheme: 'http' | 'https' = MCP_SCHEME): Promise<HealthResult> {
  return new Promise((resolve) => {
    const client = requestModuleForScheme(scheme);
    const req = client.get(requestOptions(scheme, '/health', timeoutMs), (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw) as { service?: string };
          resolve({ ok: res.statusCode === 200 && parsed.service === 'changedown-mcp', service: parsed.service });
        } catch (err) {
          resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

export function preflightMcpFromOrigin(origin: string, pathname = '/backend/register', timeoutMs = 1500, scheme: 'http' | 'https' = MCP_SCHEME): Promise<Record<string, string | string[] | undefined>> {
  return new Promise((resolve, reject) => {
    const client = requestModuleForScheme(scheme);
    const req = client.request(requestOptions(scheme, pathname, timeoutMs, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
        'Access-Control-Request-Private-Network': 'true',
      },
    }), (res) => {
      res.resume();
      res.on('end', () => resolve(res.headers));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

export function preflightMcp(pathname = '/backend/register', timeoutMs = 1500, scheme: 'http' | 'https' = MCP_SCHEME): Promise<Record<string, string | string[] | undefined>> {
  return preflightMcpFromOrigin(HOSTED_ORIGIN, pathname, timeoutMs, scheme);
}

export async function waitForMcpHealth(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const health = await probeMcpHealth();
    if (health.ok) return;
    last = health.error ?? 'unhealthy';
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`changedown-mcp did not become healthy at ${MCP_HEALTH_URL}: ${last}`);
}

export function resolveMcpCommand(cwd: string, explicit?: string): { command: string; args: string[] } | undefined {
  if (explicit) return { command: explicit, args: [] };
  if (process.env.CHANGEDOWN_MCP_BIN) return { command: process.env.CHANGEDOWN_MCP_BIN, args: [] };

  const localDist = path.join(cwd, 'changedown-plugin', 'mcp-server', 'dist', 'index.js');
  if (fs.existsSync(localDist)) return { command: process.execPath, args: [localDist] };

  return undefined;
}

export function mcpStartGuidance(scheme: 'http' | 'https' = 'https'): string {
  const transport =
    scheme === 'https'
      ? 'over HTTPS'
      : 'in diagnostic HTTP loopback mode';
  return `Start your configured agent (or restart it) to launch ChangeDown MCP ${transport}; the Word pane can load now and will auto-connect when the agent starts MCP.`;
}

export async function startMcpIfNeeded(cwd: string, explicit: string | undefined, dryRun = false): Promise<{ owned: boolean; child?: ChildProcess }> {
  const resolved = resolveMcpCommand(cwd, explicit);
  if (!resolved) {
    if (!dryRun) {
      const existing = await probeMcpHealth();
      if (existing.ok) {
        console.log(`changedown-mcp already healthy at ${MCP_HEALTH_URL}; reusing it.`);
        return { owned: false };
      }
    }

    console.log(mcpStartGuidance());
    return { owned: false };
  }

  if (dryRun) {
    console.log(`[dry-run] probe ${MCP_HEALTH_URL}; start if missing: CHANGEDOWN_PANE_ORIGINS=${HOSTED_ORIGIN} ${resolved.command} ${resolved.args.join(' ')}`);
    return { owned: false };
  }

  const existing = await probeMcpHealth();
  if (existing.ok) {
    console.log(`changedown-mcp already healthy at ${MCP_HEALTH_URL}; reusing it.`);
    return { owned: false };
  }

  console.log(`Starting changedown-mcp on ${MCP_HEALTH_URL}...`);
  const child = spawnDetachedTool(resolved.command, resolved.args, {
    cwd,
    env: {
      CHANGEDOWN_PANE_MODE: 'hosted',
      CHANGEDOWN_PANE_ORIGINS: `${HOSTED_ORIGIN},https://www.changedown.com`,
      CHANGEDOWN_MCP_REQUIRE_HTTPS: '1',
    },
  });
  await waitForMcpHealth();
  return { owned: true, child };
}
