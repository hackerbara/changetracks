import type { WordCommandContext, WordCommandOptions } from './types.js';
import { resolveManifest } from './manifest.js';
import { runTool } from './office-tools.js';
import { clearWordSession, readWordSession } from './state.js';

function killOwnedPid(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped owned changedown-mcp process ${pid}.`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw err;
  }
}

export async function runWordStop(ctx: WordCommandContext, options: WordCommandOptions): Promise<number> {
  const session = await readWordSession();
  const manifestPath = options.manifest ?? session?.manifestPath ?? await resolveManifest(undefined, options.dryRun);
  const code = runTool('office-addin-debugging', ['stop', manifestPath], {
    cwd: ctx.cwd,
    dryRun: options.dryRun,
  });
  if (session?.mcpOwned) killOwnedPid(session.mcpPid);
  await clearWordSession();
  return code;
}
