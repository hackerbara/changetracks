import { describe, it, expect, beforeAll } from 'vitest';
import {
  computeCurrentText,
  computeOriginalText,
  applyAcceptedChanges,
  applyRejectedChanges,
  computeCurrentReplace,
  initHashline,
  ChangeType,
  ChangeStatus,
  ChangeNode,
} from '@changedown/core/internals';
import { parseForFormat, isL3Format } from '@changedown/core';

beforeAll(async () => { await initHashline(); });

describe('applyAcceptedChanges', () => {
  it('settles single accepted insertion to clean text and returns its id', () => {
    const input = 'Hello {++beautiful ++}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | insertion | accepted';
    const { currentContent, appliedIds } = applyAcceptedChanges(input);
    // Layer 1 settlement: markup removed but footnote ref and definition preserved
    expect(currentContent).toContain('Hello beautiful [^cn-1]world');
    expect(currentContent).toContain('[^cn-1]: @alice | 2026-02-11 | insertion | accepted');
    expect(appliedIds).toEqual(['cn-1']);
  });

  it('settles two accepted substitutions on the same line without duplication', () => {
    const input = [
      '{~~256 bits for~>256-bit~~}[^cn-1] {~~ECDSA keys~>ECDSA~~}[^cn-2]',
      '',
      '[^cn-1]: @ai:test | 2026-02-27 | sub | accepted',
      '[^cn-2]: @ai:test | 2026-02-27 | sub | accepted',
    ].join('\n');
    const { currentContent, appliedIds } = applyAcceptedChanges(input);
    expect(appliedIds.includes('cn-1')).toBeTruthy();
    expect(appliedIds.includes('cn-2')).toBeTruthy();
    // No duplication — each substitution's new text appears exactly once in body
    expect(currentContent.includes('256-bit[^cn-1] ECDSA[^cn-2]')).toBeTruthy();
    // Original text should NOT appear in the body (it may appear in edit-op lines)
    const bodyLines = currentContent.split('\n\n')[0];
    expect(!bodyLines.includes('256 bits for')).toBeTruthy();
    expect(!bodyLines.includes('ECDSA keys')).toBeTruthy();
  });

  it('settles three accepted changes on the same line in correct order', () => {
    const input = [
      'A {++B++}[^cn-1] C {--D--}[^cn-2] E {~~F~>G~~}[^cn-3] H',
      '',
      '[^cn-1]: @a | 2026-02-27 | ins | accepted',
      '[^cn-2]: @a | 2026-02-27 | del | accepted',
      '[^cn-3]: @a | 2026-02-27 | sub | accepted',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);
    // Insertion kept, deletion removed, substitution uses new text
    expect(currentContent.includes('A B[^cn-1] C [^cn-2] E G[^cn-3] H')).toBeTruthy();
  });
});

describe('applyRejectedChanges', () => {
  it('settles two rejected substitutions on the same line without duplication', () => {
    const input = [
      '{~~old1~>new1~~}[^cn-1] {~~old2~>new2~~}[^cn-2]',
      '',
      '[^cn-1]: @ai:test | 2026-02-27 | sub | rejected',
      '[^cn-2]: @ai:test | 2026-02-27 | sub | rejected',
    ].join('\n');
    const { currentContent, appliedIds } = applyRejectedChanges(input);
    expect(appliedIds.includes('cn-1')).toBeTruthy();
    expect(appliedIds.includes('cn-2')).toBeTruthy();
    // Reject restores original text
    expect(currentContent.includes('old1[^cn-1] old2[^cn-2]')).toBeTruthy();
    // New text should NOT appear
    expect(!currentContent.includes('new1')).toBeTruthy();
    expect(!currentContent.includes('new2')).toBeTruthy();
  });
});

