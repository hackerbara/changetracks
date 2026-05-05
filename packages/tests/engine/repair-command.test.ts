/**
 * Tests for the `cd repair` command (runRepair function).
 *
 * Per spec §3.3 / Tranche 8 Task 8.3.
 */
import { describe, test, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHashline, validateStructuralIntegrity } from '@changedown/core';
import { runRepair, buildRepairPlan, applyRepairPlan } from '@changedown/cli/commands/repair';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Clean prose — no violations.
 */
const CLEAN_PROSE = '<!-- changedown.com/v1: tracked -->\nClean prose with no markup.\n';

/**
 * Simple record_orphaned: inline ref without footnote def.
 */
const ORPHAN_REF_DOC = [
  '<!-- changedown.com/v1: tracked -->',
  'Prose [^cn-1] more prose.',
].join('\n');

/**
 * Three-layer zombie matching the bug report (Step 5).
 *
 * Structure: {~~{~~...{~~inner~~}[^cn-3]~>MID~~}[^cn-2.1]~>CLEAN~~}[^cn-4]
 * Footnotes: cn-4 accepted, cn-2.1 rejected, cn-3 accepted.
 */
const THREE_LAYER_ZOMBIE = [
  '<!-- changedown.com/v1: tracked -->',
  '',
  '{~~{~~OLD TEXT {~~inner~>innerNew~~}[^cn-3]~>MIDDLE~~}[^cn-2.1]~>CLEAN~~}[^cn-4]',
  '',
  '[^cn-4]: @agent | 2026-04-28 | sub | accepted',
  '    approved: @hackerbara 2026-04-28 "Cleanup"',
  '[^cn-2.1]: @agent | 2026-04-28 | sub | rejected',
  '    rejected: @hackerbara 2026-04-28 "Zombie"',
  '[^cn-3]: @agent | 2026-04-28 | sub | accepted',
  '    approved: @hackerbara 2026-04-28 "Inner"',
].join('\n');

/**
 * Multi-type nested zombie: sub containing ins.
 */
const MULTI_TYPE_ZOMBIE = [
  '<!-- changedown.com/v1: tracked -->',
  '',
  '{~~outer{++middle++}[^cn-2]~>clean~~}[^cn-1]',
  '',
  '[^cn-1]: @agent | 2026-04-28 | sub | rejected',
  '    rejected: @hackerbara 2026-04-28 "Zombie outer"',
  '[^cn-2]: @agent | 2026-04-28 | ins | accepted',
  '    approved: @hackerbara 2026-04-28 "Nested insertion"',
].join('\n');

/**
 * Surface orphan: decided footnote def with no inline ref.
 */
const SURFACE_ORPHAN_DOC = [
  '<!-- changedown.com/v1: tracked -->',
  'Clean body.',
  '',
  '[^cn-1]: @alice | 2026-04-28 | sub | accepted',
  '    approved: @bob 2026-04-28 "OK"',
].join('\n');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function writeTemp(dir: string, name: string, content: string): Promise<string> {
  const p = path.join(dir, name);
  await fs.writeFile(p, content, 'utf-8');
  return p;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('cd repair', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await initHashline();
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cd-repair-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ── No-flag mode ──────────────────────────────────────────────────────────

  test('clean file → exit code 0, "No structural issues found"', async () => {
    const file = await writeTemp(tmpDir, 'clean.md', CLEAN_PROSE);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runRepair(file, {});
    expect(code).toBe(0);
    expect(logSpy.mock.calls.flat().join(' ')).toContain('No structural issues found');
  });

  test('default mode (no flags) lists issues without computing plan', async () => {
    const file = await writeTemp(tmpDir, 'orphan.md', ORPHAN_REF_DOC);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runRepair(file, {});
    expect(code).toBe(0);

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toMatch(/structural issue|record_orphaned/i);
    expect(output).toContain('--dry-run');
    expect(output).toContain('--apply');

    // File should be unchanged
    const content = await fs.readFile(file, 'utf-8');
    expect(content).toBe(ORPHAN_REF_DOC);
  });

  // ── --dry-run mode ────────────────────────────────────────────────────────

  test('--dry-run prints issues + repaired diff, does not modify file', async () => {
    const file = await writeTemp(tmpDir, 'zombie.md', THREE_LAYER_ZOMBIE);
    const original = await fs.readFile(file, 'utf-8');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runRepair(file, { dryRun: true });

    expect(code).toBe(0);
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('structural issue');

    // File should be unchanged
    const afterContent = await fs.readFile(file, 'utf-8');
    expect(afterContent).toBe(original);
  });

  // ── --apply mode ──────────────────────────────────────────────────────────

  test('--apply writes backup and repairs the file', async () => {
    const file = await writeTemp(tmpDir, 'zombie.md', THREE_LAYER_ZOMBIE);
    const original = await fs.readFile(file, 'utf-8');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runRepair(file, { apply: true });
    expect(code).toBe(0);

    // Repaired content is structurally valid
    const repaired = await fs.readFile(file, 'utf-8');
    expect(validateStructuralIntegrity(repaired)).toEqual([]);

    // A backup file was created with the original content
    const output = logSpy.mock.calls.flat().join('\n');
    const backupMatch = output.match(/backed up to (.+\.repair-backup-.+)/);
    expect(backupMatch).not.toBeNull();
    const backupPath = backupMatch![1];
    const backupContent = await fs.readFile(backupPath, 'utf-8');
    expect(backupContent).toBe(original);
  });

  // ── Three-layer zombie ────────────────────────────────────────────────────

  test('repair on three-layer zombie resolves all violations', async () => {
    const file = await writeTemp(tmpDir, 'three-layer.md', THREE_LAYER_ZOMBIE);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runRepair(file, { apply: true });
    expect(code).toBe(0);
    const repaired = await fs.readFile(file, 'utf-8');
    expect(validateStructuralIntegrity(repaired)).toEqual([]);
  });

  // ── Multi-type nested zombie ──────────────────────────────────────────────

  test('repair on multi-type nested zombie resolves all violations', async () => {
    const file = await writeTemp(tmpDir, 'multi-type.md', MULTI_TYPE_ZOMBIE);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runRepair(file, { apply: true });
    expect(code).toBe(0);
    const repaired = await fs.readFile(file, 'utf-8');
    expect(validateStructuralIntegrity(repaired)).toEqual([]);
  });

  // ── Surface orphan ────────────────────────────────────────────────────────

  test('repair on surface_orphaned removes the dangling footnote def', async () => {
    const file = await writeTemp(tmpDir, 'surface-orphan.md', SURFACE_ORPHAN_DOC);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runRepair(file, { apply: true });
    expect(code).toBe(0);
    const repaired = await fs.readFile(file, 'utf-8');
    expect(validateStructuralIntegrity(repaired)).toEqual([]);
    expect(repaired).not.toContain('[^cn-1]:');
  });
});

