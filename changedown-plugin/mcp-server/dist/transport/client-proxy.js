// src/transport/client-proxy.ts
import * as http from "node:http";
import * as https from "node:https";
import { createInterface } from "node:readline";
function parseEnvelope(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function hasRequestId(envelope) {
  return Object.prototype.hasOwnProperty.call(envelope, "id");
}
function writeError(stdout, id, message) {
  stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32603, message }
  }) + "\n");
}
async function postToHost(hostUrl, body, sessionId) {
  const url = new URL("/mcp", hostUrl);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
    // MCP Streamable HTTP transport requires both content types in Accept
    "Accept": "application/json, text/event-stream"
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const isHttps = url.protocol === "https:";
  return new Promise((resolve, reject) => {
    const requester = isHttps ? https.request : http.request;
    const req = requester(
      {
        hostname: url.hostname,
        port: parseInt(url.port, 10),
        path: url.pathname,
        method: "POST",
        headers,
        // Self-signed loopback dev cert; trust the address, not the chain.
        rejectUnauthorized: false
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          const newSid = res.headers["mcp-session-id"] ?? null;
          resolve({ status: res.statusCode ?? 0, sessionId: newSid, body: raw });
        });
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}
async function startClientProxy(opts) {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const hostUrl = opts.hostUrl;
  let sessionId = null;
  let stopped = false;
  const closeCallbacks = [];
  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    if (stopped || !line.trim()) return;
    const envelope = parseEnvelope(line);
    const isRequest = hasRequestId(envelope);
    try {
      const result = await postToHost(hostUrl, line, sessionId);
      if (result.sessionId) sessionId = result.sessionId;
      const body = result.body.trim();
      if (result.status < 200 || result.status >= 300) {
        if (isRequest) {
          writeError(stdout, envelope.id, `MCP host returned HTTP ${result.status}${body ? `: ${body}` : ""}`);
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
      stdout.write(body + "\n");
    } catch (err) {
      if (isRequest) {
        writeError(stdout, envelope.id, String(err));
      } else {
        console.error(`[changedown] MCP notification proxy failed: ${String(err)}`);
      }
    }
  });
  rl.on("close", () => {
    stopped = true;
    for (const cb of closeCallbacks) cb();
  });
  return {
    stop() {
      stopped = true;
      rl.close();
    },
    onClose(cb) {
      closeCallbacks.push(cb);
    }
  };
}
export {
  startClientProxy
};
//# sourceMappingURL=client-proxy.js.map
