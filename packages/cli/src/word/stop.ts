import type { WordCommandContext, WordCommandOptions } from './types.js';
import { runOfficeDebugStop } from './office-tools.js';
import { clearWordSession, readWordSession } from './state.js';

function sigtermStartPid(pid: number | undefined): void {
  if (!pid || pid === process.pid) return;
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Signaled foreground word start process ${pid} to stop.`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw err;
  }
}

async function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWordStop(ctx: WordCommandContext, options: WordCommandOptions): Promise<number> {
  const session = await readWordSession();

  // Tell the foreground word start process to clean up first; its SIGTERM
  // handler closes the pane server and un-sideloads. We then double-check
  // by running the un-sideload here in case the foreground process was
  // already gone.
  sigtermStartPid(session?.startPid);
  if (session?.startPid) await waitMs(250);

  const manifestPath = options.manifest ?? session?.manifestPath;
  if (!manifestPath) {
    console.log('No active Word session recorded and no --manifest passed; nothing to un-sideload.');
    await clearWordSession();
    return 0;
  }

  const code = await runOfficeDebugStop(manifestPath, {
    cwd: ctx.cwd,
    dryRun: options.dryRun,
  });
  await clearWordSession();
  return code;
}