describe('computeCurrentText', () => {
  it('returns unchanged text when no CriticMarkup present', () => {
    expect(computeCurrentText('Hello world')).toBe('Hello world');
  });

  it('absorbs accepted insertions', () => {
    const input = 'Hello {++beautiful ++}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | insertion | accepted';
    expect(computeCurrentText(input)).toBe('Hello beautiful world');
  });

  it('absorbs accepted deletions', () => {
    const input = 'Hello {--ugly --}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | deletion | accepted';
    expect(computeCurrentText(input)).toBe('Hello world');
  });

  it('absorbs accepted substitutions', () => {
    const input = 'Hello {~~old~>new~~}[^cn-1] world\n\n[^cn-1]: @alice | 2026-02-11 | sub | accepted';
    expect(computeCurrentText(input)).toBe('Hello new world');
  });

  // Accept-all: rejected changes are still applied (settled = all proposals approved)
  it('applies rejected insertions (accept-all)', () => {
    const input = 'Hello {++bad ++}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | insertion | rejected';
    expect(computeCurrentText(input)).toBe('Hello bad world');
  });

  it('applies rejected deletions (accept-all)', () => {
    const input = 'Hello {--good --}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | deletion | rejected';
    expect(computeCurrentText(input)).toBe('Hello world');
  });

  it('applies rejected substitutions to new text (accept-all)', () => {
    const input = 'Hello {~~old~>new~~}[^cn-1] world\n\n[^cn-1]: @alice | 2026-02-11 | sub | rejected';
    expect(computeCurrentText(input)).toBe('Hello new world');
  });

  // Accept-all: proposed changes are applied (not reverted)
  it('applies proposed insertions (accept-all)', () => {
    const input = 'Hello {++maybe ++}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | insertion | proposed';
    expect(computeCurrentText(input)).toBe('Hello maybe world');
  });

  it('applies proposed deletions (accept-all)', () => {
    const input = 'Hello {--keep me--}[^cn-1] world\n\n[^cn-1]: @alice | 2026-02-11 | deletion | proposed';
    expect(computeCurrentText(input)).toBe('Hello  world');
  });

  it('applies proposed substitutions to new text (accept-all)', () => {
    const input = 'Hello {~~old~>new~~}[^cn-1] world\n\n[^cn-1]: @alice | 2026-02-11 | sub | proposed';
    expect(computeCurrentText(input)).toBe('Hello new world');
  });

  it('applies Level 0 changes (no footnote) via accept-all', () => {
    expect(computeCurrentText('Hello {++new ++}world')).toBe('Hello new world');
    expect(computeCurrentText('Hello {--keep--} world')).toBe('Hello  world');
  });

  it('strips highlights to plain text', () => {
    expect(computeCurrentText('Hello {==important==} world')).toBe('Hello important world');
  });

  it('strips comments entirely', () => {
    expect(computeCurrentText('Hello {>>note<<} world')).toBe('Hello  world');
  });

  it('strips footnote definitions', () => {
    const input = 'Hello world\n\n[^cn-1]: @alice | 2026-02-11 | insertion | accepted\n    reason: testing';
    expect(computeCurrentText(input)).toBe('Hello world');
  });

  it('handles multiple changes with mixed statuses (accept-all)', () => {
    const input = [
      'Start {++accepted ++}[^cn-1]{++proposed ++}[^cn-2]{--rejected --}[^cn-3]end',
      '',
      '[^cn-1]: @a | 2026-02-11 | ins | accepted',
      '[^cn-2]: @a | 2026-02-11 | ins | proposed',
      '[^cn-3]: @a | 2026-02-11 | del | rejected',
    ].join('\n');
    // Accept-all: both insertions kept, deletion applied (text removed)
    expect(computeCurrentText(input)).toBe('Start accepted proposed end');
  });

  it('handles move groups (dotted IDs) with accept-all', () => {
    const input = [
      '{--moved text--}[^cn-1.1] ... {++moved text++}[^cn-1.2]',
      '',
      '[^cn-1]: @a | 2026-02-11 | move | proposed',
      '[^cn-1.1]: @a | 2026-02-11 | del | proposed',
      '[^cn-1.2]: @a | 2026-02-11 | ins | proposed',
    ].join('\n');
    // Accept-all: deletion removes text, insertion keeps text
    expect(computeCurrentText(input)).toBe(' ... moved text');
  });

  it('strips orphaned inline footnote refs', () => {
    // A [^cn-N] ref that appears outside of any markup (e.g., left behind after manual editing)
    const input = 'Some text[^cn-42] and more text';
    expect(computeCurrentText(input)).toBe('Some text and more text');
  });

  it('handles highlight with attached comment', () => {
    const input = 'Check {==this text==}{>>important<<} carefully';
    expect(computeCurrentText(input)).toBe('Check this text carefully');
  });

  it('handles empty document', () => {
    expect(computeCurrentText('')).toBe('');
  });

  it('preserves whitespace-only text without markup', () => {
    expect(computeCurrentText('  \n  \n  ')).toBe('  \n  \n  ');
  });

  // ─── Accept-all semantics ──────────────────────────────────────────────
  // Settled view = "document as it would be if all proposals were approved"

  it('accept-all: proposed insertion is kept in settled text', () => {
    const input = [
      'Line one.',
      '{++Proposed new line.++}[^cn-1]',
      'Line three.',
      '',
      '[^cn-1]: @alice | 2026-02-24 | ins | proposed',
      '    @alice 2026-02-24: adding context',
    ].join('\n');

    const result = computeCurrentText(input);
    expect(result.includes('Proposed new line.')).toBeTruthy();
    expect(!result.includes('{++')).toBeTruthy();
  });

  it('accept-all: proposed substitution keeps new text', () => {
    const input = [
      '{~~old text~>new text~~}[^cn-2]',
      '',
      '[^cn-2]: @alice | 2026-02-24 | sub | proposed',
      '    @alice 2026-02-24: better wording',
    ].join('\n');

    const result = computeCurrentText(input);
    expect(result.includes('new text')).toBeTruthy();
    expect(!result.includes('old text')).toBeTruthy();
  });

  it('accept-all: proposed deletion removes text', () => {
    const input = [
      'Before {--remove me--}[^cn-3] after.',
      '',
      '[^cn-3]: @alice | 2026-02-24 | del | proposed',
      '    @alice 2026-02-24: redundant',
    ].join('\n');

    const result = computeCurrentText(input);
    expect(result.includes('Before  after.')).toBeTruthy();
    expect(!result.includes('remove me')).toBeTruthy();
  });

  it('accept-all: Level 0 insertion (no footnote) is kept', () => {
    const result = computeCurrentText('Hello {++new ++}world');
    expect(result).toBe('Hello new world');
  });

  it('accept-all: Level 0 deletion (no footnote) removes text', () => {
    const result = computeCurrentText('Hello {--old--} world');
    expect(result).toBe('Hello  world');
  });
});

