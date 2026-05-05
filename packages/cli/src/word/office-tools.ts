import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export interface RunToolOptions {
  cwd: string;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  stdio?: 'inherit' | 'pipe';
}

function pathCandidates(bin: string, cwd: string): string[] {
  const candidates = [
    path.join(cwd, 'node_modules', '.bin', bin),
    path.join(cwd, 'packages', 'word-add-in', 'node_modules', '.bin', bin),
    path.join(cwd, 'changedown-plugin', 'mcp-server', 'node_modules', '.bin', bin),
  ];
  const pathParts = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const part of pathParts) candidates.push(path.join(part, bin));
  return candidates;
}

export function resolveBin(bin: string, cwd: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  return pathCandidates(bin, cwd).find((candidate) => fs.existsSync(candidate));
}

export function runTool(bin: string, args: string[], options: RunToolOptions & { explicit?: string } = { cwd: process.cwd() }): number {
  const resolved = resolveBin(bin, options.cwd, options.explicit);
  const command = resolved ?? 'npx';
  const finalArgs = resolved ? args : ['--yes', '--package', packageForBin(bin), '--', bin, ...args];
  if (options.dryRun) {
    console.log(`[dry-run] ${command} ${finalArgs.join(' ')}`);
    return 0;
  }
  const result = spawnSync(command, finalArgs, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? 'inherit',
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
