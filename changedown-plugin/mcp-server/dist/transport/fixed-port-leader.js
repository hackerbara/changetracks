// src/transport/fixed-port-leader.ts
import * as http from "node:http";
import * as https from "node:https";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
var DEV_CERT_DIR = path.join(os.homedir(), ".office-addin-dev-certs");
var DEV_CERT_REPAIR_COMMAND = "npx office-addin-dev-certs install";
var SERVICE_NAME = "changedown-mcp";
function loadDevCertOptions() {
  const dir = DEV_CERT_DIR;
  const certPath = path.join(dir, "localhost.crt");
  const keyPath = path.join(dir, "localhost.key");
  const caPath = path.join(dir, "ca.crt");
  try {
    const leaf = fs.readFileSync(certPath);
    const ca = fs.readFileSync(caPath);
    const bundle = Buffer.concat([leaf, Buffer.from("\n"), ca]);
    return { cert: bundle, key: fs.readFileSync(keyPath) };
  } catch {
    return void 0;
  }
}
var PortConflictError = class extends Error {
  constructor(port, service) {
    super(
      `PortConflictError: port ${port} is held by a different service ("${service}"). Free the port or configure a different one.`
    );
    this.port = port;
    this.service = service;
    this.name = "PortConflictError";
  }
};
var HttpsRequiredError = class extends Error {
  constructor() {
    super(
      `HTTPS is required for hosted Word pane mode, but this server is configured to use HTTP or Office add-in dev certificates were not found. Expected localhost.crt, localhost.key, and ca.crt under ${DEV_CERT_DIR}. Run \`${DEV_CERT_REPAIR_COMMAND}\`, trust the generated certificates if prompted, then start changedown-mcp again.`
    );
    this.name = "HttpsRequiredError";
  }
};
var devCerts = loadDevCertOptions();
function envRequiresHttps() {
  const requireHttps = process.env.CHANGEDOWN_MCP_REQUIRE_HTTPS?.toLowerCase();
  return requireHttps === "1" || requireHttps === "true";
}
function shouldRequireHttps(options) {
  return options?.requireHttps ?? envRequiresHttps();
}
function resolveUseHttps(options) {
  const forceHttp = process.env.CHANGEDOWN_MCP_USE_HTTP?.toLowerCase();
  if (forceHttp === "1" || forceHttp === "true") return false;
  const forceHttps = process.env.CHANGEDOWN_MCP_USE_HTTPS?.toLowerCase();
  if (forceHttps === "1" || forceHttps === "true") return true;
  return options?.useHttps ?? false;
}
function assertCanBindHttps(bindWithHttps) {
  if (bindWithHttps && !devCerts) {
    throw new HttpsRequiredError();
  }
}
var SCHEME = "http";
async function probeHealth(port, probeWithHttps = false) {
  return new Promise((resolve, reject) => {
    const getter = probeWithHttps ? https.get : http.get;
    const req = getter(
      {
        hostname: "127.0.0.1",
        port,
        path: "/health",
        timeout: 2e3,
        // Self-signed dev cert — we trust the loopback address, not the chain.
        rejectUnauthorized: false
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c.toString();
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error("Invalid JSON from /health"));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("health probe timeout"));
    });
  });
}
function tryBind(port, bindWithHttps = false) {
  return new Promise((resolve, reject) => {
    const server = bindWithHttps ? https.createServer({ cert: devCerts.cert, key: devCerts.key }) : http.createServer();
    server.on("connection", (sock) => {
      console.error(`[pane-endpoint] TCP connect from ${sock.remoteAddress}:${sock.remotePort}`);
    });
    if (bindWithHttps) {
      server.on("tlsClientError", (err, sock) => {
        console.error(
          `[pane-endpoint] TLS handshake failed from ${sock.remoteAddress}:${sock.remotePort}: ${err.message}`
        );
      });
    }
    server.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}
function makeHeartbeat(hostUrl, defaults, bindOptions) {
  return (override) => new Promise((resolve) => {
    const opts = {
      intervalMs: override?.intervalMs ?? defaults.intervalMs,
      failThreshold: override?.failThreshold ?? defaults.failThreshold
    };
    const hostPort = parseInt(new URL(hostUrl).port, 10);
    let failures = 0;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await probeHealth(hostPort, new URL(hostUrl).protocol === "https:");
        failures = 0;
      } catch {
        failures++;
        if (failures >= opts.failThreshold) {
          clearInterval(timer);
          try {
            const promoted = await bindOrForward(hostPort, bindOptions);
            resolve(promoted);
          } catch {
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
async function bindOrForward(port, options = {}) {
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
        intervalMs: 2e3,
        failThreshold: 2
      }, options);
      return { mode: "client", hostUrl, startHeartbeat };
    } catch (err) {
      if (err instanceof PortConflictError) throw err;
      throw new HttpsRequiredError();
    }
  }
  try {
    assertCanBindHttps(bindWithHttps);
    const server = await tryBind(port, bindWithHttps);
    process.stdin.on("end", () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1e3).unref();
    });
    process.stdin.on("error", () => process.exit(0));
    process.stdin.resume();
    return { mode: "host", server };
  } catch (err) {
    const code = err.code;
    if (code !== "EADDRINUSE") throw err;
    let health;
    try {
      health = await probeHealth(port, requireHttps ? true : bindWithHttps);
    } catch {
      throw new PortConflictError(port, "<unreachable \u2014 not an HTTP server>");
    }
    if (health.service !== SERVICE_NAME) {
      throw new PortConflictError(port, health.service);
    }
    const scheme = requireHttps || bindWithHttps ? "https" : "http";
    const hostUrl = `${scheme}://127.0.0.1:${port}`;
    const HEARTBEAT_INTERVAL_MS = 2e3;
    const HEARTBEAT_MISS_THRESHOLD = 2;
    const startHeartbeat = makeHeartbeat(hostUrl, {
      intervalMs: HEARTBEAT_INTERVAL_MS,
      failThreshold: HEARTBEAT_MISS_THRESHOLD
    }, options);
    return { mode: "client", hostUrl, startHeartbeat };
  }
}
export {
  HttpsRequiredError,
  PortConflictError,
  SCHEME,
  SERVICE_NAME,
  bindOrForward
};
//# sourceMappingURL=fixed-port-leader.js.map