describe('code-zone-aware ref placement', () => {
  it('places ref at end of line when substitution is inside fenced code block', () => {
    const input = [
      '# Doc',
      '```js',
      'const x = {~~old~>new~~}[^cn-1];',
      '```',
      '',
      '[^cn-1]: @alice | 2026-01-01 | sub | accepted',
      '    reason: update variable',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);
    // Ref should NOT be inside the code fence
    expect(!currentContent.includes('const x = new[^cn-1];')).toBeTruthy();
    // Ref should be at end of line, outside code content
    expect(currentContent.includes('const x = new;[^cn-1]')).toBeTruthy();
  });

  it('places ref at end of line when substitution is inside inline backtick span', () => {
    const input = [
      'Use `{~~oldFunc~>newFunc~~}[^cn-1]()` to call it.',
      '',
      '[^cn-1]: @alice | 2026-01-01 | sub | accepted',
      '    reason: rename function',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);
    // Ref must not be inside backticks
    expect(!currentContent.includes('`newFunc[^cn-1]()`')).toBeTruthy();
    // Ref at end of line
    expect(currentContent.includes('`newFunc()` to call it.[^cn-1]')).toBeTruthy();
  });

  it('places ref normally when substitution is outside code zones', () => {
    const input = [
      'The API uses {~~REST~>GraphQL~~}[^cn-1] queries.',
      '',
      '[^cn-1]: @alice | 2026-01-01 | sub | accepted',
      '    reason: paradigm shift',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);
    // Normal inline placement (no code zone)
    expect(currentContent.includes('GraphQL[^cn-1] queries.')).toBeTruthy();
  });

  it('handles deletion inside code block with ref at end of line', () => {
    const input = [
      '```python',
      'x = {--removed_call()--}[^cn-1]',
      '```',
      '',
      '[^cn-1]: @alice | 2026-01-01 | del | accepted',
      '    reason: dead code',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);
    expect(currentContent.includes('x = [^cn-1]')).toBeTruthy();
  });

  it('handles rejected substitution inside code block', () => {
    const input = [
      '```',
      'let val = {~~foo~>bar~~}[^cn-1];',
      '```',
      '',
      '[^cn-1]: @alice | 2026-01-01 | sub | rejected',
      '    reason: keep original name',
    ].join('\n');
    const { currentContent } = applyRejectedChanges(input);
    // Rejected = restore original; ref at end of line (inside code block)
    expect(currentContent.includes('let val = foo;[^cn-1]')).toBeTruthy();
  });

  it('does not corrupt content when literal CriticMarkup examples appear in backticks', () => {
    // Backtick-escaped delimiter examples should not be parsed as real changes
    const input = [
      'Use `{~~old~>new~~}` syntax for substitutions.',
      'And `{++inserted++}` for insertions.',
      '',
      'Real change: {~~REST~>GraphQL~~}[^cn-1] queries.',
      '',
      '[^cn-1]: @alice | 2026-01-01 | sub | accepted',
      '    reason: paradigm shift',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);
    // Literal examples in backticks must be preserved untouched
    expect(currentContent.includes('`{~~old~>new~~}`')).toBeTruthy();
    expect(currentContent.includes('`{++inserted++}`')).toBeTruthy();
    // Real change should be settled normally (outside code zone)
    expect(currentContent.includes('GraphQL[^cn-1] queries.')).toBeTruthy();
  });

  it('handles multiple changes, some inside code zones and some outside', () => {
    const input = [
      'Intro {++added text++}[^cn-1] here.',
      '```',
      'code {~~old~>new~~}[^cn-2]',
      '```',
      'Outro {--removed--}[^cn-3] end.',
      '',
      '[^cn-1]: @alice | 2026-01-01 | ins | accepted',
      '    reason: intro addition',
      '[^cn-2]: @alice | 2026-01-01 | sub | accepted',
      '    reason: code update',
      '[^cn-3]: @alice | 2026-01-01 | del | accepted',
      '    reason: cleanup',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);
    // cn-1: outside code, ref inline
    expect(currentContent.includes('added text[^cn-1] here.')).toBeTruthy();
    // cn-2: inside code fence, ref at end of line
    expect(currentContent.includes('code new[^cn-2]')).toBeTruthy();
    // cn-3: outside code, ref inline (deletion = content removed)
    expect(currentContent.includes('[^cn-3] end.')).toBeTruthy();
  });
});

