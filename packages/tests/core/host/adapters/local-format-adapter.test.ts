// packages/tests/core/host/adapters/local-format-adapter.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LocalFormatAdapter } from '@changedown/core/host';
import { initHashline } from '@changedown/core/internals';

// Use the canonical test fixture that has well-formed footnote definitions.
// convertL2ToL3 enriches existing footnotes — it does not synthesize them
// for inline-only documents.
const FIXTURE_PATH = resolve(
  __dirname,
  '../../../../core/src/test/fixtures/l2-with-changes.md',
);
let L2_FIXTURE: string;

beforeAll(async () => {
  await initHashline();
  L2_FIXTURE = readFileSync(FIXTURE_PATH, 'utf-8');
});

// Valid L3 document (footnote body line starts with LINE:HASH edit-op).
const L3_DOC = [
  'Hello world.[^cn-1]',
  '',
  '[^cn-1]: @ai:test | 2026-01-01 | ins | proposed',
  '    1:ab {++world++}',
  '',
].join('\n');

describe('LocalFormatAdapter', () => {
  const adapter = new LocalFormatAdapter();

  it('converts L2 to L3 — strips inline markup from body', async () => {
    const l3 = await adapter.convertL2ToL3('file:///test.md', L2_FIXTURE);
    // L3 body (before first footnote def) should not contain inline CriticMarkup
    const bodyEnd = l3.indexOf('[^cn-');
    const bodyPart = bodyEnd > 0 ? l3.substring(0, bodyEnd) : l3;
    expect(bodyPart).not.toMatch(/\{\+\+|\{--|\{~~/);
  });

  it('converts L2 to L3 — footnote definitions are preserved', async () => {
    const l3 = await adapter.convertL2ToL3('file:///test.md', L2_FIXTURE);
    expect(l3).toContain('[^cn-1]:');
  });

  it('converts L3 to L2', async () => {
    const l2 = await adapter.convertL3ToL2('file:///test.md', L3_DOC);
    expect(l2).toContain('{++');  // L2 has inline markup
  });

  it('round-trips: L2 → L3 → L2 preserves change count', async () => {
    const l3 = await adapter.convertL2ToL3('file:///test.md', L2_FIXTURE);
    const roundTripped = await adapter.convertL3ToL2('file:///test.md', l3);
    const { parseForFormat } = await import('@changedown/core');
    const originalChanges = parseForFormat(L2_FIXTURE).getChanges();
    const roundTrippedChanges = parseForFormat(roundTripped).getChanges();
    expect(roundTrippedChanges.length).toBe(originalChanges.length);
  });
});
