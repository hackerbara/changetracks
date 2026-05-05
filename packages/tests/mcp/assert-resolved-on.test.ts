/**
 * Integration tests: strict assertResolved behavior across mutation handlers.
 *
 * Per spec §8 / Tranche 3 Task 3.13. End-to-end verification that propose_change,
 * review_changes, and amend_change all refuse to operate on a doc carrying
 * coordinate_failed diagnostics. Strict mode is now unconditional (Tranche 10).
 *
 * Fixture: an L3 document whose single footnote has an edit-op that references
 * text absent from the target line. The FootnoteNativeParser emits a
 * coordinate_failed diagnostic and sets resolved:false on the ChangeNode.
 * Task 2.4 established this behavior; the fixture format mirrors those tests.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { handleProposeChange } from '@changedown/mcp/internals';
import { handleReviewChanges } from '@changedown/mcp/internals';
import { handleAmendChange } from '@changedown/mcp/internals';
import { SessionState } from '@changedown/mcp/internals';
import { type ChangeDownConfig } from '@changedown/mcp/internals';
import { ConfigResolver } from '@changedown/mcp/internals';
import { createTestResolver } from './test-resolver.js';
import { initHashline } from '@changedown/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * L3 document with a coordinate_failed zombie.
 *
 * The footnote's edit-op text "{++missing-anchor-text++}" is absent from
 * body line 1 ("Some body text here."), so FootnoteNativeParser emits
 * a coordinate_failed diagnostic and sets resolved:false on cn-1.
 *
 * Format verified against Task 2.4 (footnote-native-parser.test.ts line 1352).
 */
const UNRESOLVABLE_FIXTURE = [
  '<!-- changedown.com/v1: tracked -->',
  'Some body text here.',
  '',
  '[^cn-1]: @human:test | 2026-01-01 | ins | proposed',
  '    1:ab {++missing-anchor-text++}',
].join('\n');

/**
 * Healthy L3 document — no diagnostics, one resolvable change.
 * propose_change should succeed.
 */
const HEALTHY_FIXTURE = [
  '<!-- changedown.com/v1: tracked -->',
  'hello world',
].join('\n');

// ─── Shared config ───────────────────────────────────────────────────────────

const BASE_CONFIG: ChangeDownConfig = {
  tracking: { include: ['**/*.md'], exclude: [], default: 'tracked', auto_header: false },
  author: { default: 'ai:test', enforcement: 'optional' },
  hooks: { enforcement: 'warn', exclude: [] },
  matching: { mode: 'normalized' },
  hashline: { enabled: false, auto_remap: false },
  settlement: { auto_on_approve: false, auto_on_reject: false },
  policy: { mode: 'safety-net', creation_tracking: 'footnote', default_view: 'working', view_policy: 'suggest' },
  // level:3 matches the UNRESOLVABLE_FIXTURE format (L3: clean body + footnote log)
  protocol: { mode: 'classic', level: 3, reasoning: 'optional', batch_reasoning: 'optional' },
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('assertResolved strict-mode behavior across mutation handlers (Tranche 3 Task 3.13)', () => {
  let tmpDir: string;
  let state: SessionState;
  let resolver: ConfigResolver;
  let tmpFile: string;

  beforeAll(async () => {
    await initHashline();
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-assert-resolved-'));
    state = new SessionState();
    resolver = await createTestResolver(tmpDir, BASE_CONFIG);
    tmpFile = path.join(tmpDir, 'doc.md');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── propose_change ───────────────────────────────────────────────────────

  it('propose_change refuses to operate when doc has coordinate_failed diagnostic', async () => {
    await fs.writeFile(tmpFile, UNRESOLVABLE_FIXTURE);

    const result = await handleProposeChange(
      {
        file: tmpFile,
        old_text: 'Some body text',
        new_text: 'Other body text',
        reason: 'test mutation',
      },
      resolver,
      state,
    );

    expect(result.isError).toBe(true);
    // The error message should mention the unresolved change count
    expect(result.content[0].text).toMatch(/unresolved|coordinate_failed|VALIDATION_ERROR/i);
  });

  it('propose_change proceeds normally on healthy doc', async () => {
    await fs.writeFile(tmpFile, HEALTHY_FIXTURE);

    const result = await handleProposeChange(
      {
        file: tmpFile,
        old_text: 'hello',
        new_text: 'hi',
        reason: 'test',
      },
      resolver,
      state,
    );

    expect(result.isError).toBeFalsy();
  });

  // ── review_changes ───────────────────────────────────────────────────────

  it('review_changes refuses to operate when doc has coordinate_failed diagnostic', async () => {
    await fs.writeFile(tmpFile, UNRESOLVABLE_FIXTURE);

    const result = await handleReviewChanges(
      {
        file: tmpFile,
        reviews: [{ change_id: 'cn-1', decision: 'approve', reason: 'test' }],
      },
      resolver,
      state,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unresolved|coordinate_failed|VALIDATION_ERROR/i);
  });

  // ── amend_change ─────────────────────────────────────────────────────────

  it('amend_change refuses to operate when doc has coordinate_failed diagnostic', async () => {
    await fs.writeFile(tmpFile, UNRESOLVABLE_FIXTURE);

    const result = await handleAmendChange(
      {
        file: tmpFile,
        change_id: 'cn-1',
        new_text: 'replacement text',
        reason: 'amend attempt',
      },
      resolver,
      state,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unresolved|coordinate_failed|VALIDATION_ERROR/i);
  });
});
