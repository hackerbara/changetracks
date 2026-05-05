/**
 * L3 deliberation metadata tests (Tranche 2).
 *
 * Verifies that FootnoteNativeParser carries discussion, requestChanges,
 * revisions, and resolution through to ChangeNode.metadata — the four fields
 * that went silently blank in the Apr 6 regression (c5ff1e349).
 *
 * Test 2: L2/L3 cross-check is the load-bearing anti-regression guard.
 * It would have caught the Apr 6 regression at commit time.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { parseForFormat, parseTimestamp, initHashline } from '@changedown/core/internals';

beforeAll(async () => { await initHashline(); });

describe('L3 deliberation metadata', () => {

  // ── Shared L3 fixture ───────────────────────────────────────────────────────
  // Body line 3: "The system provides excellent results."
  // change: ins "excellent " with discussion, requestChanges, revisions, resolved
  const l3Fixture = [
    '<!-- changedown.com/v1: tracked -->',
    '# Doc',
    '',
    'The system provides excellent results.',
    '',
    '[^cn-1]: @alice | 2026-04-27 | ins | proposed',
    '    4:ab {++excellent ++}',
    '    @bob 2026-04-27: I think this phrasing is too vague',
    '    request-changes: @bob 2026-04-27 "Needs stronger phrasing"',
    '    revisions:',
    '      r1 @alice 2026-04-27: "The system delivers exceptional results."',
    '    resolved: @alice 2026-04-27 "Addressed in r1"',
  ].join('\n');

  // ── Test 1: L3 parser populates all four metadata fields ────────────────────

  it('L3 parser populates all four metadata fields', () => {
    const doc = parseForFormat(l3Fixture);
    const nodes = doc.getChanges();
    const node = nodes.find(c => c.id === 'cn-1');
    expect(node).toBeDefined();

    // discussion
    expect(node!.metadata?.discussion?.length).toBe(1);
    expect(node!.metadata?.discussion?.[0].text).toBe('I think this phrasing is too vague');
    expect(node!.metadata?.discussion?.[0].author).toBe('bob');

    // requestChanges
    expect(node!.metadata?.requestChanges?.length).toBe(1);
    expect(node!.metadata?.requestChanges?.[0].author).toBe('@bob');

    // revisions
    expect(node!.metadata?.revisions?.length).toBe(1);
    expect(node!.metadata?.revisions?.[0].label).toBe('r1');
    expect(node!.metadata?.revisions?.[0].text).toBe('The system delivers exceptional results.');

    // resolution
    expect(node!.metadata?.resolution?.type).toBe('resolved');
  });

  // ── Test 2: L2 and L3 parsers produce equivalent metadata ──────────────────
  // This is the load-bearing cross-check — it would have caught the Apr 6
  // regression (c5ff1e349) if it had existed at that commit.

  it('L2 and L3 parsers produce equivalent metadata for the same logical content', () => {
    // L2 fixture: inline CriticMarkup, footnote metadata in L2 format.
    // "resolved:" with colon is accepted by both L2 RESOLVED_RE (/^resolved:?\s+.../) and
    // footnote-block-parser RESOLVED_RE. L2 reason uses `: text` suffix, not quoted.
    // We use no-reason resolved to keep both parsers reading the same field values.
    const l2Fixture = [
      'The system provides {++excellent ++}[^cn-1]results.',
      '',
      '[^cn-1]: @alice | 2026-04-27 | ins | proposed',
      '    @bob 2026-04-27: I think this phrasing is too vague',
      '    request-changes: @bob 2026-04-27 "Needs stronger phrasing"',
      '    revisions:',
      '      r1 @alice 2026-04-27: "The system delivers exceptional results."',
      '    resolved: @alice 2026-04-27',
    ].join('\n');

    const l2Doc = parseForFormat(l2Fixture);
    const l3Doc = parseForFormat(l3Fixture);

    const l2Node = l2Doc.getChanges().find(c => c.id === 'cn-1');
    const l3Node = l3Doc.getChanges().find(c => c.id === 'cn-1');

    expect(l2Node).toBeDefined();
    expect(l3Node).toBeDefined();

    // Both parsers must populate discussion
    expect(l2Node!.metadata?.discussion?.length).toBe(1);
    expect(l3Node!.metadata?.discussion?.length).toBe(1);
    expect(l2Node!.metadata?.discussion?.[0].text).toBe(l3Node!.metadata?.discussion?.[0].text);

    // Both parsers must populate requestChanges
    expect(l2Node!.metadata?.requestChanges?.length).toBe(1);
    expect(l3Node!.metadata?.requestChanges?.length).toBe(1);
    expect(l2Node!.metadata?.requestChanges?.[0].author).toBe(l3Node!.metadata?.requestChanges?.[0].author);
    expect(l2Node!.metadata?.requestChanges?.[0].reason).toBe(l3Node!.metadata?.requestChanges?.[0].reason);

    // Both parsers must populate revisions
    expect(l2Node!.metadata?.revisions?.length).toBe(1);
    expect(l3Node!.metadata?.revisions?.length).toBe(1);
    expect(l2Node!.metadata?.revisions?.[0].label).toBe(l3Node!.metadata?.revisions?.[0].label);
    expect(l2Node!.metadata?.revisions?.[0].text).toBe(l3Node!.metadata?.revisions?.[0].text);

    // Both parsers must populate resolution
    expect(l2Node!.metadata?.resolution?.type).toBe('resolved');
    expect(l3Node!.metadata?.resolution?.type).toBe('resolved');
  });

  // ── Test 3: [label] round-trip on a discussion comment ──────────────────────
  // Forward-note from Tranche 1 code review: [label] is captured by the
  // FOOTNOTE_THREAD_REPLY regex (Tranche 1 change to footnote-patterns.ts).
  // This test verifies the label survives the full parse path.

  it('[label] round-trip on a discussion comment', () => {
    const l3WithLabel = [
      '<!-- changedown.com/v1: tracked -->',
      'The system provides excellent results.',
      '',
      '[^cn-1]: @alice | 2026-04-27 | ins | proposed',
      '    2:ab {++excellent ++}',
      '    @alice 2026-04-27 [suggestion]: Consider "delivers" instead',
    ].join('\n');

    const doc = parseForFormat(l3WithLabel);
    const node = doc.getChanges().find(c => c.id === 'cn-1');
    expect(node).toBeDefined();
    expect(node!.metadata?.discussion?.length).toBe(1);
    expect(node!.metadata?.discussion?.[0].label).toBe('suggestion');
    expect(node!.metadata?.discussion?.[0].text).toBe('Consider "delivers" instead');
  });
});
