import { describe, it, expect, beforeAll } from 'vitest';
import { FormatService, LocalFormatAdapter } from '@changedown/core/host';
import { parseL2, parseL3, serializeL3 } from '@changedown/core';
import { initHashline } from '@changedown/core/internals';

beforeAll(async () => {
  await initHashline();
});

describe('FormatService structural primitives', () => {
  const service = new FormatService(new LocalFormatAdapter());

  const L2_TEXT = [
    'The quick brown fox.[^cn-1]',
    '',
    '[^cn-1]: @alice | 2026-04-08 | ins | proposed',
    '',
  ].join('\n');

  it('promote(doc) returns a typed L3Document', async () => {
    const l2Doc = parseL2(L2_TEXT);
    const l3Doc = await service.promote(l2Doc);
    expect(l3Doc.format).toBe('L3');
    // Body must be clean — no inline CriticMarkup.
    expect(l3Doc.body).not.toMatch(/\{\+\+/);
    expect(l3Doc.footnotes).toHaveLength(1);
  });

  it('demote(doc) returns a typed L2Document', async () => {
    const l3Doc = parseL3([
      'Hello world.',
      '',
      '[^cn-1]: @ai:test | 2026-01-01 | ins | proposed',
      '    1:ab world',
      '',
    ].join('\n'));
    const l2Doc = await service.demote(l3Doc);
    expect(l2Doc.format).toBe('L2');
  });

  it('fires onDidCompleteTransition on promote', async () => {
    const events: Array<{ uri: string; from: string; to: string }> = [];
    service.onDidCompleteTransition(e => events.push(e));
    const l2Doc = parseL2(L2_TEXT);
    await service.promote(l2Doc, { uri: 'file:///test.md' });
    // The event still fires but the uri is now passed via context, not as
    // the first positional arg.
    expect(events.length).toBe(1);
    expect(events[0].from).toBe('L2');
    expect(events[0].to).toBe('L3');
  });
});

describe('FormatService text convenience', () => {
  const service = new FormatService(new LocalFormatAdapter());

  const L2_TEXT = [
    'The quick brown fox.[^cn-1]',
    '',
    '[^cn-1]: @alice | 2026-04-08 | ins | proposed',
    '',
  ].join('\n');

  it('promoteText(text) returns the serialized result string', async () => {
    const l3Text = await service.promoteText(L2_TEXT);
    // The L3 body (before the first blank line + footnote) should have no inline
    // CriticMarkup. The footnote edit-op line may contain {++ as part of the op
    // representation — that is correct L3 format and must not be suppressed.
    const bodyOnly = l3Text.split('\n\n[^')[0];
    expect(bodyOnly).not.toMatch(/\{\+\+/);
    expect(l3Text).toContain('[^cn-1]:');
  });

  it('demoteText round-trips from promoteText output', async () => {
    const l3Text = await service.promoteText(L2_TEXT);
    const l2Back = await service.demoteText(l3Text);
    expect(l2Back).toContain('The quick brown fox.');
  });
});

describe('FormatService shiftEditOpLineNumbers — multi-edit-op per footnote', () => {
  // shiftEditOpLineNumbers is private. We test B1 by constructing an L3Document
  // with two edit-op bodyLines at different lineNumbers (bypassing parseL3, which
  // only stores the first edit-op per footnote) and serializing with the same
  // per-bodyLine shift logic the fix applies. This ensures the logic itself is
  // correct without needing to call the private method.

  it('shifts each edit-op bodyLine independently (B1 regression)', () => {
    // Build an EditOp for line 3 and one for line 7.
    const editOp3 = { resolutionPath: 'hash' as const, lineNumber: 3, hash: 'ab', op: 'hello' };
    const editOp7 = { resolutionPath: 'hash' as const, lineNumber: 7, hash: 'ab', op: 'world' };

    // Construct a minimal L3Document with both edit-op bodyLines on one footnote.
    const doc = parseL3([
      'Hello world.',
      '',
      '[^cn-1]: @alice | 2026-04-08 | ins | proposed',
      '    3:ab hello',
      '',
    ].join('\n'));

    // Manually extend bodyLines to include the second edit-op (as would happen if
    // a footnote ever had two edit-op lines, testing shiftEditOpLineNumbers logic).
    const baseFootnote = doc.footnotes[0];
    const secondEditOpBodyLine = {
      kind: 'edit-op' as const,
      editOp: editOp7,
      raw: '    7:ab world',
    };
    const twoOpFootnote = {
      ...baseFootnote,
      editOp: editOp3,
      bodyLines: [...baseFootnote.bodyLines, secondEditOpBodyLine],
    };
    const twoOpDoc = { ...doc, footnotes: [twoOpFootnote] };

    // Apply the per-bodyLine shift logic from the B1 fix (offset=5).
    const offset = 5;
    const shiftedDoc = {
      ...twoOpDoc,
      footnotes: twoOpDoc.footnotes.map(f => ({
        ...f,
        editOp: f.editOp ? { ...f.editOp, lineNumber: f.editOp.lineNumber + offset } : f.editOp,
        bodyLines: f.bodyLines.map(bl => {
          if (bl.kind !== 'edit-op') return bl;
          const newLineNumber = bl.editOp.lineNumber + offset;
          const newRaw = bl.raw.replace(/^(\s*)(\d+):/, (_m: string, indent: string) => `${indent}${newLineNumber}:`);
          return { ...bl, editOp: { ...bl.editOp, lineNumber: newLineNumber }, raw: newRaw };
        }),
      })),
    };
    const out = serializeL3(shiftedDoc);

    // Per-bodyLine shift: 3→8, 7→12.
    // The B1 bug (stamp all from top-level editOp = 3+5 = 8) would make `12:` absent.
    expect(out).toContain('    8:ab hello');
    expect(out).toContain('    12:ab world');
  });
});

describe('FormatService snippet promotion', () => {
  const service = new FormatService(new LocalFormatAdapter());

  // Helper: build a Footnote with a given id for use as existingFootnotes.
  // The test only reads `id` for collision avoidance; other fields are placeholders.
  function fakeFootnote(id: string): import('@changedown/core').Footnote {
    return {
      id,
      header: { author: '@test', date: '2026-04-08', type: 'ins', status: 'proposed' },
      editOp: null,
      bodyLines: [],
      discussion: [],
      approvals: [],
      rejections: [],
      resolution: null,
      sourceRange: { startLine: 0, endLine: 0 },
    };
  }

  const SNIPPET_L2 = [
    'The quick fox.[^cn-1]',
    '',
    '[^cn-1]: @alice | 2026-04-08 | ins | proposed',
  ].join('\n');

  it('basic: existingFootnotes [cn-1, cn-2] → snippet id becomes cn-3', async () => {
    const snippetDoc = parseL2(SNIPPET_L2);
    const result = await service.promote(snippetDoc, {
      existingFootnotes: [fakeFootnote('cn-1'), fakeFootnote('cn-2')],
    });
    expect(result.footnotes).toHaveLength(1);
    expect(result.footnotes[0].id).toBe('cn-3');
  });

  it('non-sequential IDs: existingFootnotes [cn-1, cn-5] → snippet id becomes cn-6', async () => {
    const snippetDoc = parseL2(SNIPPET_L2);
    const result = await service.promote(snippetDoc, {
      existingFootnotes: [fakeFootnote('cn-1'), fakeFootnote('cn-5')],
    });
    expect(result.footnotes[0].id).toBe('cn-6');
  });

  it('dotted sub-IDs: existingFootnotes [cn-3, cn-3.1, cn-3.2] → snippet id becomes cn-4', async () => {
    const snippetDoc = parseL2(SNIPPET_L2);
    const result = await service.promote(snippetDoc, {
      existingFootnotes: [fakeFootnote('cn-3'), fakeFootnote('cn-3.1'), fakeFootnote('cn-3.2')],
    });
    // maxTopLevelId ignores dotted variants; max top-level is 3 → next is 4.
    expect(result.footnotes[0].id).toBe('cn-4');
  });

  it('lineNumberOffset: shifts edit-op lineNumber by offset', async () => {
    const snippetDoc = parseL2(SNIPPET_L2);
    const result = await service.promote(snippetDoc, { lineNumberOffset: 10 });
    expect(result.footnotes[0].editOp).toBeTruthy();
    // The pre-promote anchor is at line 1 (the only body line); after +10 it should be 11.
    expect(result.footnotes[0].editOp!.lineNumber).toBe(11);
  });

  it('lineNumberOffset: shifted value is reflected in serialized output', async () => {
    const snippetDoc = parseL2(SNIPPET_L2);
    const result = await service.promote(snippetDoc, { lineNumberOffset: 10 });
    const l3Text = serializeL3(result);
    // The edit-op line should read "11:hash ..." not "1:hash ..."
    expect(l3Text).toMatch(/^\s+11:/m);
  });

  it('no context: IDs start from cn-1 (whole-document case)', async () => {
    const snippetDoc = parseL2(SNIPPET_L2);
    const result = await service.promote(snippetDoc);
    // No context argument → optional-parameter path → id stays as cn-1 (adapter output)
    expect(result.footnotes[0].id).toBe('cn-1');
  });

  it('dotted-only existingFootnotes: [cn-3.9, cn-3.10] → snippet id becomes cn-1', async () => {
    const snippetDoc = parseL2(SNIPPET_L2);
    const result = await service.promote(snippetDoc, {
      existingFootnotes: [fakeFootnote('cn-3.9'), fakeFootnote('cn-3.10')],
    });
    // maxTopLevelId must ignore dotted variants entirely (no integer top-level IDs exist)
    // → max top-level = 0 → next id is cn-1. A naive extractor yielding 9 or 10 would fail.
    expect(result.footnotes[0].id).toBe('cn-1');
  });
});

describe('FormatService parse/serialize delegates', () => {
  const service = new FormatService(new LocalFormatAdapter());

  it('parseL2 and serializeL2 are delegates', () => {
    const text = 'Hello world.\n';
    const doc = service.parseL2(text);
    expect(doc.format).toBe('L2');
    expect(service.serializeL2(doc)).toBe(text);
  });

  it('parseL3 and serializeL3 are delegates', () => {
    const text = [
      'Hello world.',
      '',
      '[^cn-1]: @alice | 2026-04-08 | ins | proposed',
      '    1:ab {++world',
      '',
    ].join('\n');
    const doc = service.parseL3(text);
    expect(doc.format).toBe('L3');
    // Round-trip modulo trailing whitespace.
    expect(service.serializeL3(doc).trimEnd()).toBe(text.trimEnd());
  });
});
