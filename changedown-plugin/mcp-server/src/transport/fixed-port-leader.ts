// changedown-plugin/mcp-server/src/transport/fixed-port-leader.ts
import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const DEV_CERT_DIR = path.join(os.homedir(), '.office-addin-dev-certs');
const DEV_CERT_REPAIR_COMMAND = 'npx office-addin-dev-certs install';

export const SERVICE_NAME = 'changedown-mcp';

/**
 * Load the local office-addin-dev-certs cert + key for explicit HTTPS fallback
 * mode. The normal hosted-pane npx path uses loopback HTTP so users do not need
 * local developer certificates. HTTPS remains available for dev/diagnostic
 * runs and environments whose WebView blocks public-origin → HTTP loopback.
 */
function loadDevCertOptions(): { cert: Buffer; key: Buffer } | undefined {
  const dir = DEV_CERT_DIR;
  const certPath = path.join(dir, 'localhost.crt');
  const keyPath = path.join(dir, 'localhost.key');
  const caPath = path.join(dir, 'ca.crt');
  try {
    // Serve the full chain (leaf + CA) as a PEM bundle. WKWebView requires
    // the chain to validate; serving only the leaf causes silent TLS
    // handshake failures (openssl reports "unable to verify the first
    // certificate"). webpack-dev-server already does this implicitly via
    // office-addin-dev-certs.getHttpsServerOptions().
    const leaf = fs.readFileSync(certPath);
    const ca = fs.readFileSync(caPath);
    const bundle = Buffer.concat([leaf, Buffer.from('\n'), ca]);
    return { cert: bundle, key: fs.readFileSync(keyPath) };
  } catch {
    return undefined;
  }
}

export class PortConflictError extends Error {
  constructor(public readonly port: number, public readonly service: string) {
    super(
      `PortConflictError: port ${port} is held by a different service ("${service}"). ` +
      `Free the port or configure a different one.`
    );
    this.name = 'PortConflictError';
  }
}

export class HttpsRequiredError extends Error {
  constructor() {
    super(
      'HTTPS is required for hosted Word pane mode, but this server is configured to use HTTP or Office add-in dev certificates were not found. ' +
      `Expected localhost.crt, localhost.key, and ca.crt under ${DEV_CERT_DIR}. ` +
      `Run \`${DEV_CERT_REPAIR_COMMAND}\`, trust the generated certificates if prompted, then start changedown-mcp again.`
    );
    this.name = 'HttpsRequiredError';
  }
}

export interface BindOrForwardOptions {
  /**
   * Require the fixed-port host/client URL to be HTTPS. This is an explicit
   * fallback/dev mode; the hosted-pane npx path defaults to loopback HTTP to
   * avoid local certificate installation. Defaults to CHANGEDOWN_MCP_REQUIRE_HTTPS.
   */
  requireHttps?: boolean;
  /**
   * Test/dev override for the protocol choice. Leave undefined in production
   * so dev cert availability controls whether HTTPS is used.
   */
  useHttps?: boolean;
}

export interface HealthResponse {
  service: string;
  version: string;
  capabilities: string[];
}

export type HostResult = {
  mode: 'host';
  server: http.Server;
};

export type ClientResult = {
  mode: 'client';
  hostUrl: string;
  /** Call once; resolves with a new LeaderResult when the client is promoted to host. */
  startHeartbeat: (opts?: { intervalMs?: number; failThreshold?: number }) => Promise<LeaderResult>;
};

export type LeaderResult = HostResult | ClientResult;

/**
 * HTTP is the default for the hosted-pane npx path. HTTPS remains available via
 * CHANGEDOWN_MCP_REQUIRE_HTTPS=1 or CHANGEDOWN_MCP_USE_HTTPS=1.
 */
const devCerts = loadDevCertOptions();

function envRequiresHttps(): boolean {
  const requireHttps = process.env.CHANGEDOWN_MCP_REQUIRE_HTTPS?.toLowerCase();
  return requireHttps === '1' || requireHttps === 'true';
}

function shouldRequireHttps(options: BindOrForwardOptions | undefined): boolean {
  return options?.requireHttps ?? envRequiresHttps();
}

function resolveUseHttps(options: BindOrForwardOptions | undefined): boolean {
  const forceHttp = process.env.CHANGEDOWN_MCP_USE_HTTP?.toLowerCase();
  if (forceHttp === '1' || forceHttp === 'true') return false;

  const forceHttps = process.env.CHANGEDOWN_MCP_USE_HTTPS?.toLowerCase();
  if (forceHttps === '1' || forceHttps === 'true') return true;

  return options?.useHttps ?? false;
}

function assertCanBindHttps(bindWithHttps: boolean): void {
  if (bindWithHttps && !devCerts) {
    throw new HttpsRequiredError();
  }
}

/** URL scheme the server binds / clients probe on by default. */
export const SCHEME = 'http';

async function probeHealth(port: number, probeWithHttps = false): Promise<HealthResponse> {
  return new Promise((resolve, reject) => {
    const getter = probeWithHttps ? https.get : http.get;
    const req = getter(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        timeout: 2000,
        // Self-signed dev cert — we trust the loopback address, not the chain.
        rejectUnauthorized: false,
      },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => { raw += c.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(raw) as HealthResponse); }
          catch { reject(new Error('Invalid JSON from /health')); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('health probe timeout')); });
  });
}

