import { describe, it, expect, beforeAll } from 'vitest';
import {
  computeDecidedLine,
  computeDecidedView,
  formatDecidedOutput,
  initHashline,
  computeLineHash,
  type FootnoteStatus,
} from '@changedown/core/internals';
import { parseForFormat } from '@changedown/core/internals';

describe('computeDecidedLine', () => {
  // Helper to build footnote maps quickly
  function fn(entries: [string, 'proposed' | 'accepted' | 'rejected', string][]): Map<string, FootnoteStatus> {
    const map = new Map<string, FootnoteStatus>();
    for (const [id, status] of entries) {
      map.set(id, { status });
    }
    return map;
  }

  const empty = new Map<string, FootnoteStatus>();

  it('passes plain text unchanged', () => {
    const result = computeDecidedLine('Hello world', empty);
    expect(result).toStrictEqual({ text: 'Hello world', flag: '', changeIds: [] });
  });

  it('removes pending insertion, sets flag P', () => {
    const footnotes = fn([['cn-1', 'proposed', 'ins']]);
    const result = computeDecidedLine('Before {++added text++}[^cn-1] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before  after', flag: 'P', changeIds: ['cn-1'] });
  });

  it('keeps accepted insertion text, removes delimiters, sets flag A', () => {
    const footnotes = fn([['cn-1', 'accepted', 'ins']]);
    const result = computeDecidedLine('Before {++added text++}[^cn-1] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before added text after', flag: 'A', changeIds: ['cn-1'] });
  });

  it('keeps text for pending deletion (revert), sets flag P', () => {
    const footnotes = fn([['cn-2', 'proposed', 'del']]);
    const result = computeDecidedLine('Before {--removed--}[^cn-2] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before removed after', flag: 'P', changeIds: ['cn-2'] });
  });

  it('removes text for accepted deletion, sets flag A', () => {
    const footnotes = fn([['cn-2', 'accepted', 'del']]);
    const result = computeDecidedLine('Before {--removed--}[^cn-2] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before  after', flag: 'A', changeIds: ['cn-2'] });
  });

  it('shows old text for pending substitution, sets flag P', () => {
    const footnotes = fn([['cn-3', 'proposed', 'sub']]);
    const result = computeDecidedLine('Before {~~old~>new~~}[^cn-3] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before old after', flag: 'P', changeIds: ['cn-3'] });
  });

  it('shows new text for accepted substitution, sets flag A', () => {
    const footnotes = fn([['cn-3', 'accepted', 'sub']]);
    const result = computeDecidedLine('Before {~~old~>new~~}[^cn-3] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before new after', flag: 'A', changeIds: ['cn-3'] });
  });

  it('shows content for highlight, no flag set', () => {
    const footnotes = fn([['cn-4', 'proposed', 'highlight']]);
    const result = computeDecidedLine('Before {==highlighted==}[^cn-4] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before highlighted after', flag: '', changeIds: [] });
  });

  it('removes comments', () => {
    const result = computeDecidedLine('Text {>>this is a comment<<} more', empty);
    expect(result).toStrictEqual({ text: 'Text  more', flag: '', changeIds: [] });
  });

  it('gives P priority when line has both proposed and accepted changes', () => {
    const footnotes = fn([
      ['cn-1', 'accepted', 'ins'],
      ['cn-2', 'proposed', 'del'],
    ]);
    const result = computeDecidedLine(
      '{++added++}[^cn-1] middle {--deleted--}[^cn-2]',
      footnotes,
    );
    // accepted insertion: keep "added"; proposed deletion: keep "deleted" (revert)
    expect(result.text).toBe('added middle deleted');
    expect(result.flag).toBe('P');
    expect(result.changeIds.includes('cn-1')).toBeTruthy();
    expect(result.changeIds.includes('cn-2')).toBeTruthy();
  });

  it('removes rejected insertion, no flag', () => {
    const footnotes = fn([['cn-5', 'rejected', 'ins']]);
    const result = computeDecidedLine('Before {++nope++}[^cn-5] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before  after', flag: '', changeIds: ['cn-5'] });
  });

  it('treats unknown change ID as proposed (flag P)', () => {
    // cn-99 is NOT in the footnotes map
    const result = computeDecidedLine('Before {++mystery++}[^cn-99] after', empty);
    expect(result).toStrictEqual({ text: 'Before  after', flag: 'P', changeIds: ['cn-99'] });
  });

  it('treats bare CriticMarkup without footnote ref as proposed (flag P)', () => {
    const result = computeDecidedLine('Before {++bare insertion++} after', empty);
    expect(result).toStrictEqual({ text: 'Before  after', flag: 'P', changeIds: [] });
  });

  it('shows old text for rejected substitution (revert)', () => {
    const footnotes = fn([['cn-6', 'rejected', 'sub']]);
    const result = computeDecidedLine('{~~old~>new~~}[^cn-6]', footnotes);
    expect(result).toStrictEqual({ text: 'old', flag: '', changeIds: ['cn-6'] });
  });

  it('keeps text for rejected deletion', () => {
    const footnotes = fn([['cn-7', 'rejected', 'del']]);
    const result = computeDecidedLine('{--kept--}[^cn-7]', footnotes);
    expect(result).toStrictEqual({ text: 'kept', flag: '', changeIds: ['cn-7'] });
  });

  it('removes standalone footnote refs', () => {
    const result = computeDecidedLine('text [^cn-1] more', empty);
    expect(result.text).toBe('text  more');
  });

  it('handles dotted IDs (cn-N.M)', () => {
    const footnotes = fn([['cn-5.1', 'accepted', 'del']]);
    const result = computeDecidedLine('Before {--cut--}[^cn-5.1] after', footnotes);
    expect(result).toStrictEqual({ text: 'Before  after', flag: 'A', changeIds: ['cn-5.1'] });
  });

  it('handles highlight with attached comment', () => {
    const footnotes = fn([['cn-8', 'proposed', 'highlight']]);
    const result = computeDecidedLine('{==important==}{>>note<<}[^cn-8]', footnotes);
    expect(result.text).toBe('important');
    expect(result.flag).toBe('');
  });

  it('handles bare substitution without footnote ref as proposed', () => {
    const result = computeDecidedLine('Before {~~old~>new~~} after', empty);
    expect(result).toStrictEqual({ text: 'Before old after', flag: 'P', changeIds: [] });
  });

  it('handles bare deletion without footnote ref as proposed (keeps text)', () => {
    const result = computeDecidedLine('Before {--removed--} after', empty);
    expect(result).toStrictEqual({ text: 'Before removed after', flag: 'P', changeIds: [] });
  });

  // ── Bounded recursion (Tranche 7) ─────────────────────────────────────────

  it('no-markup document: loop body never runs (depth=0)', () => {
    // Healthy document: no CriticMarkup at all. The while-loop condition is
    // false on entry, result is returned unchanged.
    const result = computeDecidedLine('plain text, no markup', empty);
    expect(result).toStrictEqual({ text: 'plain text, no markup', flag: '', changeIds: [] });
  });

  it('healthy document resolves in single pass (depth=1), behavior unchanged', () => {
    const footnotes = fn([['cn-1', 'accepted', 'sub']]);
    const result = computeDecidedLine('prefix {~~old~>new~~}[^cn-1] suffix', footnotes);
    expect(result.text).toBe('prefix new suffix');
    expect(result.flag).toBe('A');
    expect(result.changeIds).toStrictEqual(['cn-1']);
  });

  it('nested substitution (depth 2) — lazy regex resolves composite span, inner-rejected path', () => {
    // The lazy regex matches from the FIRST {~~ to the FIRST ~>...~~}[^ref]:
    //   match: {~~old1{~~old2~>new2~~}[^cn-3]   old="old1{~~old2"  new="new2"  ref=cn-3
    // cn-3=rejected → returns old="old1{~~old2"
    // Remaining after step 6 cleans [^cn-2]: "prefix old1{~~old2~>new1~~} suffix"
    // Pass 2: {~~old2~>new1~~} (no ref → proposed) → returns "old2"
    // Final: "prefix old1old2 suffix"
    const line = 'prefix {~~old1{~~old2~>new2~~}[^cn-3]~>new1~~}[^cn-2] suffix';
    const footnotes = fn([
      ['cn-2', 'accepted', 'sub'],
      ['cn-3', 'rejected', 'sub'],
    ]);
    const result = computeDecidedLine(line, footnotes);
    expect(result.text).toBe('prefix old1old2 suffix');
    expect(result.text).not.toMatch(/\{~~|\{\+\+|\{--|\{==|\{>>/);
    expect(result.changeIds).toContain('cn-3');
  });

  it('nested substitution (depth 2) — inner-accepted path leaves trailing fragment', () => {
    // The lazy regex matches: {~~old1{~~old2~>new2~~}[^cn-3]  old="old1{~~old2"  new="new2"  ref=cn-3
    // cn-3=accepted → returns "new2"
    // Remaining after match + step 6 (removes [^cn-2]): "prefix new2~>new1~~} suffix"
    // "~>new1~~}" is a trailing fragment without a {~~ open — not valid CriticMarkup.
    // hasCriticMarkup("prefix new2~>new1~~} suffix") = false → loop exits after pass 1.
    // Final: "prefix new2~>new1~~} suffix"  (best-effort: fragment is left as literal text)
    const line = 'prefix {~~old1{~~old2~>new2~~}[^cn-3]~>new1~~}[^cn-2] suffix';
    const footnotes = fn([
      ['cn-2', 'rejected', 'sub'],
      ['cn-3', 'accepted', 'sub'],
    ]);
    const result = computeDecidedLine(line, footnotes);
    // No {~~ opening delimiters remain — no CriticMarkup in the output
    expect(result.text).not.toMatch(/\{~~|\{\+\+|\{--|\{==|\{>>/);
    expect(result.changeIds).toContain('cn-3');
    // The fragment ~>new1~~} is literal residual; its exact form is an implementation detail
    expect(result.text).toContain('new2');
  });

  it('bounded at depth 3 — does not infinite-loop on deeply nested input', () => {
    // Four levels of nesting: the outer three resolve within the depth limit
    // but the innermost may or may not be reached. What matters: no hang, deterministic output.
    const line = '{~~a{~~b{~~c{~~d~>x4~~}[^cn-4]~>x3~~}[^cn-3]~>x2~~}[^cn-2]~>x1~~}[^cn-1]';
    const footnotes = fn([
      ['cn-1', 'accepted', 'sub'],
      ['cn-2', 'accepted', 'sub'],
      ['cn-3', 'accepted', 'sub'],
      ['cn-4', 'accepted', 'sub'],
    ]);
    const result = computeDecidedLine(line, footnotes);
    // Must return a string (no hang, no throw)
    expect(typeof result.text).toBe('string');
    // No outer markup should remain after 3 passes with all-accepted (all levels resolve)
    // With lazy regex: pass 1→ innermost resolved, pass 2→ next, pass 3→ next, pass 4 would be needed
    // for the outermost but we only do 3. Check that it does not contain unresolved deep nesting.
    // At minimum the function terminates — do not assert on residual presence (implementation-defined).
  });
});

describe('computeDecidedView', () => {
  beforeAll(async () => {
    await initHashline();
  });

  it('produces sequential line numbers with no gaps when pending insertion is removed', () => {
    const rawText = [
      '# Title',
      '{++This line is pending++}[^cn-1]',
      'Clean line.',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
    ].join('\n');

    const result = computeDecidedView(rawText);

    // The pending insertion line should be skipped (entire line is pending markup, committed text is empty)
    // Footnote lines should be excluded
    // Remaining: line 1 ("# Title"), line 3 ("Clean line."), line 4 ("")
    const lineNums = result.lines.map(l => l.decidedLineNum);
    expect(lineNums).toStrictEqual([1, 2, 3]);

    // No gaps
    for (let i = 1; i < lineNums.length; i++) {
      expect(lineNums[i]).toBe(lineNums[i - 1] + 1);
    }
  });

  it('builds correct committed-to-raw line mapping', () => {
    const rawText = [
      '# Title',                                      // raw 1 → committed 1
      '{++pending insertion++}[^cn-1]',                // raw 2 → skipped
      'Clean line.',                                   // raw 3 → committed 2
      '',                                              // raw 4 → committed 3
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed', // footnote → excluded
    ].join('\n');

    const result = computeDecidedView(rawText);

    // committed 1 = raw 1, committed 2 = raw 3, committed 3 = raw 4
    expect(result.decidedToRaw.get(1)).toBe(1);
    expect(result.decidedToRaw.get(2)).toBe(3);
    expect(result.decidedToRaw.get(3)).toBe(4);

    // reverse mapping
    expect(result.rawToDecided.get(1)).toBe(1);
    expect(result.rawToDecided.get(3)).toBe(2);
    expect(result.rawToDecided.get(4)).toBe(3);
  });

  it('committed hashes are 2 lowercase hex chars', () => {
    const rawText = '# Title\nSome content\nAnother line';

    const result = computeDecidedView(rawText);

    for (const line of result.lines) {
      expect(line.hash).toMatch(/^[0-9a-f]{2}$/);
    }
  });

  it('computes correct summary counts', () => {
    const rawText = [
      '# Title',
      '{++new text++}[^cn-1]',
      '{--old text--}[^cn-2]',
      'Clean line.',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
      '[^cn-2]: @alice | 2026-02-17 | del | accepted',
    ].join('\n');

    const result = computeDecidedView(rawText);

    expect(result.summary.proposed).toBe(1);
    expect(result.summary.accepted).toBe(1);
    expect(result.summary.rejected).toBe(0);
  });

  it('excludes footnote definition lines from committed output', () => {
    const rawText = [
      '# Title',
      'Some text {++added++}[^cn-1]',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
      '    reason: clarity improvement',
    ].join('\n');

    const result = computeDecidedView(rawText);

    // No line should contain footnote definition content
    for (const line of result.lines) {
      expect(!line.text.match(/^\[\^cn-/)).toBeTruthy();
      expect(!line.text.includes('reason: clarity improvement')).toBeTruthy();
    }
  });

  it('returns identical view for clean file (no CriticMarkup)', () => {
    const rawText = '# Title\nFirst line.\nSecond line.\n';
    const rawLines = rawText.split('\n');

    const result = computeDecidedView(rawText);

    // Same number of lines (including the trailing empty line from split)
    expect(result.lines).toHaveLength(rawLines.length);

    // Same text content
    for (let i = 0; i < result.lines.length; i++) {
      expect(result.lines[i].text).toBe(rawLines[i]);
      expect(result.lines[i].flag).toBe('');
      expect(result.lines[i].changeIds).toStrictEqual([]);
    }

    // Summary: all clean
    expect(result.summary.proposed).toBe(0);
    expect(result.summary.accepted).toBe(0);
    expect(result.summary.rejected).toBe(0);
    expect(result.summary.clean).toBe(rawLines.length);
  });

  it('hashes match computeLineHash for committed text', () => {
    const rawText = '# Title\nSome content here\nThird line';

    const result = computeDecidedView(rawText);

    // Mirror the two-pass approach: collect all committed texts, then hash with allLines
    const allDecidedTexts = result.lines.map(l => l.text);
    for (const line of result.lines) {
      const expectedHash = computeLineHash(line.decidedLineNum - 1, line.text, allDecidedTexts);
      expect(line.hash).toBe(expectedHash);
    }
  });

  it('sets flag P for lines with proposed changes', () => {
    const rawText = [
      'Before {++added++}[^cn-1] after',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
    ].join('\n');

    const result = computeDecidedView(rawText);

    const firstLine = result.lines[0];
    expect(firstLine.flag).toBe('P');
    expect(firstLine.changeIds.includes('cn-1')).toBeTruthy();
  });

  it('sets flag A for lines with accepted changes', () => {
    const rawText = [
      'Before {++added++}[^cn-1] after',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | accepted',
    ].join('\n');

    const result = computeDecidedView(rawText);

    const firstLine = result.lines[0];
    expect(firstLine.flag).toBe('A');
    expect(firstLine.text).toBe('Before added after');
  });

  it('counts clean lines in summary', () => {
    const rawText = [
      '# Title',
      'Clean line one.',
      'Clean line two.',
    ].join('\n');

    const result = computeDecidedView(rawText);

    expect(result.summary.clean).toBe(3);
    expect(result.summary.proposed).toBe(0);
  });

  it('returns parsed changes in result', () => {
    const input = 'Hello {++world++}[^cn-1]\n\n[^cn-1]: @alice | 2026-03-23 | ins | proposed';
    const result = computeDecidedView(input);
    expect(result.changes).toBeDefined();
    expect(result.changes.length).toBe(1);
    expect(result.changes[0].id).toBe('cn-1');
  });

  it('uses preParsed changes when provided', () => {
    const input = 'Hello {++world++}[^cn-1]\n\n[^cn-1]: @alice | 2026-03-23 | ins | proposed';
    const changes = parseForFormat(input).getChanges();
    const withPreParsed = computeDecidedView(input, changes);
    const withoutPreParsed = computeDecidedView(input);
    expect(withPreParsed.lines).toEqual(withoutPreParsed.lines);
    expect(withPreParsed.summary).toEqual(withoutPreParsed.summary);
    expect(withPreParsed.changes).toEqual(changes);
  });
});

describe('formatDecidedOutput', () => {
  beforeAll(async () => {
    await initHashline();
  });

  it('produces correctly formatted output with header and aligned lines', () => {
    const rawText = [
      '# Title',
      'Clean line.',
    ].join('\n');

    const view = computeDecidedView(rawText);
    const output = formatDecidedOutput(view, { filePath: 'test.md', trackingStatus: 'tracked' });

    // Header lines
    const lines = output.split('\n');
    expect(lines[0]).toMatch(/^## file: test\.md$/);
    expect(lines[1]).toMatch(/^## view: committed/);

    // Content lines should have line number, hash, flag, pipe, content
    const contentLines = lines.filter(l => l.match(/^\s*\d+:[0-9a-f]{2}/));
    expect(contentLines).toHaveLength(2);

    // Check format: " N:HH |content"
    for (const cl of contentLines) {
      expect(cl).toMatch(/^\s*\d+:[0-9a-f]{2}\s?\|/);
    }
  });

  it('includes change summary in header', () => {
    const rawText = [
      'Before {++added++}[^cn-1] after',
      'Clean line.',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
    ].join('\n');

    const view = computeDecidedView(rawText);
    const output = formatDecidedOutput(view, { filePath: 'test.md', trackingStatus: 'tracked' });

    // Header should mention change counts
    expect(output.includes('1P')).toBeTruthy();
  });

  it('shows P flag on lines with proposed changes', () => {
    const rawText = [
      'Before {~~old~>new~~}[^cn-1] after',
      '',
      '[^cn-1]: @alice | 2026-02-17 | sub | proposed',
    ].join('\n');

    const view = computeDecidedView(rawText);
    const output = formatDecidedOutput(view, { filePath: 'test.md', trackingStatus: 'tracked' });

    const lines = output.split('\n');
    const firstContentLine = lines.find(l => l.includes('Before old after'));
    expect(firstContentLine).toBeTruthy();
    expect(firstContentLine!.includes('P')).toBeTruthy();
  });

  it('shows A flag on lines with accepted changes', () => {
    const rawText = [
      'Before {++added++}[^cn-1] after',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | accepted',
    ].join('\n');

    const view = computeDecidedView(rawText);
    const output = formatDecidedOutput(view, { filePath: 'test.md', trackingStatus: 'tracked' });

    const lines = output.split('\n');
    const firstContentLine = lines.find(l => l.includes('Before added after'));
    expect(firstContentLine).toBeTruthy();
    expect(firstContentLine!.includes('A')).toBeTruthy();
  });
});
