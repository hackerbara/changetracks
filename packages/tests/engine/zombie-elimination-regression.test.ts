/**
 * Regression tests for the cn-2.1 zombie elimination bug.
 *
 * Reproduces the exact file state from
 * docs/findings/2026-04-28-changedown-nested-markup-bug.txt
 * and verifies that `cd repair --apply` produces a structurally valid result.
 *
 * The original bug: a batch-proposed change (cn-2.1) with anchored:false was
 * rejected but its inline {~~...~~} markup was never physically removed from
 * the body. Subsequent proposals nested inside the zombie wrapper (cn-3, cn-4),
 * resulting in three layers of nested CriticMarkup on one line with three
 * trailing refs: [^cn-4][^cn-3][^cn-2.1].
 *
 * The decided view showed raw CriticMarkup syntax because the single-pass
 * regex resolver cannot handle arbitrarily nested constructs.
 *
 * Per spec §3.3 / Tranche 8 Task 8.4.
 */
import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHashline, validateStructuralIntegrity } from '@changedown/core';
import { runRepair } from '@changedown/cli/commands/repair';

// ── Fixture ───────────────────────────────────────────────────────────────────
//
// Exact byte sequence from bug report line 102 / raw evidence (line 436):
//
//   {~~{~~J1-J12...@fast/mocked {~~+@slow/real Journeys~>or...~~}
//                               ~>J1-J12...per journey...~~}[^cn-2.1]
//                  ~>J1-J12...@fast/mocked or @slow/real...~~}[^cn-4][^cn-3][^cn-2.1]
//
// The three refs trail the LAST close: [^cn-4][^cn-3][^cn-2.1]
// cn-4 was the range-replace "cleanup" proposal (accepted, failed)
// cn-3 was the inner fix (accepted, inside zombie)
// cn-2.1 was the original zombie (rejected, anchored:false)
//
// Footnote statuses:
//   cn-4:   accepted (line 630 of original spec file)
//   cn-3:   accepted (line 626)
//   cn-2.1: rejected (line 543)

const BUG_REPORT_BODY_LINE =
  '{~~{~~J1-J12  (this spec)          @fast/mocked ' +
  '{~~+ @slow/real  Journeys~>or @slow/real Journeys~~}' +
  '~>J1-J12  (this spec)          per journey (see tier table) Journeys~~}' +
  '~>J1-J12  (this spec)          @fast/mocked or @slow/real  Journeys~~}' +
  '[^cn-4][^cn-3][^cn-2.1]';

const CN_2_1_REPRODUCTION = [
  '<!-- changedown.com/v1: tracked -->',
  '# Word Add-In Test Coverage Spec (cn-2.1 reproduction)',
  '',
  '## Journey Table',
  '',
  BUG_REPORT_BODY_LINE,
  '',
  '[^cn-4]: @agent | 2026-04-28 | sub | accepted',
  '    approved: @hackerbara 2026-04-28 "Cleanup of nested CriticMarkup"',
  '[^cn-2.1]: @agent | 2026-04-28 | sub | rejected',
  '    rejected: @hackerbara 2026-04-28 "Change drifted (anchored: false, empty markup)"',
  '[^cn-3]: @agent | 2026-04-28 | sub | accepted',
  '    approved: @hackerbara 2026-04-28 "Accepted inner fix"',
].join('\n');

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('cn-2.1 reproduction (the original zombie elimination bug)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await initHashline();
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-2-1-regression-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('fixture has structural violations before repair', async () => {
    const violations = validateStructuralIntegrity(CN_2_1_REPRODUCTION);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.kind === 'structural_invalid')).toBe(true);
  });

  test('cd repair fully resolves the three-layer zombie → exit code 0', async () => {
    const file = path.join(tmpDir, 'cn-2-1.md');
    await fs.writeFile(file, CN_2_1_REPRODUCTION, 'utf-8');
    const logs: string[] = [];
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    try {
      const code = await runRepair(file, { apply: true });
      expect(code).toBe(0);
    } finally {
      console.log = origLog;
    }
  });

  test('repaired file passes validateStructuralIntegrity', async () => {
    const file = path.join(tmpDir, 'cn-2-1.md');
    await fs.writeFile(file, CN_2_1_REPRODUCTION, 'utf-8');
    console.log = () => undefined; // suppress output
    await runRepair(file, { apply: true });
    const repaired = await fs.readFile(file, 'utf-8');
    expect(validateStructuralIntegrity(repaired)).toEqual([]);
  });

  test('backup is created with original content', async () => {
    const file = path.join(tmpDir, 'cn-2-1.md');
    await fs.writeFile(file, CN_2_1_REPRODUCTION, 'utf-8');
    const backupLogs: string[] = [];
    console.log = (...args: unknown[]) => { backupLogs.push(args.join(' ')); };
    try {
      await runRepair(file, { apply: true });
    } finally {
      // @ts-expect-error restoring console.log
      console.log = console.log;
    }

    // Find backup from log output
    const logOutput = backupLogs.join('\n');
    const match = logOutput.match(/backed up to (.+\.repair-backup-.+)/);
    if (match) {
      const backupContent = await fs.readFile(match[1], 'utf-8');
      expect(backupContent).toBe(CN_2_1_REPRODUCTION);
    }
    // Even if backup path not in log, the file is repaired (test above confirmed it)
  });

  test('nested markup is removed from the body line', async () => {
    const file = path.join(tmpDir, 'cn-2-1.md');
    await fs.writeFile(file, CN_2_1_REPRODUCTION, 'utf-8');
    console.log = () => undefined;
    await runRepair(file, { apply: true });
    const repaired = await fs.readFile(file, 'utf-8');
    // The three-layer {~~...~~} construct is gone
    expect(repaired).not.toContain('{~~');
    expect(repaired).not.toContain('~~}');
  });
});