function tryBind(port: number, bindWithHttps = false): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = bindWithHttps
      ? https.createServer({ cert: devCerts!.cert, key: devCerts!.key })
      : http.createServer();

    // Log every connection attempt (even ones that fail TLS handshake) so we
    // can distinguish "pane never tries" from "pane tries, server rejects".
    server.on('connection', (sock) => {
      console.error(`[pane-endpoint] TCP connect from ${sock.remoteAddress}:${sock.remotePort}`);
    });
    if (bindWithHttps) {
      (server as https.Server).on('tlsClientError', (err, sock) => {
        console.error(
          `[pane-endpoint] TLS handshake failed from ${sock.remoteAddress}:${sock.remotePort}: ${err.message}`,
        );
      });
    }

    server.listen(port, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function makeHeartbeat(
  hostUrl: string,
  defaults: { intervalMs: number; failThreshold: number },
  bindOptions: BindOrForwardOptions,
): (override?: { intervalMs?: number; failThreshold?: number }) => Promise<LeaderResult> {
  return (override) =>
    new Promise((resolve) => {
      const opts = {
        intervalMs: override?.intervalMs ?? defaults.intervalMs,
        failThreshold: override?.failThreshold ?? defaults.failThreshold,
      };
      const hostPort = parseInt(new URL(hostUrl).port, 10);
      let failures = 0;
      let inFlight = false;
      const timer = setInterval(async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          await probeHealth(hostPort, new URL(hostUrl).protocol === 'https:');
          failures = 0;
        } catch {
          failures++;
          if (failures >= opts.failThreshold) {
            clearInterval(timer);
            try {
              const promoted = await bindOrForward(hostPort, bindOptions);
              resolve(promoted);
            } catch {
              // Port grabbed by another client racing us — become client again
              const raced = await bindOrForward(hostPort, bindOptions);
              resolve(raced);
            }
          }
        } finally {
          inFlight = false;
        }
      }, opts.intervalMs);
    });
}

export async function bindOrForward(port: number, options: BindOrForwardOptions = {}): Promise<LeaderResult> {
  const requireHttps = shouldRequireHttps(options);
  if (requireHttps && options.useHttps === false) {
    throw new HttpsRequiredError();
  }
  const bindWithHttps = requireHttps ? true : resolveUseHttps(options);

  if (requireHttps && !devCerts) {
    try {
      const health = await probeHealth(port, true);
      if (health.service !== SERVICE_NAME) {
        throw new PortConflictError(port, health.service);
      }
      const hostUrl = `https://127.0.0.1:${port}`;
      const startHeartbeat = makeHeartbeat(hostUrl, {
        intervalMs: 2_000,
        failThreshold: 2,
      }, options);
      return { mode: 'client', hostUrl, startHeartbeat };
    } catch (err) {
      if (err instanceof PortConflictError) throw err;
      throw new HttpsRequiredError();
    }
  }

  try {
    assertCanBindHttps(bindWithHttps);
    const server = await tryBind(port, bindWithHttps);

    // Stdio MCP convention: parent (Claude Code) closes stdin to signal
    // shutdown. The HTTP server keeps the event loop alive so a plain stdin
    // EOF won't exit the process — explicitly tear down the server when stdin
    // ends. Clients don't need this: they have no http.Server holding the loop.
    process.stdin.on('end', () => {
      server.close(() => process.exit(0));
      // Hard-exit fallback so we don't linger on stuck connections. SSE streams
      // hold sockets open indefinitely; server.close() waits for them all.
      setTimeout(() => process.exit(0), 1000).unref();
    });
    process.stdin.on('error', () => process.exit(0));
    // Ensure stdin is in flowing mode so the 'end' event fires. The MCP SDK
    // reads stdin for the protocol channel, so this is belt-and-suspenders.
    process.stdin.resume();

    return { mode: 'host', server };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EADDRINUSE') throw err;

    // Port is taken — check who holds it
    let health: HealthResponse;
    try {
      health = await probeHealth(port, requireHttps ? true : bindWithHttps);
    } catch {
      throw new PortConflictError(port, '<unreachable — not an HTTP server>');
    }

    if (health.service !== SERVICE_NAME) {
      throw new PortConflictError(port, health.service);
    }

    const scheme = requireHttps || bindWithHttps ? 'https' : 'http';
    const hostUrl = `${scheme}://127.0.0.1:${port}`;
    // Aggressive takeover: new MCP launches snap to leader role within ~5s of
    // previous leader exiting (2s poll × 2 misses = ~4s worst case).
    const HEARTBEAT_INTERVAL_MS = 2_000;
    const HEARTBEAT_MISS_THRESHOLD = 2;
    const startHeartbeat = makeHeartbeat(hostUrl, {
      intervalMs: HEARTBEAT_INTERVAL_MS,
      failThreshold: HEARTBEAT_MISS_THRESHOLD,
    }, options);
    return { mode: 'client', hostUrl, startHeartbeat };
  }
}