// ── Unit tests for buildRepairPlan / applyRepairPlan ─────────────────────────

describe('buildRepairPlan', () => {
  beforeAll(async () => {
    await initHashline();
  });

  test('structural_invalid without changeId → uses secondary zombie scan', () => {
    const plan = buildRepairPlan(THREE_LAYER_ZOMBIE, validateStructuralIntegrity(THREE_LAYER_ZOMBIE));
    const removeByIds = plan.filter(s => s.kind === 'remove-by-id').map(s => s.changeId);
    // Should have found cn-4, cn-2.1, cn-3 as zombie candidates
    expect(removeByIds.length).toBeGreaterThan(0);
    // At least the outermost (cn-4) should be there
    expect(removeByIds).toContain('cn-4');
  });

  test('record_orphaned → remove-orphan-ref step', () => {
    const violations = validateStructuralIntegrity(ORPHAN_REF_DOC);
    const plan = buildRepairPlan(ORPHAN_REF_DOC, violations);
    expect(plan.some(s => s.kind === 'remove-orphan-ref' && s.changeId === 'cn-1')).toBe(true);
  });

  test('surface_orphaned → remove-orphan-def step', () => {
    const violations = validateStructuralIntegrity(SURFACE_ORPHAN_DOC);
    const plan = buildRepairPlan(SURFACE_ORPHAN_DOC, violations);
    expect(plan.some(s => s.kind === 'remove-orphan-def' && s.changeId === 'cn-1')).toBe(true);
  });
});

describe('applyRepairPlan', () => {
  test('remove-by-id removes markup span and its inline ref', () => {
    const text = 'before {~~old~>new~~}[^cn-1] after\n[^cn-1]: @a | 2026-01-01 | sub | rejected\n';
    const result = applyRepairPlan(text, [{ kind: 'remove-by-id', changeId: 'cn-1' }]);
    // The inline markup {~~...~~}[^cn-1] is removed from the body.
    expect(result).not.toContain('{~~');
    // The footnote def is not touched by remove-by-id alone.
    // (A companion remove-orphan-def step handles that.)
    expect(result).toContain('[^cn-1]:');
  });

  test('remove-orphan-ref removes inline ref', () => {
    const text = 'prose [^cn-1] more prose';
    const result = applyRepairPlan(text, [{ kind: 'remove-orphan-ref', changeId: 'cn-1' }]);
    expect(result).toBe('prose  more prose');
  });

  test('remove-orphan-def removes footnote def block', () => {
    const text = 'body\n\n[^cn-1]: @a | 2026-01-01 | sub | accepted\n    note\n';
    const result = applyRepairPlan(text, [{ kind: 'remove-orphan-def', changeId: 'cn-1' }]);
    expect(result).not.toContain('[^cn-1]:');
    expect(result).not.toContain('    note');
  });
});