describe('sequential settlement stability', () => {
  it('handles two sequential accepts on the same line without duplication', () => {
    // Cycle 1: accept a substitution
    const input1 = [
      'text with {~~old~>new~~}[^cn-1]',
      '',
      '[^cn-1]: @alice | 2026-01-01 | sub | accepted',
      '    reason: first change',
    ].join('\n');
    const { currentContent: after1 } = applyAcceptedChanges(input1);
    expect(after1.includes('text with new[^cn-1]')).toBeTruthy();
    // Original text should NOT appear in the body (edit-op lines in footnotes may contain it)
    const body1 = after1.split('\n\n')[0];
    expect(!body1.includes('old')).toBeTruthy();

    // Cycle 2: new substitution on the same line (now contains [^cn-1])
    const input2 = after1.replace(
      'text with new[^cn-1]',
      'text with {~~new~>newer~~}[^cn-2][^cn-1]',
    ) + '\n[^cn-2]: @bob | 2026-01-02 | sub | accepted\n    reason: second change';
    const { currentContent: after2 } = applyAcceptedChanges(input2);
    expect(after2.includes('text with newer[^cn-2][^cn-1]')).toBeTruthy();
    // No duplication in the body (edit-op lines in footnotes may also contain it)
    const body2 = after2.split('\n\n')[0];
    expect(body2.match(/newer/g)?.length).toBe(1);
  });

  it('handles accept + reject on same line', () => {
    const input = [
      '{~~A~>B~~}[^cn-1] and {++C++}[^cn-2]',
      '',
      '[^cn-1]: @alice | 2026-01-01 | sub | accepted',
      '    reason: keep B',
      '[^cn-2]: @bob | 2026-01-02 | ins | rejected',
      '    reason: no thanks',
    ].join('\n');
    // Settle accepted first
    const { currentContent: afterAccept } = applyAcceptedChanges(input);
    expect(afterAccept.includes('B[^cn-1]')).toBeTruthy();
    // Then settle rejected
    const { currentContent: afterReject } = applyRejectedChanges(afterAccept);
    expect(afterReject.includes('B[^cn-1] and [^cn-2]')).toBeTruthy();
  });

  it('handles three-cycle stress test on same line', () => {
    // Cycle 1
    const input1 = [
      'value = {~~alpha~>beta~~}[^cn-1]',
      '',
      '[^cn-1]: @a | 2026-01-01 | sub | accepted',
      '    r: c1',
    ].join('\n');
    const { currentContent: r1 } = applyAcceptedChanges(input1);
    expect(r1.includes('value = beta[^cn-1]')).toBeTruthy();

    // Cycle 2
    const input2 = r1.replace('beta[^cn-1]', '{~~beta~>gamma~~}[^cn-2][^cn-1]')
      + '\n[^cn-2]: @b | 2026-01-02 | sub | accepted\n    r: c2';
    const { currentContent: r2 } = applyAcceptedChanges(input2);
    expect(r2.includes('gamma[^cn-2][^cn-1]')).toBeTruthy();

    // Cycle 3
    const input3 = r2.replace('gamma[^cn-2][^cn-1]', '{~~gamma~>delta~~}[^cn-3][^cn-2][^cn-1]')
      + '\n[^cn-3]: @c | 2026-01-03 | sub | accepted\n    r: c3';
    const { currentContent: r3 } = applyAcceptedChanges(input3);
    expect(r3.includes('delta[^cn-3][^cn-2][^cn-1]')).toBeTruthy();
    // Exactly one occurrence in the body (edit-op lines in footnotes may also contain it)
    const body3 = r3.split('\n\n')[0];
    expect(body3.match(/delta/g)?.length).toBe(1);
  });
});

