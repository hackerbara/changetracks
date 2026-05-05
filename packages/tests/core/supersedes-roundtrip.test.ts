/**
 * Round-trip parser test for supersedes: / superseded-by: footnote lines.
 *
 * Verifies that both the L3 (FootnoteNativeParser) and L2 (CriticMarkupParser)
 * paths populate ChangeNode.supersedes and ChangeNode.supersededBy correctly,
 * and that parseFootnoteBlock emits the typed 'supersedes' / 'superseded-by'
 * FootnoteLine variants.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { FootnoteNativeParser, CriticMarkupParser, initHashline } from '@changedown/core';
import { parseFootnoteBlock } from '@changedown/core/internals';

beforeAll(async () => { await initHashline(); });

// Shared fixture values
const SUPERSEDES_ID = 'cn-1';
const SUPERSEDED_BY_IDS = ['cn-3', 'cn-4'];

/**
 * L3 document fixture: a comment-type change that carries supersedes / superseded-by.
 * Comment changes anchor to line-start, so no text-match is needed in the body —
 * any line number and hash that exist in the document work for anchoring purposes.
 * The hash 'aa' is intentionally fake; the parser degrades gracefully to fallback range.
 */
const L3_FIXTURE = [
  'Some document content here.',
  '',
  '[^cn-2]: @alice | 2026-04-27 | com | proposed',
  '    1:aa {>>review this<<}',
  '    supersedes: cn-1',
  '    superseded-by: cn-3',
  '    superseded-by: cn-4',
].join('\n');

/**
 * L2 document fixture: a CriticMarkup change with an attached footnote ref that
 * carries supersedes / superseded-by lines.
 */
const L2_FIXTURE = [
  '{>>review this<<}[^cn-2]',
  '',
  '[^cn-2]: @alice | 2026-04-27 | comment | proposed',
  '    supersedes: cn-1',
  '    superseded-by: cn-3',
  '    superseded-by: cn-4',
].join('\n');

// ─── L3 parser path ────────────────────────────────────────────────────────

describe('L3 parser: supersedes / superseded-by round-trip', () => {
  const parser = new FootnoteNativeParser();

  it('populates ChangeNode.supersedes from L3 footnote', () => {
    const doc = parser.parse(L3_FIXTURE);
    const node = doc.getChanges().find(c => c.id === 'cn-2');
    expect(node).toBeDefined();
    expect(node!.supersedes).toBe(SUPERSEDES_ID);
  });

  it('populates ChangeNode.supersededBy from L3 footnote', () => {
    const doc = parser.parse(L3_FIXTURE);
    const node = doc.getChanges().find(c => c.id === 'cn-2');
    expect(node).toBeDefined();
    expect(node!.supersededBy).toEqual(SUPERSEDED_BY_IDS);
  });
});

// ─── parseFootnoteBlock typed bodyLines ────────────────────────────────────

describe('parseFootnoteBlock: typed FootnoteLine variants', () => {
  const footnoteLines = [
    '[^cn-2]: @alice | 2026-04-27 | com | proposed',
    '    1:aa {>>review this<<}',
    '    supersedes: cn-1',
    '    superseded-by: cn-3',
    '    superseded-by: cn-4',
  ];

  it('emits kind:supersedes bodyLine with correct target', () => {
    const footnotes = parseFootnoteBlock(footnoteLines, 0);
    expect(footnotes).toHaveLength(1);
    const supersedeLine = footnotes[0].bodyLines.find(l => l.kind === 'supersedes');
    expect(supersedeLine).toBeDefined();
    expect((supersedeLine as { kind: 'supersedes'; target: string }).target).toBe('cn-1');
  });

  it('emits kind:superseded-by bodyLines with correct targets in order', () => {
    const footnotes = parseFootnoteBlock(footnoteLines, 0);
    const supersededByLines = footnotes[0].bodyLines.filter(l => l.kind === 'superseded-by');
    expect(supersededByLines).toHaveLength(2);
    expect((supersededByLines[0] as { kind: 'superseded-by'; target: string }).target).toBe('cn-3');
    expect((supersededByLines[1] as { kind: 'superseded-by'; target: string }).target).toBe('cn-4');
  });

  it('populates Footnote.supersedes projection', () => {
    const footnotes = parseFootnoteBlock(footnoteLines, 0);
    expect(footnotes[0].supersedes).toBe('cn-1');
  });

  it('populates Footnote.supersededBy projection', () => {
    const footnotes = parseFootnoteBlock(footnoteLines, 0);
    expect(footnotes[0].supersededBy).toEqual(['cn-3', 'cn-4']);
  });

  it('preserves raw text matching supersede.ts emit format', () => {
    const footnotes = parseFootnoteBlock(footnoteLines, 0);
    const supersedesLine = footnotes[0].bodyLines.find(l => l.kind === 'supersedes');
    expect((supersedesLine as { raw: string }).raw).toBe('    supersedes: cn-1');
    const supersededByLine = footnotes[0].bodyLines.find(l => l.kind === 'superseded-by');
    expect((supersededByLine as { raw: string }).raw).toBe('    superseded-by: cn-3');
  });
});

// ─── L2 parser path ────────────────────────────────────────────────────────

describe('L2 parser: supersedes / superseded-by round-trip', () => {
  const parser = new CriticMarkupParser();

  it('populates ChangeNode.supersedes from L2 footnote', () => {
    const doc = parser.parse(L2_FIXTURE);
    const node = doc.getChanges().find(c => c.id === 'cn-2');
    expect(node).toBeDefined();
    expect(node!.supersedes).toBe(SUPERSEDES_ID);
  });

  it('populates ChangeNode.supersededBy from L2 footnote', () => {
    const doc = parser.parse(L2_FIXTURE);
    const node = doc.getChanges().find(c => c.id === 'cn-2');
    expect(node).toBeDefined();
    expect(node!.supersededBy).toEqual(SUPERSEDED_BY_IDS);
  });
});
