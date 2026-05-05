import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const require = createRequire(import.meta.url);

export interface RunToolOptions {
  cwd: string;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  stdio?: 'inherit' | 'pipe';
}

function commandNames(bin: string, platform = process.platform): string[] {
  if (platform !== 'win32' || /\.[^\\/]+$/.test(bin)) return [bin];
  return [bin, `${bin}.cmd`, `${bin}.exe`, `${bin}.bat`];
}

export function pathCandidates(bin: string, cwd: string, envPath = process.env.PATH ?? '', platform = process.platform): string[] {
  const names = commandNames(bin, platform);
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const bases = [
    path.join(cwd, 'node_modules', '.bin'),
    path.join(cwd, 'packages', 'word-add-in', 'node_modules', '.bin'),
    path.join(cwd, 'changedown-plugin', 'mcp-server', 'node_modules', '.bin'),
    ...envPath.split(delimiter).filter(Boolean),
  ];
  const candidates: string[] = [];
  for (const base of bases) {
    for (const name of names) candidates.push(path.join(base, name));
  }
  return candidates;
}

export function resolveBin(bin: string, cwd: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  return pathCandidates(bin, cwd).find((candidate) => fs.existsSync(candidate));
}

export function fallbackCommand(bin: string, platform = process.platform): string {
  return platform === 'win32' ? `${bin}.cmd` : bin;
}

function commandNeedsShell(command: string): boolean {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
}

export function resolvePackagedTool(bin: string): { command: string; args: string[] } | undefined {
  try {
    const pkg = packageForBin(bin);
    const pkgJsonPath = require.resolve(`${pkg}/package.json`);
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { bin?: string | Record<string, string> };
    const binEntry = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[bin];
    if (!binEntry) return undefined;
    return {
      command: process.execPath,
      args: [path.resolve(path.dirname(pkgJsonPath), binEntry)],
    };
  } catch {
    return undefined;
  }
}

export function runTool(bin: string, args: string[], options: RunToolOptions & { explicit?: string } = { cwd: process.cwd() }): number {
  const resolved = resolveBin(bin, options.cwd, options.explicit);
  const packaged = resolved ? undefined : resolvePackagedTool(bin);
  const command = resolved ?? packaged?.command ?? resolveBin('npx', options.cwd) ?? fallbackCommand('npx');
  const finalArgs = resolved ? args : packaged ? [...packaged.args, ...args] : ['--yes', '--package', packageForBin(bin), '--', bin, ...args];
  if (options.dryRun) {
    console.log(`[dry-run] ${command} ${finalArgs.join(' ')}`);
    return 0;
  }
  const result = spawnSync(command, finalArgs, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? 'inherit',
    shell: commandNeedsShell(command),
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function spawnDetachedTool(command: string, args: string[], options: RunToolOptions): ChildProcess {
  if (options.dryRun) {
    throw new Error('spawnDetachedTool cannot be used in dry-run mode');
  }
  return spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: commandNeedsShell(command),
    windowsHide: true,
  });
}

function packageForBin(bin: string): string {
  switch (bin) {
    case 'office-addin-debugging':
      return 'office-addin-debugging';
    case 'office-addin-dev-certs':
      return 'office-addin-dev-certs';
    case 'office-addin-manifest':
      return 'office-addin-manifest';
    default:
      return bin;
  }
}