describe('computeOriginalText', () => {
  it('removes insertions entirely', () => {
    const input = 'Hello {++beautiful ++}world';
    expect(computeOriginalText(input)).toBe('Hello world');
  });

  it('keeps deletion content without delimiters', () => {
    const input = 'Hello {--cruel --}world';
    expect(computeOriginalText(input)).toBe('Hello cruel world');
  });

  it('shows original side of substitutions', () => {
    const input = 'Hello {~~cruel~>beautiful~~} world';
    expect(computeOriginalText(input)).toBe('Hello cruel world');
  });

  it('strips footnote refs and definitions', () => {
    const input = 'Hello {++world++}[^cn-1]\n\n[^cn-1]: @author | 2026-03-14 | ins | proposed';
    expect(computeOriginalText(input)).toBe('Hello ');
  });

  it('handles multiple changes', () => {
    const input = 'A {++B ++}C {--D --}E';
    expect(computeOriginalText(input)).toBe('A C D E');
  });

  it('handles highlights by keeping content', () => {
    const input = 'Some {==highlighted==} text';
    expect(computeOriginalText(input)).toBe('Some highlighted text');
  });

  it('handles comments by removing them', () => {
    const input = 'Some text{>>a comment<<}';
    expect(computeOriginalText(input)).toBe('Some text');
  });

  it('handles document with no changes', () => {
    const input = 'Plain text with no markup';
    expect(computeOriginalText(input)).toBe('Plain text with no markup');
  });
});

describe('computeCurrentReplace', () => {
  it('throws on unknown ChangeType', () => {
    const fakeNode: ChangeNode = {
      id: 'cn-999',
      type: 999 as unknown as ChangeType,
      status: ChangeStatus.Proposed,
      range: { start: 0, end: 10 },
      contentRange: { start: 3, end: 7 },
      level: 0,
      anchored: false,
    };

    expect(
      () => computeCurrentReplace(fakeNode),
    ).toThrow(/Unknown ChangeType/);
  });
});

