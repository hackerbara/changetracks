import type { WordCommandContext, WordCommandOptions } from './types.js';
import { resolveManifestForDoctor } from './manifest.js';
import { resolveBin, runTool } from './office-tools.js';
import { MCP_PORT, mcpStartGuidance, preflightMcp, preflightMcpFromOrigin, probeMcpHealth } from './mcp.js';
import { detectAgents } from '../agents/setup.js';

function line(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

export async function runWordDoctor(ctx: WordCommandContext, options: WordCommandOptions): Promise<number> {
  const useDevCerts = options.noDevCerts ? false : true;
  let failures = 0;
  const fail = (label: string, detail?: string) => { failures++; line(false, label, detail); };
  const pass = (label: string, detail?: string) => line(true, label, detail);

  pass('platform', `${process.platform}/${process.arch}`);

  try {
    const manifest = await resolveManifestForDoctor(options.manifest, options.noDownload);
    pass(options.noDownload && !options.manifest ? 'hosted manifest cache' : 'hosted manifest', manifest);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException).code;
    if (options.noDownload && options.manifest && code === 'ERR_NO_DOWNLOAD_NETWORK_MANIFEST') {
      line(true, 'hosted manifest', `${message}; skipping network fetch because --no-download was set`);
    } else if (options.noDownload && !options.manifest && code === 'ENOENT') {
      line(true, 'hosted manifest cache', `missing cache (${message}); skipping refresh because --no-download was set`);
    } else {
      fail(options.noDownload && !options.manifest ? 'hosted manifest cache' : 'hosted manifest', message);
    }
  }

  const toolBins = useDevCerts
    ? ['office-addin-dev-certs', 'office-addin-manifest', 'office-addin-debugging']
    : ['office-addin-manifest', 'office-addin-debugging'];
  for (const bin of toolBins) {
    const resolved = resolveBin(bin, ctx.cwd);
    line(Boolean(resolved), bin, resolved ?? 'will use npx fallback');
  }

  if (useDevCerts) {
    if (!options.dryRun) {
      const verify = runTool('office-addin-dev-certs', ['verify'], { cwd: ctx.cwd, stdio: 'pipe' });
      if (verify === 0) pass('office dev cert verification');
      else fail('office dev cert verification', `exit ${verify}`);
    }
  } else {
    pass('office dev certs', 'skipped because --no-dev-certs selected diagnostic HTTP loopback mode');
  }

  const scheme = useDevCerts ? 'https' : 'http';
  const healthUrl = `${scheme}://127.0.0.1:${MCP_PORT}/health`;
  const health = await probeMcpHealth(1500, scheme);
  if (health.ok) {
    pass('MCP loopback health', healthUrl);
    try {
      const headers = await preflightMcp('/backend/register', 1500, scheme);
      if (headers['access-control-allow-origin'] === 'https://changedown.com') pass('MCP hosted-origin CORS');
      else fail('MCP hosted-origin CORS', String(headers['access-control-allow-origin']));
      if (headers['access-control-allow-private-network'] === 'true') pass('MCP PNA preflight');
      else fail('MCP PNA preflight', String(headers['access-control-allow-private-network']));
    } catch (err) {
      fail('MCP preflight', err instanceof Error ? err.message : String(err));
    }

    try {
      const hostile = await preflightMcpFromOrigin('https://evil.example', '/backend/register', 1500, scheme);
      if (hostile['access-control-allow-origin']) fail('MCP hostile-origin rejection', String(hostile['access-control-allow-origin']));
      else pass('MCP hostile-origin rejection');
    } catch (err) {
      fail('MCP hostile-origin preflight', err instanceof Error ? err.message : String(err));
    }
  } else {
    line(true, 'MCP loopback health', `${health.error ?? 'not running'}; skipping MCP preflight checks. ${mcpStartGuidance(scheme)}`);
  }

  for (const agent of detectAgents()) {
    line(true, `agent ${agent.name}`, `${agent.detected ? 'detected' : 'not detected'}, ${agent.configured ? 'configured' : 'not configured'}`);
  }

  return failures === 0 ? 0 : 1;
}
