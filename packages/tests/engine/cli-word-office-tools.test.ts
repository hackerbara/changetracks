import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fallbackCommand, pathCandidates, resolvePackagedTool } from '@changedown/cli/word/office-tools';

describe('Word office tool command resolution', () => {
  it('includes Windows npm .cmd shims for local bins and PATH bins', () => {
    const candidates = pathCandidates('npx', 'C:\\repo', 'C:\\Users\\me\\AppData\\Roaming\\npm', 'win32');

    expect(candidates).toContain(path.join('C:\\repo', 'node_modules', '.bin', 'npx.cmd'));
    expect(candidates).toContain(path.join('C:\\Users\\me\\AppData\\Roaming\\npm', 'npx.cmd'));
  });

  it('falls back to npx.cmd on Windows when no npx executable is resolved', () => {
    expect(fallbackCommand('npx', 'win32')).toBe('npx.cmd');
  });

  it('keeps Unix fallback command extensionless', () => {
    expect(fallbackCommand('npx', 'darwin')).toBe('npx');
  });

  it('resolves bundled Office add-in tools through node instead of nested npx', () => {
    const tool = resolvePackagedTool('office-addin-manifest');

    expect(tool?.command).toBe(process.execPath);
    expect(tool?.args[0]).toMatch(/office-addin-manifest[/\\]cli\.js$/);
  });
});