describe('applyAcceptedChanges — edit-op generation', () => {
  it('T1.1: accepted insertion + substitution produce edit-op lines', () => {
    const input = [
      'Hello {++beautiful ++}[^cn-1]world. The {~~quick~>fast~~}[^cn-2] fox.',
      '',
      '[^cn-1]: @alice | 2026-02-11 | ins | accepted',
      '    reason: add adj',
      '[^cn-2]: @bob | 2026-02-11 | sub | accepted',
      '    reason: synonym',
    ].join('\n');
    const { currentContent, appliedIds } = applyAcceptedChanges(input);

    expect(appliedIds).toEqual(['cn-1', 'cn-2']);

    // Body: markup removed, refs preserved
    const body = currentContent.split('\n\n')[0];
    expect(body).toBe('Hello beautiful [^cn-1]world. The fast[^cn-2] fox.');

    // cn-1 footnote block has an edit-op line with LINE:HASH and insertion op
    expect(currentContent).toMatch(/\[.cn-1\]:.*\n\s+1:[0-9a-f]{2} \{\+\+beautiful \+\+\}/);

    // cn-2 footnote block has an edit-op line with LINE:HASH and substitution op
    expect(currentContent).toMatch(/\[.cn-2\]:.*\n\s+1:[0-9a-f]{2} \{~~quick~>fast~~\}/);
  });

  it('T1.2: hybrid file — accepted get edit-ops, proposed left untouched', () => {
    const input = [
      'Start {++added ++}[^cn-4]middle {~~old~>new~~}[^cn-5] end.',
      '',
      '[^cn-4]: @alice | 2026-02-11 | ins | accepted',
      '    reason: add word',
      '[^cn-5]: @bob | 2026-02-11 | sub | proposed',
      '    reason: pending review',
    ].join('\n');
    const { currentContent, appliedIds } = applyAcceptedChanges(input);

    // Only accepted change is settled
    expect(appliedIds).toEqual(['cn-4']);

    // Body: cn-4 markup resolved, cn-5 markup preserved
    const body = currentContent.split('\n\n')[0];
    expect(body).toContain('added [^cn-4]middle');
    expect(body).toContain('{~~old~>new~~}[^cn-5]');

    // cn-4 footnote has an edit-op line
    expect(currentContent).toMatch(/\[.cn-4\]:.*\n\s+1:[0-9a-f]{2} \{\+\+added \+\+\}/);

    // cn-5 footnote does NOT have an edit-op line (still proposed)
    const cn5Block = currentContent.split('[^cn-5]:')[1];
    expect(cn5Block).not.toMatch(/^\s+\d+:[0-9a-f]{2}\s/m);
  });

  it('T1.3: settled output with edit-ops parses as L3 via parseForFormat', () => {
    const input = [
      'Hello {++beautiful ++}[^cn-1]world.',
      '',
      '[^cn-1]: @alice | 2026-02-11 | ins | accepted',
      '    reason: add adj',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);

    // After settlement with edit-ops, the output is recognized as L3
    expect(isL3Format(currentContent)).toBe(true);

    // Parsing the L3 output recovers the change
    const doc = parseForFormat(currentContent);
    const changes = doc.getChanges();
    expect(changes.length).toBe(1);
    expect(changes[0].id).toBe('cn-1');
    expect(changes[0].type).toBe(ChangeType.Insertion);
    expect(changes[0].status).toBe(ChangeStatus.Accepted);
  });

  it('T1.4: accepted deletion produces deletion edit-op', () => {
    const input = [
      'Hello {--ugly --}[^cn-3]world.',
      '',
      '[^cn-3]: @carol | 2026-02-11 | del | accepted',
      '    reason: remove adj',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(input);

    // Body: deleted text removed, ref preserved
    const body = currentContent.split('\n\n')[0];
    expect(body).toBe('Hello [^cn-3]world.');

    // cn-3 footnote has a deletion edit-op line
    expect(currentContent).toMatch(/\[.cn-3\]:.*\n\s+1:[0-9a-f]{2} \{--ugly --\}/);
  });
});

describe('applyAcceptedChanges — fence closer safety', () => {
  it('does not place ref on code fence closer line', () => {
    // The accepted insertion sits right before a code fence closer.
    // After settlement, the ref [^cn-1] must NOT end up on the ``` line.
    const input = [
      '```',
      'code {++extra++}[^cn-1]',
      '```',
      '',
      'After the fence.',
      '',
      '[^cn-1]: @test | 2026-01-01 | insertion | accepted',
    ].join('\n');

    const { currentContent } = applyAcceptedChanges(input);
    const lines = currentContent.split('\n');

    // The ``` line should be clean — no refs on fence closer lines
    const fenceLines = lines.filter(l => l.trim().startsWith('```') || l.trim().startsWith('~~~'));
    for (const fl of fenceLines) {
      expect(fl).not.toContain('[^cn-');
    }
  });

  it('defers ref when deletion of fence closer is accepted (propose-change round-trip)', () => {
    // Simulates what propose_change produces when deleting a fence closer:
    // The CriticMarkup wraps the ``` itself, so while proposed, the ref is safe
    // (line contains {--```--}[^cn-1] which can't match as a fence closer).
    // After settlement, the deletion removes the ```, and the ref must not
    // land on whatever becomes the fence closer line.
    const input = [
      'Some text before.',
      '```',
      'code block',
      '{--```--}[^cn-1]',
      'After the fence.',
      '',
      '[^cn-1]: @test | 2026-01-01 | deletion | accepted',
    ].join('\n');

    const { currentContent, appliedIds } = applyAcceptedChanges(input);
    expect(appliedIds).toContain('cn-1');

    const lines = currentContent.split('\n');

    // The deletion was accepted, so the ``` is removed. The fence closer line
    // (the remaining ```) should not have a ref on it.
    const fenceLines = lines.filter(l => l.trim().startsWith('```') || l.trim().startsWith('~~~'));
    for (const fl of fenceLines) {
      expect(fl).not.toContain('[^cn-');
    }
  });

  it('defers ref when substitution replaces text adjacent to fence closer', () => {
    // Substitution where old text is on the line just before a fence closer.
    // After settlement, the ref should not migrate onto the ``` line.
    const input = [
      '```python',
      '{~~old code~>new code~~}[^cn-1]',
      '```',
      '',
      'Paragraph after.',
      '',
      '[^cn-1]: @test | 2026-01-01 | substitution | accepted',
    ].join('\n');

    const { currentContent, appliedIds } = applyAcceptedChanges(input);
    expect(appliedIds).toContain('cn-1');

    const lines = currentContent.split('\n');

    // Verify the closing ``` is clean
    const closerLine = lines.find(l => l.trim() === '```');
    expect(closerLine).toBeDefined();
    expect(closerLine).not.toContain('[^cn-');

    // The ref should be on the substituted content line, not the fence closer
    const refLine = lines.find(l => l.includes('[^cn-1]'));
    expect(refLine).toBeDefined();
    expect(refLine).toContain('new code');
  });

  it('defers ref when insertion lands right before fence closer line', () => {
    // An insertion whose text ends right at the boundary before a fence closer.
    // The CriticMarkup protects the ref during the proposed state, but after
    // settlement the ref must not end up on the ``` line.
    const input = [
      '```',
      'existing code',
      '{++added line\n++}[^cn-1]```',
      '',
      'After fence.',
      '',
      '[^cn-1]: @test | 2026-01-01 | insertion | accepted',
    ].join('\n');

    const { currentContent } = applyAcceptedChanges(input);
    const lines = currentContent.split('\n');

    // No fence line should contain a ref
    const fenceLines = lines.filter(l => l.trim().startsWith('```') || l.trim().startsWith('~~~'));
    for (const fl of fenceLines) {
      expect(fl).not.toContain('[^cn-');
    }
  });
});

describe('computeOriginalText — L3 path', () => {
  it('reverts ALL changes regardless of status, not just Proposed', () => {
    // Build a valid L3 fixture by accepting an insertion via applyAcceptedChanges.
    // The L2 input has "hello {++world++}[^cn-1]" — after acceptance, the body
    // becomes "hello world[^cn-1]" with a LINE:HASH edit-op in the footnote.
    const l2Input = [
      'hello {++world++}[^cn-1]',
      '',
      '[^cn-1]: @alice | 2026-04-01 | ins | accepted',
      '    reason: add word',
    ].join('\n');
    const { currentContent: l3 } = applyAcceptedChanges(l2Input);

    // Confirm it is genuinely L3 format before testing
    expect(isL3Format(l3)).toBe(true);

    const result = computeOriginalText(l3);
    // "world" was an accepted insertion — original text had it absent
    expect(result).toBe('hello \n');
  });

  it('reverts accepted deletions (restores deleted text)', () => {
    // Build a valid L3 fixture by accepting a deletion via applyAcceptedChanges.
    // The L2 input has "hello {--removed --}[^cn-1]world" — after acceptance,
    // the body becomes "hello [^cn-1]world" (deleted text is gone).
    const l2Input = [
      'hello {--removed --}[^cn-1]world',
      '',
      '[^cn-1]: @alice | 2026-04-01 | del | accepted',
      '    reason: remove word',
    ].join('\n');
    const { currentContent: l3 } = applyAcceptedChanges(l2Input);

    expect(isL3Format(l3)).toBe(true);

    const result = computeOriginalText(l3);
    // "removed " was an accepted deletion — original text had it present
    expect(result).toBe('hello removed world\n');
  });
});
