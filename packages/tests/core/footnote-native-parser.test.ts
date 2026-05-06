import { describe, it, expect, beforeAll } from 'vitest';
import { Workspace, FootnoteNativeParser, ChangeType, ChangeStatus, initHashline, FOOTNOTE_L3_EDIT_OP } from '@changedown/core/internals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('isFootnoteNative detection', () => {
  const ws = new Workspace();

  it('returns false for settled L2 with old-format footnotes', () => {
    const settledL2 = `# Document\n\nSome settled text.\n\n[^cn-1]: @alice | 2026-03-16 | ins | accepted\n    approved: @alice 2026-03-16 "looks good"`;
    expect(ws.isFootnoteNative(settledL2)).toBe(false);
  });

  it('returns true for L3 with line-hash + edit-op footnotes', () => {
    const l3 = `# Document\n\nSome text with additions.\n\n[^cn-1]: @alice | 2026-03-16 | ins | proposed\n    3:a3 {++additions++}`;
    expect(ws.isFootnoteNative(l3)).toBe(true);
  });

  it('returns false for L2 with inline CriticMarkup', () => {
    const l2 = `# Document\n\n{++Some added text.++}\n\n[^cn-1]: @alice | 2026-03-16 | ins | proposed`;
    expect(ws.isFootnoteNative(l2)).toBe(false);
  });

  it('returns false for plain markdown with no changes', () => {
    const plain = `# Document\n\nJust plain markdown.`;
    expect(ws.isFootnoteNative(plain)).toBe(false);
  });
});

describe('FootnoteNativeParser (line-hash + edit-op format)', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();
  const fixture = readFileSync(
    resolve(__dirname, '../../core/src/test/fixtures/l3-sample.md'),
    'utf-8'
  );

  it('parses insertion with line hash and edit op', () => {
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    const ins = changes.find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.type).toBe(ChangeType.Insertion);
    expect(ins!.status).toBe(ChangeStatus.Proposed);
    expect(ins!.metadata?.author).toBe('@alice');
    expect(ins!.range.start).toBeGreaterThan(0);
    expect(ins!.range.end).toBeGreaterThan(ins!.range.start);
  });

  it('classifies document-scope accepted insertion as a durable record, not a reviewable change', () => {
    const genesisL3 = [
      'Fresh visible seed.',
      'Codec garden live seed.',
      '',
      '[^cn-1]: @base-document | 2026-05-04 | ins | accepted',
      '    source: initial-word-body',
      '    scope: document',
      '    body-hash: test-body-hash',
      '',
    ].join('\n');

    const doc = parser.parse(genesisL3);

    expect(doc.getChanges()).toEqual([]);
    expect(doc.getDiagnostics()).toEqual([]);
    expect(doc.getRecords()).toContainEqual(expect.objectContaining({
      id: 'cn-1',
      type: 'ins',
      status: 'accepted',
      reviewable: false,
      metadata: expect.objectContaining({
        source: 'initial-word-body',
        scope: 'document',
        'body-hash': 'test-body-hash',
      }),
    }));
  });

  it('keeps accepted insertion with edit-op reviewable even when it has genesis-like metadata', () => {
    const l3 = [
      'Fresh visible seed.',
      'Codec garden live seed.',
      '',
      '[^cn-1]: @base-document | 2026-05-04 | ins | accepted',
      '    1:00 {++Fresh ++}visible seed.',
      '    source: initial-word-body',
      '    scope: document',
      '    body-hash: test-body-hash',
      '',
    ].join('\n');

    const doc = parser.parse(l3);
    const changes = doc.getChanges();

    expect(changes).toHaveLength(1);
    expect(changes[0]!).toMatchObject({
      id: 'cn-1',
      type: ChangeType.Insertion,
      status: ChangeStatus.Accepted,
    });
    expect(doc.getRecords()).toEqual([]);
  });

  it('parses deletion with contextual anchor span and deletionSeamOffset', () => {
    // After the bug 5 fix (Plan 1 Task 2), deletion ranges cover the full
    // contextual anchor span (contextBefore + contextAfter) rather than being
    // zero-width. deletionSeamOffset records where the deleted text used to
    // live within the span (= contextBefore.length).
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    const del = changes.find(c => c.id === 'cn-2');
    expect(del).toBeDefined();
    expect(del!.type).toBe(ChangeType.Deletion);
    expect(del!.originalText).toBeDefined();
    // Non-zero range, covering contextBefore + contextAfter
    expect(del!.range.end).toBeGreaterThan(del!.range.start);
    // contextBefore = "We should " → deletionSeamOffset = 10
    expect(del!.deletionSeamOffset).toBe('We should '.length);
  });

  it('parses substitution with original and modified text', () => {
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    const sub = changes.find(c => c.id === 'cn-3');
    expect(sub).toBeDefined();
    expect(sub!.type).toBe(ChangeType.Substitution);
    expect(sub!.status).toBe(ChangeStatus.Accepted);
    expect(sub!.originalText).toBeDefined();
    expect(sub!.modifiedText).toBeDefined();
  });

  it('parses approval metadata on accepted change', () => {
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    const sub = changes.find(c => c.id === 'cn-3');
    expect(sub).toBeDefined();
    expect(sub!.metadata?.approvals).toBeDefined();
    expect(sub!.metadata!.approvals!.length).toBe(1);
    expect(sub!.metadata!.approvals![0].author).toBe('@alice');
    expect(sub!.metadata!.approvals![0].reason).toBe('Verified the change');
  });

  it('parses rejected insertion (no body range)', () => {
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    const rej = changes.find(c => c.id === 'cn-4');
    expect(rej).toBeDefined();
    expect(rej!.type).toBe(ChangeType.Insertion);
    expect(rej!.status).toBe(ChangeStatus.Rejected);
  });

  it('parses highlight with comment', () => {
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    const hig = changes.find(c => c.id === 'cn-5');
    expect(hig).toBeDefined();
    expect(hig!.type).toBe(ChangeType.Highlight);
    expect(hig!.metadata?.comment).toContain('This needs revision');
  });

  it('sets range === contentRange for all L3 changes (no delimiters)', () => {
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    for (const c of changes) {
      expect(c.range.start).toBe(c.contentRange.start);
      expect(c.range.end).toBe(c.contentRange.end);
    }
  });

  it('sets level >= 2 for all L3 changes', () => {
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    for (const c of changes) {
      expect(c.level).toBeGreaterThanOrEqual(2);
    }
  });

  it('parses standalone comment type', () => {
    const doc = parser.parse(fixture);
    const changes = doc.getChanges();
    const cmt = changes.find(c => c.id === 'cn-6');
    expect(cmt).toBeDefined();
    expect(cmt!.type).toBe(ChangeType.Comment);
    expect(cmt!.status).toBe(ChangeStatus.Proposed);
  });

  it('positions rejected substitution using newText (body has proposed state)', () => {
    // Rejected sub: body still contains newText because applyReview only
    // updates the footnote header status, not the body text.
    const l3 = [
      '# Test',
      '',
      'The system delivers good results.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | rejected',
      '    3:ab {~~provides~>delivers~~}',
      '    rejected: @alice 2026-03-16 "Not the right word"',
    ].join('\n');
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    expect(sub!.type).toBe(ChangeType.Substitution);
    expect(sub!.status).toBe(ChangeStatus.Rejected);
    // Should find "delivers" (newText) in body — that's what's actually there
    // "delivers" is at column 11 on line 3; line 3 starts at offset 8
    expect(sub!.range.start).toBe(19); // 8 + 11
    expect(sub!.range.end).toBe(27); // 8 + 11 + 8 ("delivers".length)
  });

  it('handles stale hash via relocation', () => {
    // Create a document where the hash doesn't match the line content
    const staleDoc = `<!-- changedown.com/v1: tracked -->\n# Title\n\nModified line content.\n\n[^cn-1]: @alice | 2026-03-16 | ins | proposed\n    4:ff {++Modified ++}`;
    const doc = parser.parse(staleDoc);
    const changes = doc.getChanges();
    const ins = changes.find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    // Even with wrong hash, should still find the text via relocation or best-effort
    expect(ins!.type).toBe(ChangeType.Insertion);
  });
});

