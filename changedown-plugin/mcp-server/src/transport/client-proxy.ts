// changedown-plugin/mcp-server/src/transport/client-proxy.ts
import * as http from 'node:http';
import * as https from 'node:https';
import { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';

export interface ClientProxyOptions {
  hostUrl: string;
  stdin?: Readable;
  stdout?: Writable;
}

export interface ClientProxyHandle {
  stop(): void;
  onClose(cb: () => void): void;
}

type JsonRpcEnvelope = {
  id?: unknown;
  method?: unknown;
};

function parseEnvelope(line: string): JsonRpcEnvelope {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as JsonRpcEnvelope : {};
  } catch {
    return {};
  }
}

function hasRequestId(envelope: JsonRpcEnvelope): boolean {
  return Object.prototype.hasOwnProperty.call(envelope, 'id');
}

function writeError(stdout: Writable, id: unknown, message: string): void {
  stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32603, message },
  }) + '\n');
}

async function postToHost(
  hostUrl: string,
  body: string,
  sessionId: string | null,
): Promise<{ status: number; sessionId: string | null; body: string }> {
  const url = new URL('/mcp', hostUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body)),
    // MCP Streamable HTTP transport requires both content types in Accept
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const isHttps = url.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const requester = isHttps ? https.request : http.request;
    const req = requester(
      {
        hostname: url.hostname,
        port: parseInt(url.port, 10),
        path: url.pathname,
        method: 'POST',
        headers,
        // Self-signed loopback dev cert; trust the address, not the chain.
        rejectUnauthorized: false,
      },
      (res) => {
        let raw = '';
        res.on('data', (c: string) => { raw += c; });
        res.on('end', () => {
          const newSid = (res.headers['mcp-session-id'] as string | undefined) ?? null;
          resolve({ status: res.statusCode ?? 0, sessionId: newSid, body: raw });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Starts a client-mode stdio↔HTTP proxy.
 *
 * Reads newline-delimited JSON-RPC from `stdin` (defaults to process.stdin),
 * forwards each message to `hostUrl/mcp`, and writes responses to `stdout`
 * (defaults to process.stdout).
 *
 * Session state (Mcp-Session-Id) is maintained across messages: the first
 * `initialize` response provides the session id; all subsequent messages carry it.
 */
export async function startClientProxy(opts: ClientProxyOptions): Promise<ClientProxyHandle> {
  const stdin: Readable = opts.stdin ?? process.stdin;
  const stdout: Writable = opts.stdout ?? process.stdout;
  const hostUrl = opts.hostUrl;

  let sessionId: string | null = null;
  let stopped = false;
  const closeCallbacks: Array<() => void> = [];

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });

  rl.on('line', async (line: string) => {
    if (stopped || !line.trim()) return;
    const envelope = parseEnvelope(line);
    const isRequest = hasRequestId(envelope);
    try {
      const result = await postToHost(hostUrl, line, sessionId);
      if (result.sessionId) sessionId = result.sessionId;

      const body = result.body.trim();
      if (result.status < 200 || result.status >= 300) {
        if (isRequest) {
          writeError(stdout, envelope.id, `MCP host returned HTTP ${result.status}${body ? `: ${body}` : ''}`);
        } else if (body) {
          console.error(`[changedown] MCP notification proxy got HTTP ${result.status}: ${body}`);
        }
        return;
      }

      if (!body) {
        if (isRequest) {
          writeError(stdout, envelope.id, `MCP host returned HTTP ${result.status} with empty response body`);
        }
        return;
      }

      stdout.write(body + '\n');
    } catch (err) {
      if (isRequest) {
        writeError(stdout, envelope.id, String(err));
      } else {
        console.error(`[changedown] MCP notification proxy failed: ${String(err)}`);
      }
    }
  });

  rl.on('close', () => {
    stopped = true;
    for (const cb of closeCallbacks) cb();
  });

  return {
    stop() {
      stopped = true;
      rl.close();
    },
    onClose(cb: () => void) {
      closeCallbacks.push(cb);
    },
  };
}