describe('deletion context parsing (@ctx:)', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('positions deletion using @ctx: context', () => {
    const l3 = [
      '# Test',
      '',
      'We should extend the timeline.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | proposed',
      '    3:ab {--old --} @ctx:"We should "||"extend the time"',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    expect(del!.type).toBe(ChangeType.Deletion);
    expect(del!.originalText).toBe('old ');
    // After bug 5 fix (Plan 1 Task 2): range covers the full contextual anchor
    // span (contextBefore + contextAfter), not a zero-width seam.
    // Line 3 starts at offset: "# Test\n\n".length = 8
    // joined = "We should " + "extend the time" = 25 chars
    expect(del!.range.start).toBe(8);
    expect(del!.range.end).toBe(8 + 'We should extend the time'.length);
    // Seam offset = contextBefore.length = 10
    expect(del!.deletionSeamOffset).toBe('We should '.length);
  });

  it('falls back to line start when @ctx: is missing', () => {
    const l3 = [
      '# Test',
      '',
      'We should extend the timeline.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | proposed',
      '    3:ab {--old --}',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    // Without context, falls back to line start (offset 8 for line 3)
    expect(del!.range.start).toBe(8);
  });

  it('handles escaped quotes in @ctx: context', () => {
    const l3 = [
      '# Test',
      '',
      'She said "hello" to everyone.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | proposed',
      '    3:ab {--old --} @ctx:"said \\"hello\\" "||"to everyone."',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    // Context with escaped quotes should still match
    expect(del!.range.start).toBeGreaterThan(0);
  });

  it('positions two deletions on the same line at distinct offsets', () => {
    const l3 = [
      '# Test',
      '',
      'But  contact center leaders have  expertise.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | proposed',
      '    3:ab {--most --} @ctx:"But "||" contact cen"',
      '',
      '[^cn-2]: @alice | 2026-03-16 | del | proposed',
      '    3:ab {--inbuilt --} @ctx:"rs have "||" expertise."',
    ].join('\n');
    const doc = parser.parse(l3);
    const changes = doc.getChanges();
    const del1 = changes.find(c => c.id === 'cn-1');
    const del2 = changes.find(c => c.id === 'cn-2');
    expect(del1).toBeDefined();
    expect(del2).toBeDefined();
    // They must have DIFFERENT positions (not both at line start)
    expect(del1!.range.start).not.toBe(del2!.range.start);
    // "most " deletion should be near the start (after "But ")
    // "inbuilt " deletion should be further along (after "have ")
    expect(del1!.range.start).toBeLessThan(del2!.range.start);
  });

  it('handles deletion at start of line (empty contextBefore)', () => {
    const l3 = [
      '# Test',
      '',
      'remaining text on line.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | proposed',
      '    3:ab {--old --} @ctx:""||"remaining tex"',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    // With empty before context, deletion should be at line start
    expect(del!.range.start).toBe(8); // line 3 offset
  });

  it('handles deletion at end of line (empty contextAfter)', () => {
    const l3 = [
      '# Test',
      '',
      'Some text before.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | proposed',
      '    3:ab {--old --} @ctx:"text before."||""',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    // Deletion at end — should be after "text before."
    expect(del!.range.start).toBeGreaterThan(8);
  });

  it('signals resolved:false (not line-start fallback) when findUniqueMatch is ambiguous', () => {
    // "the" appears twice on the line — findUniqueMatch returns null (ambiguous).
    // Updated per Task 3: ambiguous non-deletion ops now signal resolved:false rather
    // than silently falling back to line-start. This aligns with Invariant A.
    // Per spec §3.2 (Task 2.2): anchored is always true for L3 nodes (ref by construction);
    // resolved carries the position-resolution result.
    const l3 = [
      '# Test',
      '',
      'the cat and the dog.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab {++the++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    // L3 nodes always have anchored:true (footnote ref by construction)
    expect(ins!.anchored).toBe(true);
    // Should signal unresolved via resolved:false, not silently fall back to line start
    expect(ins!.resolved).toBe(false);
  });
});

// ─── Protocol overview title case regression (Task 4) ─────────────────────
// Bug: L3 substitution targeting "overview"→"Overview" was
// incorrectly decorating "Protocol" instead of "Overview" because the
// op text was ambiguous on the line.  After Tasks 2+3 the op text is expanded
// to be unique on the line, so "Protocol" is never touched.

describe('Protocol overview title-case regression', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  // Document layout:
  //   line 1: "# Protocol Overview and Practical Guidelines"  (44 chars)
  //   \n\n  →  line 3 starts at offset 46
  //   line 3: "Protocol Overview and Practical Guidelines"
  //   "Overview" at column 9 → range.start = 55, range.end = 63
  //   "Protocol" at column 0 → range.start = 46

  it('resolves substitution to "Overview", not "Protocol"', () => {
    // The substitution changes "overview" → "Overview" (capitalise).
    // After Task 2 expansion the op text includes enough context to be unique on
    // the line, so the parser pins the range to "Overview" (col 9).
    const l3 = [
      '# Protocol Overview and Practical Guidelines',
      '',
      'Protocol Overview and Practical Guidelines',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | proposed',
      '    3:ab {~~overview~>Overview~~}',
      '    @alice 2026-03-16: Capitalise for title case',
    ].join('\n');
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    expect(sub!.type).toBe(ChangeType.Substitution);
    // Must resolve to "Overview" at column 9, NOT "Protocol" at column 0
    expect(sub!.range.start).toBe(55); // 46 (line 3 offset) + 9 (col)
    expect(sub!.range.end).toBe(63);   // 55 + 8 ("Overview".length)
    expect(sub!.range.start).not.toBe(46); // 46 would be "Protocol"
  });

  it('"Protocol" is never decorated — range.start does not land on "Protocol"', () => {
    const l3 = [
      '# Protocol Overview and Practical Guidelines',
      '',
      'Protocol Overview and Practical Guidelines',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | proposed',
      '    3:ab {~~overview~>Overview~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    // "Protocol" starts at offset 46 on line 3 and has length 8 (offsets 46–53).
    // The substitution range must not overlap that span.
    // "Protocol" occupies offsets 46–53 (exclusive end = 54)
    if (sub!.anchored) {
      // If anchored, the range must be outside [46, 54)
      expect(sub!.range.start).toBeGreaterThanOrEqual(54);
    }
    // If not anchored (anchored:false), Protocol is definitely not decorated —
    // unresolved changes are intentionally not rendered.
  });

  it('unique substitution target resolves deterministically (anchored:true)', () => {
    // "Overview" appears exactly once on the line → should be anchored.
    const l3 = [
      '# Protocol Overview and Practical Guidelines',
      '',
      'Protocol Overview and Practical Guidelines',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | proposed',
      '    3:ab {~~overview~>Overview~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    // The newText "Overview" is unique on the line — parser must anchor it.
    expect(sub!.anchored).toBe(true);
  });

  it('ambiguous text near Protocol signals resolved:false to prevent wrong decoration', () => {
    // Pathological case: two identical tokens on same line as "Protocol".
    // The op text "AI" appears twice → findUniqueMatch returns null → resolved:false.
    // Per spec §3.2 (Task 2.2): anchored is always true for L3 nodes; resolved carries
    // the position-resolution result.
    const l3 = [
      '# Title',
      '',
      'Protocol AI solution and Google AI platform',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | proposed',
      '    3:ab {~~ai~>AI~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    // L3 nodes always have anchored:true (footnote ref by construction)
    expect(sub!.anchored).toBe(true);
    // "AI" appears at "Protocol AI" and "Google AI" → ambiguous → resolved:false
    expect(sub!.resolved).toBe(false);
  });
});

describe('L2→L3 expansion prevents title-case ambiguity (Task 4 integration)', () => {
  beforeAll(async () => { await initHashline(); });

  it('expands ambiguous substitution so "Overview" is unique in op text', async () => {
    // L2 document: substitution changes "overview" → "Overview" on a
    // line that also contains "Protocol".  The bare newText "Overview" is
    // unique on the line, so no expansion is needed — but we verify the round-trip.
    const l2 = [
      '# Protocol Overview and Practical Guidelines',
      '',
      'Protocol {~~overview~>Overview~~}[^cn-1] and Practical Guidelines',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | proposed',
      '    @alice 2026-03-16: Capitalise for title case',
    ].join('\n');
    const { convertL2ToL3 } = await import('@changedown/core/internals');
    const l3 = await convertL2ToL3(l2);

    // The emitted substitution edit-op must be unique on the body line.
    // Body line after accepting sub: "Protocol Overview and Practical Guidelines"
    const bodyLine = 'Protocol Overview and Practical Guidelines';
    const subMatch = l3.match(/\{~~([^~]+)~>([^~]+)~~\}/);
    expect(subMatch).toBeTruthy();
    const newText = subMatch![2];
    const occurrences = bodyLine.split(newText).length - 1;
    expect(occurrences).toBe(1);

    // The expanded op must contain "Overview"
    expect(newText).toContain('Overview');
  });

  it('does not incorrectly expand when target is already unique', async () => {
    // "Overview" is already unique — op should not be over-expanded.
    const l2 = [
      '# Protocol Overview and Practical Guidelines',
      '',
      'Protocol {~~overview~>Overview~~}[^cn-1] and Practical Guidelines',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | proposed',
    ].join('\n');
    const { convertL2ToL3 } = await import('@changedown/core/internals');
    const l3 = await convertL2ToL3(l2);

    // Must contain a substitution edit-op
    expect(l3).toMatch(/\{~~.*~>.*~~\}/);
    // Op text must include "Overview" on the newText side
    const subMatch = l3.match(/\{~~([^~]+)~>([^~]+)~~\}/);
    expect(subMatch).toBeTruthy();
    expect(subMatch![2]).toContain('Overview');
  });
});

// Task 3 GREEN: These tests assert the behavior after Task 3 removes silent fallback.
// Task 2.2 UPDATE: anchored is now always true for L3 nodes (footnote ref by construction);
// resolved carries the position-resolution result (false when text not found/ambiguous).
describe('deterministic anchor resolution — no silent fallback for non-deletion ops', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  // Line 3 offset: "# Test\n\n".length = 8
  const lineOffset = 8;

  it('ambiguous insertion text → resolved:false, not line-start', () => {
    // "the" appears twice — findUniqueMatch returns null (ambiguous)
    const l3 = [
      '# Test',
      '',
      'the cat and the dog.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab {++the++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    // L3 nodes always have anchored:true (footnote ref by construction)
    expect(ins!.anchored).toBe(true);
    // DESIRED: resolved:false (not silently placed at line start)
    expect(ins!.resolved).toBe(false);
    // DESIRED: range is NOT at line-start (no meaningful position was assigned)
    expect(ins!.range.start).not.toBe(lineOffset);
  });

  it('insertion text not found on line → resolved:false', () => {
    // "missing" does not appear in "the cat and the dog."
    const l3 = [
      '# Test',
      '',
      'the cat and the dog.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab {++missing++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    // L3 nodes always have anchored:true (footnote ref by construction)
    expect(ins!.anchored).toBe(true);
    // DESIRED: resolved:false (text is genuinely missing from body)
    expect(ins!.resolved).toBe(false);
  });

  it('ambiguous substitution target → resolved:false, not line-start', () => {
    // "can" appears twice — proposed sub newText is ambiguous
    const l3 = [
      '# Test',
      '',
      'You can do it, I can too.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | proposed',
      '    3:ab {~~could~>can~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    // L3 nodes always have anchored:true (footnote ref by construction)
    expect(sub!.anchored).toBe(true);
    // DESIRED: resolved:false (newText "can" is ambiguous on this line)
    expect(sub!.resolved).toBe(false);
    expect(sub!.range.start).not.toBe(lineOffset);
  });

  it('ambiguous highlight target → best-effort line-start, still anchored (comment visible)', () => {
    // "good" appears twice — highlight text is ambiguous.
    // Unlike ins/sub, highlights carry a comment as their primary payload.
    // Best-effort: pin to line-start so the comment is still visible.
    const l3 = [
      '# Test',
      '',
      'good work produces good results.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | highlight | proposed',
      '    3:ab {==good==}{>>This needs work',
    ].join('\n');
    const doc = parser.parse(l3);
    const hi = doc.getChanges().find(c => c.id === 'cn-1');
    expect(hi).toBeDefined();
    // Highlight: best-effort positioning at line-start, still rendered
    expect(hi!.anchored).toBe(true);
    expect(hi!.range.start).toBe(lineOffset);
    // Comment is preserved and visible
    expect(hi!.metadata?.comment).toContain('This needs work');
  });

  it('deletion without @ctx still falls back to line-start (Invariant B — acceptable degradation)', () => {
    // Deletion has no searchable text in body — line-start fallback is correct for del
    const l3 = [
      '# Test',
      '',
      'We should extend the timeline.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | proposed',
      '    3:ab {--old --}',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    // DESIRED: deletion WITHOUT @ctx falls back to line-start (this IS the correct behavior)
    expect(del!.range.start).toBe(lineOffset);
    // Deletion without @ctx should still be considered anchored (line-start is intentional)
    expect(del!.anchored).toBe(true);
  });
});

// ─── Discussion text preservation (Task 3) ───────────────────────────────────
describe('discussion text preservation in footnotes', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('comment footnote with discussion line → metadata.comment is populated', () => {
    // Footnote has a {>> op string with empty reasoning plus a discussion continuation line.
    // The parser should fall back to discussionText and surface it as metadata.comment.
    const l3 = [
      '# Test',
      '',
      'Some text on line three.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | comment | proposed',
      '    3:ab {>>',
      '    This is a standalone discussion line that should be preserved',
    ].join('\n');
    const doc = parser.parse(l3);
    const cmt = doc.getChanges().find(c => c.id === 'cn-1');
    expect(cmt).toBeDefined();
    expect(cmt!.type).toBe(ChangeType.Comment);
    expect(cmt!.metadata?.comment).toBeDefined();
    expect(cmt!.metadata!.comment).toContain('standalone discussion');
  });

  it('comment footnote with no op string but discussion line → comment populated from discussionText', () => {
    // No opString at all — only a discussion continuation line.
    const l3 = [
      '# Test',
      '',
      'Some text on line three.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | comment | proposed',
      '    This is a discussion-only comment with no op string',
    ].join('\n');
    const doc = parser.parse(l3);
    const cmt = doc.getChanges().find(c => c.id === 'cn-1');
    expect(cmt).toBeDefined();
    expect(cmt!.type).toBe(ChangeType.Comment);
    expect(cmt!.metadata?.comment).toBeDefined();
    expect(cmt!.metadata!.comment).toContain('discussion-only comment');
  });

  it('discussion text is stored on ins footnote without error', () => {
    // An insertion footnote with a discussion line — stored as discussionText.
    // The node should parse without error and anchor correctly.
    const l3 = [
      '# Test',
      '',
      'The system provides excellent results.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab {++excellent ++}',
      '    This is reasoning for the insertion',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.type).toBe(ChangeType.Insertion);
    expect(ins!.anchored).toBe(true);
  });

  it('comment with non-empty {>> op reasoning wins over discussionText', () => {
    // When parsedOp.reasoning is non-empty, it wins over discussionText.
    const l3 = [
      '# Test',
      '',
      'Some text on line three.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | comment | proposed',
      '    3:ab {>>Reasoning from op string',
      '    Discussion line that should NOT override op reasoning',
    ].join('\n');
    const doc = parser.parse(l3);
    const cmt = doc.getChanges().find(c => c.id === 'cn-1');
    expect(cmt).toBeDefined();
    expect(cmt!.metadata?.comment).toBe('Reasoning from op string');
    expect(cmt!.metadata!.comment).not.toContain('Discussion line');
  });
});

// ─── Ghost node / settled footnote handling (Task 4) ─────────────────────────
// Task 2.2 UPDATE: anchored is now always true for L3 nodes (footnote ref by construction).
// Settled/ghost nodes (no opString) have resolved:false — position cannot be determined.
describe('ghost nodes — settled footnotes without opString', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('footnote without opString → node has anchored:true, resolved:false', () => {
    // Settled/compacted footnote: the opString has been removed after accept/reject.
    // Per spec §3.2: anchored is always true (footnote ref exists by construction).
    // resolved:false signals that position cannot be determined — consumers use this
    // to filter ghost nodes from rendering.
    const l3 = [
      '# Test',
      '',
      'Some settled text here.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | accepted',
      '    approved: @alice 2026-03-16 "looks good"',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.anchored).toBe(true);
    expect(ins!.resolved).toBe(false);
  });

  it('footnote without opString → range does not stray to {0,0} falsely — still uses fallbackRange', () => {
    // The range will be the line-start fallback (not a meaningful position),
    // but resolved:false prevents consumers from rendering it as a real decoration.
    const l3 = [
      '# Test',
      '',
      'Some settled text here.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | accepted',
      '    approved: @alice 2026-03-16 "looks good"',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    // resolved:false is the key signal — the range value is not meaningful
    expect(ins!.anchored).toBe(true);
    expect(ins!.resolved).toBe(false);
  });

  it('settled deletion without opString → resolved:false', () => {
    const l3 = [
      '# Test',
      '',
      'The remaining text after deletion.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | accepted',
      '    approved: @alice 2026-03-16 "approved deletion"',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    expect(del!.anchored).toBe(true);
    expect(del!.resolved).toBe(false);
  });

  it('settled substitution without opString → resolved:false', () => {
    const l3 = [
      '# Test',
      '',
      'The new text after substitution.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | accepted',
      '    approved: @alice 2026-03-16 "approved substitution"',
    ].join('\n');
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    expect(sub!.anchored).toBe(true);
    expect(sub!.resolved).toBe(false);
  });

  it('discussion text still accessible on resolved:false ghost node', () => {
    // Even when resolved:false, the discussion text (if any) should be available
    // so the node can still surface comment/review information.
    const l3 = [
      '# Test',
      '',
      'Some settled text.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | accepted',
      '    This was the reasoning for the accepted change',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.anchored).toBe(true);
    expect(ins!.resolved).toBe(false);
    expect(ins!.metadata?.comment).toContain('reasoning for the accepted change');
  });
});

// ─── Contextual edit-op format parsing (Task 3) ───────────────────────────────
// Verifies that the parser correctly resolves contextual edit-ops of the form
// `contextBefore{op}contextAfter` — the new format emitted by L2→L3 conversion.
describe('contextual edit-op format parsing', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  // Document layout shared across several tests:
  //   line 1: "# Protocol Overview and Practical Guidelines"  (44 chars + \n\n = 46 bytes)
  //   line 2: ""  (\n = 1 byte)
  //   line 3: "Protocol overview and Practical Guidelines"  ← line offset = 46
  const LINE3_OFFSET = 46; // "# Protocol Overview and Practical Guidelines\n\n".length === 46

  it('contextual insertion resolution — resolves {++o++} with contextBefore+contextAfter', () => {
    // OpString: `Protocol {++o++}verview`
    // Body line: "Protocol overview and Practical Guidelines"
    // contextBefore="Protocol ", opText="o", contextAfter="verview"
    // bodyMatch="Protocol overview" → unique on line → position at col 9
    const l3 = [
      '# Protocol Overview and Practical Guidelines',
      '',
      'Protocol overview and Practical Guidelines',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab Protocol {++o++}verview',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.type).toBe(ChangeType.Insertion);
    expect(ins!.anchored).toBe(true);
    // "o" is at column 9 on line 3 ("Protocol " = 9 chars)
    expect(ins!.range.start).toBe(LINE3_OFFSET + 9);
    expect(ins!.range.end).toBe(LINE3_OFFSET + 10); // "o".length = 1
  });

  it('contextual deletion resolution — range covers contextual anchor span', () => {
    // OpString: `Protocol {--O--}verview`
    // Body line: "Protocol verview and Practical Guidelines" (O was deleted → not in body)
    // contextBefore="Protocol ", contextAfter="verview"
    // After Plan 1 Task 2 bug 5 fix: the range covers "Protocol verview" (the anchor span)
    // and deletionSeamOffset = "Protocol ".length = 9.
    const l3 = [
      '# Protocol Overview and Practical Guidelines',
      '',
      'Protocol verview and Practical Guidelines',
      '',
      '[^cn-1]: @alice | 2026-03-16 | del | proposed',
      '    3:ab Protocol {--O--}verview',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    expect(del!.type).toBe(ChangeType.Deletion);
    expect(del!.originalText).toBe('O');
    // Non-zero range covering "Protocol verview" on line 3
    expect(del!.range.start).toBe(LINE3_OFFSET);
    expect(del!.range.end).toBe(LINE3_OFFSET + 'Protocol verview'.length);
    // Seam = contextBefore.length = "Protocol ".length = 9
    expect(del!.deletionSeamOffset).toBe('Protocol '.length);
  });

  it('contextual substitution resolution — range covers newText at correct position', () => {
    // OpString: `Spec-{~~compliant~>comCpliant~~} trial`
    // Body line: "Spec-comCpliant trial"
    // contextBefore="Spec-", newText="comCpliant", contextAfter=" trial"
    // "Spec-comCpliant" is unique on line → position at col 5
    const l3 = [
      '# Title',
      '',
      'Spec-comCpliant trial',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | proposed',
      '    3:ab Spec-{~~compliant~>comCpliant~~} trial',
    ].join('\n');
    // line 3 offset: "# Title\n\n".length = 9
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    expect(sub!.type).toBe(ChangeType.Substitution);
    expect(sub!.anchored).toBe(true);
    // "comCpliant" starts at col 5 ("Spec-" = 5 chars), line 3 offset = 9
    expect(sub!.range.start).toBe(9 + 5);
    expect(sub!.range.end).toBe(9 + 5 + 'comCpliant'.length);
  });

  it('contextAfter-only format — change at column 0 with no contextBefore', () => {
    // OpString: `{++c++}onversational`
    // No contextBefore — the insertion is at the start of the line.
    // bodyMatch = "c" + "onversational" = "conversational" → unique on line → col 0
    const l3 = [
      '# Title',
      '',
      'conversational AI',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab {++c++}onversational',
    ].join('\n');
    // line 3 offset: "# Title\n\n".length = 9
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.type).toBe(ChangeType.Insertion);
    expect(ins!.anchored).toBe(true);
    // Insertion at column 0 (start of line 3)
    expect(ins!.range.start).toBe(9);
    expect(ins!.range.end).toBe(10); // "c".length = 1
  });

  it('preserves leading non-whitespace context through FOOTNOTE_L3_EDIT_OP regex', () => {

    const line = '    3:81 Protocol {++o++}verview';
    const match = line.match(FOOTNOTE_L3_EDIT_OP);
    expect(match).toBeTruthy();
    expect(match![3]).toBe('Protocol {++o++}verview');
  });

  it('preserves context for deletion edit-op through regex', () => {

    const line = '    3:81 Protocol o{--O--}verview';
    const match = line.match(FOOTNOTE_L3_EDIT_OP);
    expect(match).toBeTruthy();
    expect(match![3]).toBe('Protocol o{--O--}verview');
  });

  it('preserves context for substitution edit-op through regex', () => {

    const line = '    3:ab Spec-{~~compliant~>comCpliant~~} trial';
    const match = line.match(FOOTNOTE_L3_EDIT_OP);
    expect(match).toBeTruthy();
    expect(match![3]).toBe('Spec-{~~compliant~>comCpliant~~} trial');
  });

  it('still matches bare edit-ops with no context (backwards compat)', () => {

    const line = '    10:ff {++gRPC for internal service communication++}';
    const match = line.match(FOOTNOTE_L3_EDIT_OP);
    expect(match).toBeTruthy();
    expect(match![3]).toBe('{++gRPC for internal service communication++}');
  });

  it('preserves leading space in context when context starts with whitespace', () => {

    // Simulates an edit-op where contextBefore starts with a space.
    // The first space after "ab" is the format separator; the second space
    // is part of the context. With the old \s+ regex, both spaces would be
    // consumed as separator, destroying the leading context space.
    const line = '    3:ab  {++text++}rest';
    const match = line.match(FOOTNOTE_L3_EDIT_OP);
    expect(match).toBeTruthy();
    // Group 3 must preserve the leading space: " {++text++}rest"
    // With the old \s+ regex, both spaces would be consumed as separator,
    // yielding "{++text++}rest" (no leading space) — the contract violation.
    expect(match![3]).toBe(' {++text++}rest');
  });

  it('contextual highlight resolution — range covers highlighted text', () => {
    // OpString: `produces {==good==} results`
    // Body line: "good work produces good results."
    // contextBefore="produces ", opText="good", contextAfter=" results"
    // bodyMatch="produces good results" → unique on line
    const l3 = [
      '# Test',
      '',
      'good work produces good results.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | highlight | proposed',
      '    3:ab produces {==good==} results',
    ].join('\n');
    const doc = parser.parse(l3);
    const hi = doc.getChanges().find(c => c.id === 'cn-1');
    expect(hi).toBeDefined();
    expect(hi!.type).toBe(ChangeType.Highlight);
    expect(hi!.anchored).toBe(true);
    // "produces " = 9 chars on line 3, body line offset varies
    // Line 3 offset: "# Test\n\n".length = 8
    const lineOffset = 8;
    const bodyLine = 'good work produces good results.';
    const expectedCol = bodyLine.indexOf('produces good') + 'produces '.length;
    expect(hi!.range.start).toBe(lineOffset + expectedCol);
    expect(hi!.range.end).toBe(lineOffset + expectedCol + 'good'.length);
  });

  it('contextual rejected insertion — zero-width range (text not in body)', () => {
    // Rejected insertion: the text is NOT in the body (it was rejected).
    // Body: "Protocol verview and Practical Guidelines" (insertion of "o" was rejected → not present)
    // contextBefore = "Protocol ", contextAfter = "verview"
    // bodyMatch = "Protocol " + "" + "verview" = "Protocol verview"
    const l3 = [
      '# Test',
      '',
      'Protocol verview and Practical Guidelines',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | rejected',
      '    3:ab Protocol {++o++}verview',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.type).toBe(ChangeType.Insertion);
    expect(ins!.status).toBe(ChangeStatus.Rejected);
    // Rejected insertion: zero-width range at the insertion point
    expect(ins!.range.start).toBe(ins!.range.end);
    // Line offset: "# Test\n\n".length = 8, "Protocol " = 9 chars
    expect(ins!.range.start).toBe(8 + 9);
  });

  it('contextual rejected substitution — range covers oldText in body', () => {
    // Rejected sub: body has originalText "compliant", not "comCpliant"
    // OpString: `Spec-{~~compliant~>comCpliant~~} trial`
    // bodyMatch = "Spec-" + "compliant" + " trial" = "Spec-compliant trial"
    const l3 = [
      '# Title',
      '',
      'Spec-compliant trial',
      '',
      '[^cn-1]: @alice | 2026-03-16 | sub | rejected',
      '    3:ab Spec-{~~compliant~>comCpliant~~} trial',
    ].join('\n');
    // Line 3 offset: "# Title\n\n".length = 9
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    expect(sub!.type).toBe(ChangeType.Substitution);
    expect(sub!.status).toBe(ChangeStatus.Rejected);
    expect(sub!.anchored).toBe(true);
    // Rejected: range covers "compliant" (originalText)
    expect(sub!.range.start).toBe(9 + 5); // "Spec-" = 5 chars
    expect(sub!.range.end).toBe(9 + 5 + 'compliant'.length);
  });

  it('falls through to legacy resolution for bare edit-ops (backwards compat)', () => {
    // No context — bare {++text++} format (pre-contextual-edit-op)
    const l3 = [
      '# Test',
      '',
      'Hello world added text here.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab {++added text ++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.anchored).toBe(true);
    // "added text " found on line via legacy findOnLine
    const lineOffset = 8; // "# Test\n\n"
    expect(ins!.range.start).toBe(lineOffset + 'Hello world '.length);
  });

  it('round-trip: L2→L3 contextual emission → parser resolves correct range', async () => {
    // L2 doc with an ambiguous insertion: "ll" appears twice after accepting
    // (in "hello" at col 2, and in "hello" at col 12).
    // Body after L2→L3: "hello and hello world"
    // The emitter wraps the FIRST op in context e.g. "he{++ll++}o a" to pin it;
    // the parser must resolve the range to the FIRST "ll" (col 2), not the second.
    const l2 = [
      '# Test',
      '',
      'he{++ll++}[^cn-1]o and hello world',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
    ].join('\n');
    const { convertL2ToL3 } = await import('@changedown/core/internals');
    const l3 = await convertL2ToL3(l2);

    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.type).toBe(ChangeType.Insertion);
    expect(ins!.anchored).toBe(true);

    // Body line: "hello and hello world"
    // "ll" at column 2 in the first "hello".
    // Body line offset: "# Test\n\n".length = 8
    const lineOffset = 8;
    const bodyLine = 'hello and hello world';
    const expectedCol = bodyLine.indexOf('ll'); // col 2
    expect(expectedCol).toBe(2); // sanity check
    expect(ins!.range.start).toBe(lineOffset + expectedCol);
    expect(ins!.range.end).toBe(lineOffset + expectedCol + 'll'.length);
  });
});

// ─── Long-form type names (crystallization round-trip bug fix) ──────────────
// generateFootnoteDefinition historically produced long-form type names
// ('insertion', 'deletion', 'substitution') but resolveType only accepted
// short-form ('ins', 'del', 'sub'). Documents written with long-form types
// must still parse correctly.

describe('long-form footnote type names', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('parses insertion with long-form type name', () => {
    const l3 = [
      '# Test',
      '',
      'Hello beautiful world.',
      '',
      '[^cn-1]: @hackerbara | 2026-03-19 | insertion | proposed',
      '    3:ab {++beautiful ++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const ins = doc.getChanges().find(c => c.id === 'cn-1');
    expect(ins).toBeDefined();
    expect(ins!.type).toBe(ChangeType.Insertion);
    expect(ins!.status).toBe(ChangeStatus.Proposed);
    expect(ins!.anchored).toBe(true);
  });

  it('parses deletion with long-form type name', () => {
    const l3 = [
      '# Test',
      '',
      'Hello world.',
      '',
      '[^cn-1]: @hackerbara | 2026-03-19 | deletion | proposed',
      '    3:ab {--old --} @ctx:"Hello "||"world."',
    ].join('\n');
    const doc = parser.parse(l3);
    const del = doc.getChanges().find(c => c.id === 'cn-1');
    expect(del).toBeDefined();
    expect(del!.type).toBe(ChangeType.Deletion);
  });

  it('parses substitution with long-form type name', () => {
    const l3 = [
      '# Test',
      '',
      'Hello new world.',
      '',
      '[^cn-1]: @hackerbara | 2026-03-19 | substitution | proposed',
      '    3:ab {~~old~>new~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const sub = doc.getChanges().find(c => c.id === 'cn-1');
    expect(sub).toBeDefined();
    expect(sub!.type).toBe(ChangeType.Substitution);
  });

  it('mixed short-form and long-form types in same document', () => {
    const l3 = [
      '# Test',
      '',
      'Hello beautiful new world.',
      '',
      '[^cn-1]: @jennifer | 2026-02-20 | ins | proposed',
      '    3:ab {++beautiful ++}',
      '',
      '[^cn-2]: @hackerbara | 2026-03-19 | substitution | proposed',
      '    3:ab {~~old~>new~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const changes = doc.getChanges();
    expect(changes.length).toBe(2);
    expect(changes.find(c => c.id === 'cn-1')!.type).toBe(ChangeType.Insertion);
    expect(changes.find(c => c.id === 'cn-2')!.type).toBe(ChangeType.Substitution);
  });
});

// ─── Edit-over-edit resolution via protocol delegation (Task 6) ──────────────
// When a later operation consumes an earlier one (e.g., insert then delete the
// same text), the parser's single-pass resolution cannot find the consumed text
// in the body. The resolution protocol fallback runs scrubBackward + scrubForward
// to confirm the consumed operation is valid.
describe('edit-over-edit resolution', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('resolves consumed operations via protocol delegation', () => {
    // cn-1 inserts "very " into "The lazy dog" → "The very lazy dog"
    // cn-2 deletes "very " from "The very lazy dog" → "The lazy dog"
    // Current body is "The lazy dog" — cn-1's text is consumed and absent.
    // The parser's single-pass cannot find "very " in the body.
    // Per spec §3.2 (Task 2.2): L3 nodes always have anchored:true (footnote ref by
    // construction). Consumed ops stay resolved:false; consumedBy is set by the
    // protocol replay (covered by scrub.test.ts Task 6 coverage).
    const l3 = [
      'The lazy dog',
      '',
      '[^cn-1]: @alice | 2026-03-20 | ins | proposed',
      '    1:ab The {++very ++}lazy dog',
      '[^cn-2]: @alice | 2026-03-20 | del | proposed',
      '    1:cd The {--very --}lazy dog',
    ].join('\n');

    const doc = parser.parse(l3);
    const changes = doc.getChanges();

    const ct1 = changes.find(c => c.id === 'cn-1');
    expect(ct1).toBeDefined();
    expect(ct1!.anchored).toBe(true);    // always true for L3 nodes (Task 2.2)
    expect(ct1!.resolved).toBe(false);   // text absent from body — position unresolved

    // cn-2 should also have anchored:true (L3 node by construction)
    const ct2 = changes.find(c => c.id === 'cn-2');
    expect(ct2).toBeDefined();
    expect(ct2!.anchored).toBe(true);
  });

  it('leaves genuinely unresolvable operations as anchored:true, resolved:false', () => {
    // cn-1 references text that has never existed in any body state.
    // The resolution protocol cannot locate it — resolved stays false.
    // Per spec §3.2 (Task 2.2): anchored is always true for L3 nodes (ref by construction);
    // resolved:false signals that the position could not be determined.
    const l3 = [
      '<!-- changedown.com/v1: tracked -->',
      'The lazy dog',
      '',
      '[^cn-1]: @alice | 2026-03-20 | ins | proposed',
      '    2:a1 {++nonexistent++}',
    ].join('\n');

    const doc = parser.parse(l3);
    const changes = doc.getChanges();
    const ct1 = changes.find(c => c.id === 'cn-1');
    expect(ct1).toBeDefined();
    expect(ct1!.anchored).toBe(true);   // always true for L3 nodes (footnote ref exists)
    expect(ct1!.resolved).toBe(false);  // text not found in body — position unresolved
  });
});

// ─── Task 2.2: anchored/resolved split at the construction site ───────────────
// Spec §3.2: L3 nodes always have anchored:true (footnote ref by construction).
// The separate resolved axis carries the position-resolution result.
describe('L3 parser anchored/resolved split (Task 2.2)', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('sets anchored:true, resolved:false when insertion text not found in body', () => {
    // "missing" does not appear on body line 3 — position cannot be resolved.
    // The footnote ref exists (anchored:true) but the edit-op text is absent (resolved:false).
    const l3 = [
      'body line one',
      'body line two',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | ins | proposed',
      '    1:ab {++missing++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const change = doc.getChanges().find(c => c.id === 'cn-1');
    expect(change).toBeDefined();
    expect(change!.anchored).toBe(true);   // ref exists in footnote block
    expect(change!.resolved).toBe(false);  // position unresolved — text not in body
  });

  it('sets anchored:true, resolved:true when insertion text found uniquely', () => {
    // "original" appears exactly once on body line 1 — position resolves deterministically.
    const l3 = [
      'original text here',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | ins | proposed',
      '    1:ab {++original++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const change = doc.getChanges().find(c => c.id === 'cn-1');
    expect(change).toBeDefined();
    expect(change!.anchored).toBe(true);  // ref exists in footnote block
    expect(change!.resolved).toBe(true);  // "original" found uniquely on line 1
  });
});

// ─── Task 2.3: coordinate_failed diagnostic for missing parsedOp ──────────────
// Spec §3.2 Sites 2-4: when a footnote has no edit-op (settled/ghost), the parser
// emits a coordinate_failed diagnostic on Document.diagnostics in addition to
// setting resolved:false on the ChangeNode.
describe('L3 parser emits coordinate_failed diagnostic for missing parsedOp (Task 2.3)', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('does not emit coordinate_failed for rejected superseded archival records', () => {
    const input = [
      'Use plain text.',
      '',
      '[^cn-1]: @ai | 2026-05-05 | sub | rejected',
      '    superseded-by: cn-2',
    ].join('\n');

    const doc = parser.parse(input);
    const diagnostics = doc.getDiagnostics();
    expect(diagnostics.filter((d) => d.kind === 'coordinate_failed' && d.changeId === 'cn-1')).toHaveLength(0);
  });

  it('still emits coordinate_failed for rejected records that are not archival', () => {
    const input = [
      'Use plain text.',
      '',
      '[^cn-1]: @ai | 2026-05-05 | sub | rejected',
    ].join('\n');

    const doc = parser.parse(input);
    const diagnostics = doc.getDiagnostics();
    expect(diagnostics.some((d) => d.kind === 'coordinate_failed')).toBe(true);
  });

  it('emits coordinate_failed diagnostic when footnote has no edit-op line', () => {
    // Settled/compacted footnote: the edit-op line has been removed after acceptance.
    // Only the header and approval metadata remain — no `    N:HASH op` line.
    const l3 = [
      '# Test',
      '',
      'Some settled text here.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | accepted',
      '    approved: @alice 2026-03-16 "looks good"',
    ].join('\n');
    const doc = parser.parse(l3);
    const diags = doc.getDiagnostics();
    const found = diags.find(d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1');
    expect(found).toBeDefined();
    expect(found!.message).toContain('cn-1');
    expect(found!.message).toContain('parsedOp');
  });

  it('does NOT emit coordinate_failed when footnote has a valid edit-op', () => {
    // Normal footnote with an edit-op line — no diagnostic expected.
    const l3 = [
      '# Test',
      '',
      'Hello world.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab {++world++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const diags = doc.getDiagnostics();
    const found = diags.find(d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1');
    expect(found).toBeUndefined();
  });

  it('emits one coordinate_failed per missing-op footnote in a multi-footnote document', () => {
    // Two settled footnotes, both missing edit-ops → two diagnostics.
    const l3 = [
      '# Test',
      '',
      'Some text.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | accepted',
      '    approved: @alice 2026-03-16 "ok"',
      '',
      '[^cn-2]: @alice | 2026-03-16 | del | accepted',
      '    approved: @alice 2026-03-16 "ok"',
    ].join('\n');
    const doc = parser.parse(l3);
    const diags = doc.getDiagnostics().filter(d => d.kind === 'coordinate_failed');
    expect(diags.length).toBe(2);
    expect(diags.find(d => d.changeId === 'cn-1')).toBeDefined();
    expect(diags.find(d => d.changeId === 'cn-2')).toBeDefined();
  });

  it('node has anchored:true, resolved:false — not anchored:false', () => {
    // coordinate_failed goes with anchored:true/resolved:false (ref exists, position unknown),
    // not anchored:false (which would mean no footnote ref at all).
    const l3 = [
      '# Test',
      '',
      'Some settled text here.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | accepted',
      '    approved: @alice 2026-03-16 "looks good"',
    ].join('\n');
    const doc = parser.parse(l3);
    const change = doc.getChanges().find(c => c.id === 'cn-1');
    expect(change).toBeDefined();
    expect(change!.anchored).toBe(true);
    expect(change!.resolved).toBe(false);
  });

  it('diagnostics persist across multiple parse() calls on same parser instance', () => {
    // Parser instances are reused (e.g. via l3Parser singleton in workspace.ts).
    // Each call must have a fresh diagnostics slate — previous run's diagnostics
    // must not bleed into the next run.
    const settled = [
      '# Test',
      '',
      'Text.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | accepted',
      '    approved: @alice 2026-03-16 "ok"',
    ].join('\n');
    const normal = [
      '# Test',
      '',
      'Hello world.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
      '    3:ab {++world++}',
    ].join('\n');

    // First call: settled footnote → should have diagnostic
    const doc1 = parser.parse(settled);
    expect(doc1.getDiagnostics().filter(d => d.kind === 'coordinate_failed').length).toBe(1);

    // Second call: normal footnote → no diagnostic (no bleed from first call)
    const doc2 = parser.parse(normal);
    expect(doc2.getDiagnostics().filter(d => d.kind === 'coordinate_failed').length).toBe(0);
  });
});

// ─── Task 2.4: coordinate_failed diagnostic for unfound insertion text ─────────
// Spec §3.2 Sites 2-4: when the insertion text cannot be uniquely located on the
// target line, the parser emits a coordinate_failed diagnostic and returns
// anchored:true / resolved:false (the footnote ref exists but position is unknown).
describe('L3 parser emits coordinate_failed diagnostic for unfound insertion text (Task 2.4)', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('emits coordinate_failed when insertion text is absent from the target line', () => {
    // "missing-anchor-text" does not appear on body line 1 → coordinate_failed.
    const l3 = [
      'body line one',
      'body line two',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | ins | proposed',
      '    1:ab {++missing-anchor-text++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const diags = doc.getDiagnostics();
    const found = diags.find(d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1');
    expect(found).toBeDefined();
    expect(found!.message).toContain('missing-anchor-text');
    expect(found!.message).toContain('line 1');
  });

  it('sets anchored:true, resolved:false on the ChangeNode (not anchored:false)', () => {
    // The node must use anchored:true/resolved:false — not the old anchored:false sentinel.
    const l3 = [
      'body line one',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | ins | proposed',
      '    1:ab {++not-here++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const change = doc.getChanges().find(c => c.id === 'cn-1');
    expect(change).toBeDefined();
    expect(change!.anchored).toBe(true);
    expect(change!.resolved).toBe(false);
  });

  it('does NOT emit coordinate_failed when insertion text is found on the line', () => {
    // "original" appears on line 1 → no diagnostic.
    const l3 = [
      'original text here',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | ins | proposed',
      '    1:ab {++original++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const diags = doc.getDiagnostics();
    const found = diags.find(d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1');
    expect(found).toBeUndefined();
  });

  it('diagnostic evidence carries line number, expectedText, and candidates count', () => {
    const l3 = [
      'body line one',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | ins | proposed',
      '    1:ab {++absent-text++}',
    ].join('\n');
    const doc = parser.parse(l3);
    const found = doc.getDiagnostics().find(d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1');
    expect(found).toBeDefined();
    expect(found!.evidence).toBeDefined();
    expect(found!.evidence!.line).toBe(1);
    expect(found!.evidence!.expectedText).toBe('absent-text');
    expect(typeof found!.evidence!.candidates).toBe('number');
  });
});

// ─── Task 2.5: coordinate_failed diagnostic for unfound substitution newText ──
// Spec §3.2 Sites 2-4: when the substitution newText cannot be uniquely located
// on the target line, the parser emits a coordinate_failed diagnostic and returns
// anchored:true / resolved:false (the footnote ref exists but position is unknown).
describe('L3 parser emits coordinate_failed diagnostic for unfound substitution newText (Task 2.5)', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('emits coordinate_failed when substitution newText is absent from the target line', () => {
    // "replacement-text" does not appear on body line 1 → coordinate_failed.
    const l3 = [
      'body line one',
      'body line two',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | sub | proposed',
      '    1:ab {~~original~>replacement-text~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const diags = doc.getDiagnostics();
    const found = diags.find(d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1');
    expect(found).toBeDefined();
    expect(found!.message).toContain('Substitution text');
    expect(found!.message).toContain('replacement-text');
    expect(found!.message).toContain('line 1');
  });

  it('sets anchored:true, resolved:false on the ChangeNode (not anchored:false)', () => {
    // The node must use anchored:true/resolved:false — not the old anchored:false sentinel.
    const l3 = [
      'body line one',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | sub | proposed',
      '    1:ab {~~original~>not-here~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const change = doc.getChanges().find(c => c.id === 'cn-1');
    expect(change).toBeDefined();
    expect(change!.anchored).toBe(true);
    expect(change!.resolved).toBe(false);
  });

  it('does NOT emit coordinate_failed when substitution newText is found on the line', () => {
    // "newword" appears on line 1 → no diagnostic.
    const l3 = [
      'the newword is here',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | sub | proposed',
      '    1:ab {~~oldword~>newword~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const diags = doc.getDiagnostics();
    const found = diags.find(d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1');
    expect(found).toBeUndefined();
  });

  it('diagnostic evidence carries line number, expectedText, and candidates count', () => {
    const l3 = [
      'body line one',
      '',
      '[^cn-1]: @human:test | 2026-01-01 | sub | proposed',
      '    1:ab {~~old~>absent-new-text~~}',
    ].join('\n');
    const doc = parser.parse(l3);
    const found = doc.getDiagnostics().find(d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1');
    expect(found).toBeDefined();
    expect(found!.evidence).toBeDefined();
    expect(found!.evidence!.line).toBe(1);
    expect(found!.evidence!.expectedText).toBe('absent-new-text');
    expect(typeof found!.evidence!.candidates).toBe('number');
  });
});

// ─── Task 2.6: replay protocol clears diagnostics on successful recovery ──────
// Spec §3.2: when the replay protocol successfully recovers a node that the
// initial parse couldn't anchor (e.g. ambiguous text match), the diagnostic
// emitted during the initial pass must be removed. The document must not carry
// a stale coordinate_failed record after recovery.
describe('L3 parser replay recovery clears coordinate_failed diagnostic (Task 2.6)', () => {
  beforeAll(async () => { await initHashline(); });

  const parser = new FootnoteNativeParser();

  it('removes coordinate_failed diagnostic when replay resolves the node', () => {
    // cn-1 inserts "very " — the body has "very " twice, so the initial text
    // search finds 2 matches (ambiguous) and emits coordinate_failed + resolved:false.
    // cn-2 substitutes "lazy"→"sleepy". The replay protocol traces the edit
    // history and resolves cn-1's position → resolved:true, resolutionPath:'replay'.
    // After replay, the coordinate_failed diagnostic for cn-1 must be gone.
    const l3 = [
      'The very very sleepy dog.',
      '',
      '[^cn-1]: @alice | 2026-03-20 | ins | proposed',
      '    1:ff The {++very ++}very lazy dog.',
      '',
      '[^cn-2]: @bob | 2026-03-21 | sub | proposed',
      '    1:ee The very very {~~lazy~>sleepy~~} dog.',
    ].join('\n');

    const doc = parser.parse(l3);

    // Replay must have recovered cn-1.
    const cn1 = doc.getChanges().find(c => c.id === 'cn-1');
    expect(cn1).toBeDefined();
    expect(cn1!.resolved).toBe(true);
    expect(cn1!.resolutionPath).toBe('replay');

    // The coordinate_failed diagnostic emitted for cn-1 during the initial pass
    // must have been removed from the document.
    const diag = doc.getDiagnostics().find(
      d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1',
    );
    expect(diag).toBeUndefined();
  });

  it('retains coordinate_failed diagnostic for a node the replay cannot recover', () => {
    // cn-1 references text that never appears in any body state — replay cannot
    // locate it. The diagnostic must remain on the document.
    const l3 = [
      'The lazy dog',
      '',
      '[^cn-1]: @alice | 2026-03-20 | ins | proposed',
      '    1:a1 {++nonexistent-phrase++}',
    ].join('\n');

    const doc = parser.parse(l3);

    const cn1 = doc.getChanges().find(c => c.id === 'cn-1');
    expect(cn1).toBeDefined();
    expect(cn1!.resolved).toBe(false);

    // Diagnostic must still be present — replay didn't fix it.
    const diag = doc.getDiagnostics().find(
      d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1',
    );
    expect(diag).toBeDefined();
  });

  it('only removes diagnostics for recovered nodes, not for still-unresolved ones', () => {
    // cn-1 inserts ambiguous "very " → recovered by replay (diagnostic removed).
    // cn-2 inserts "phantom-word" that never appears → stays unresolved (diagnostic kept).
    // cn-3 substitutes "lazy"→"sleepy" — gives replay context to resolve cn-1.
    const l3 = [
      'The very very sleepy dog.',
      '',
      '[^cn-1]: @alice | 2026-03-20 | ins | proposed',
      '    1:ff The {++very ++}very lazy dog.',
      '',
      '[^cn-2]: @alice | 2026-03-20 | ins | proposed',
      '    1:gg {++phantom-word++}',
      '',
      '[^cn-3]: @bob | 2026-03-21 | sub | proposed',
      '    1:ee The very very {~~lazy~>sleepy~~} dog.',
    ].join('\n');

    const doc = parser.parse(l3);

    // cn-1 recovered — no diagnostic.
    const diag1 = doc.getDiagnostics().find(
      d => d.kind === 'coordinate_failed' && d.changeId === 'cn-1',
    );
    expect(diag1).toBeUndefined();

    // cn-2 still unresolved — diagnostic present.
    const diag2 = doc.getDiagnostics().find(
      d => d.kind === 'coordinate_failed' && d.changeId === 'cn-2',
    );
    expect(diag2).toBeDefined();
  });
});
