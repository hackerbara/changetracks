/**
 * Tests for findMarkupRangeById / removeMarkupById.
 *
 * Per spec §3.3 / Tranche 8 Task 8.1.
 */
import { describe, test, expect } from 'vitest';
import {
  findMarkupRangeById,
  removeMarkupById,
} from '@changedown/core';

// ── Helpers ─────────────────────────────────────────────────────────────────

function span(text: string, changeId: string) {
  const r = findMarkupRangeById(text, changeId);
  if (!r) return null;
  return { extracted: text.slice(r.start, r.end), type: r.type };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('findMarkupRangeById', () => {

  // ── Simple cases ────────────────────────────────────────────────────────────

  test('simple substitution — finds correct span', () => {
    const text = '{~~old~>new~~}[^cn-1]';
    const r = findMarkupRangeById(text, 'cn-1');
    expect(r).not.toBeNull();
    expect(r!.start).toBe(0);
    expect(r!.end).toBe(text.length);
    expect(r!.type).toBe('sub');
  });

  test('simple insertion — finds correct span', () => {
    const text = 'prefix {++added++}[^cn-2] suffix';
    const r = findMarkupRangeById(text, 'cn-2');
    expect(r).not.toBeNull();
    expect(text.slice(r!.start, r!.end)).toBe('{++added++}[^cn-2]');
    expect(r!.type).toBe('ins');
  });

  test('simple deletion — finds correct span', () => {
    const text = '{--removed--}[^cn-3]';
    const r = findMarkupRangeById(text, 'cn-3');
    expect(r).not.toBeNull();
    expect(r!.type).toBe('del');
    expect(text.slice(r!.start, r!.end)).toBe('{--removed--}[^cn-3]');
  });

  test('highlight kind', () => {
    const text = '{==highlighted==}[^cn-4]';
    const r = findMarkupRangeById(text, 'cn-4');
    expect(r).not.toBeNull();
    expect(r!.type).toBe('highlight');
  });

  test('comment kind', () => {
    const text = '{>>a comment<<}[^cn-5]';
    const r = findMarkupRangeById(text, 'cn-5');
    expect(r).not.toBeNull();
    expect(r!.type).toBe('comment');
  });

  // ── Preceding text ─────────────────────────────────────────────────────────

  test('span is preceded by other text — start offset is correct', () => {
    const text = 'Some prose. {~~old~>new~~}[^cn-1] trailing.';
    const r = findMarkupRangeById(text, 'cn-1');
    expect(r).not.toBeNull();
    expect(text.slice(r!.start, r!.end)).toBe('{~~old~>new~~}[^cn-1]');
  });

  // ── Single-type 3-layer nesting ─────────────────────────────────────────────

  test('three-layer same-kind nesting — finds outermost cn-1', () => {
    // cn-3 innermost, cn-2 middle, cn-1 outer (all same kind: sub)
    const text =
      '{~~outer{~~middle{~~inner~>x~~}[^cn-3]~>y~~}[^cn-2]~>z~~}[^cn-1]';
    const r = findMarkupRangeById(text, 'cn-1');
    expect(r).not.toBeNull();
    expect(text.slice(r!.start, r!.end)).toBe(text);
    expect(r!.type).toBe('sub');
  });

  test('three-layer same-kind nesting — finds middle cn-2', () => {
    const text =
      '{~~outer{~~middle{~~inner~>x~~}[^cn-3]~>y~~}[^cn-2]~>z~~}[^cn-1]';
    const r = findMarkupRangeById(text, 'cn-2');
    expect(r).not.toBeNull();
    const extracted = text.slice(r!.start, r!.end);
    expect(extracted).toBe(
      '{~~middle{~~inner~>x~~}[^cn-3]~>y~~}[^cn-2]',
    );
  });

  test('three-layer same-kind nesting — finds innermost cn-3', () => {
    const text =
      '{~~outer{~~middle{~~inner~>x~~}[^cn-3]~>y~~}[^cn-2]~>z~~}[^cn-1]';
    const r = findMarkupRangeById(text, 'cn-3');
    expect(r).not.toBeNull();
    const extracted = text.slice(r!.start, r!.end);
    expect(extracted).toBe('{~~inner~>x~~}[^cn-3]');
  });

  // ── Multi-type nesting (spec load-bearing test) ────────────────────────────
  //
  // Forward scan is required for this case. A backward scan would match the
  // first `~~}` going left from [^cn-1], which is the close of cn-2 (an 'ins'
  // span). The forward scan correctly pairs the outer `{~~` with its own `~~}`.

  test('multi-type nested: sub containing ins containing sub — outer cn-1 correct', () => {
    // Structure: {~~outer{++middle{~~inner~>x~~}[^cn-3]++}[^cn-2]~>y~~}[^cn-1]
    const text =
      '{~~outer{++middle{~~inner~>x~~}[^cn-3]++}[^cn-2]~>y~~}[^cn-1]';
    const r = findMarkupRangeById(text, 'cn-1');
    expect(r).not.toBeNull();
    expect(text.slice(r!.start, r!.end)).toBe(text);
    expect(r!.type).toBe('sub');
  });

  test('multi-type nested — cn-2 (ins, middle)', () => {
    const text =
      '{~~outer{++middle{~~inner~>x~~}[^cn-3]++}[^cn-2]~>y~~}[^cn-1]';
    const r = findMarkupRangeById(text, 'cn-2');
    expect(r).not.toBeNull();
    const extracted = text.slice(r!.start, r!.end);
    expect(extracted).toBe('{++middle{~~inner~>x~~}[^cn-3]++}[^cn-2]');
    expect(r!.type).toBe('ins');
  });

  test('multi-type nested — cn-3 (sub, innermost)', () => {
    const text =
      '{~~outer{++middle{~~inner~>x~~}[^cn-3]++}[^cn-2]~>y~~}[^cn-1]';
    const r = findMarkupRangeById(text, 'cn-3');
    expect(r).not.toBeNull();
    const extracted = text.slice(r!.start, r!.end);
    expect(extracted).toBe('{~~inner~>x~~}[^cn-3]');
    expect(r!.type).toBe('sub');
  });

  // ── Actual bug-report structure (Step 5 from the report) ──────────────────

  test('three-layer zombie from bug report — cn-4 span is outermost (sub)', () => {
    // Simplified schematic matching Step 5 structure:
    // {~~{~~OLD{~~inner~>x~~}[^cn-3]~>MIDDLE~~}[^cn-2.1]~>CLEAN~~}[^cn-4]
    const text =
      '{~~{~~OLD{~~inner~>x~~}[^cn-3]~>MIDDLE~~}[^cn-2.1]~>CLEAN~~}[^cn-4]';
    const r4 = findMarkupRangeById(text, 'cn-4');
    expect(r4).not.toBeNull();
    expect(text.slice(r4!.start, r4!.end)).toBe(text);
    expect(r4!.type).toBe('sub');

    const r21 = findMarkupRangeById(text, 'cn-2.1');
    expect(r21).not.toBeNull();
    const extracted21 = text.slice(r21!.start, r21!.end);
    expect(extracted21).toBe(
      '{~~OLD{~~inner~>x~~}[^cn-3]~>MIDDLE~~}[^cn-2.1]',
    );

    const r3 = findMarkupRangeById(text, 'cn-3');
    expect(r3).not.toBeNull();
    const extracted3 = text.slice(r3!.start, r3!.end);
    expect(extracted3).toBe('{~~inner~>x~~}[^cn-3]');
  });

  // ── Orphan ref — no adjacent markup close ──────────────────────────────────

  test('orphan ref with no adjacent markup close → null', () => {
    const text = 'plain prose [^cn-1] more prose';
    expect(findMarkupRangeById(text, 'cn-1')).toBeNull();
  });

  test('markup close NOT adjacent (gap before ref) → null for that id', () => {
    // There is a gap between ~~} and [^cn-1], so it does not match.
    const text = '{~~old~>new~~} gap [^cn-1]';
    expect(findMarkupRangeById(text, 'cn-1')).toBeNull();
  });

  // ── Missing ID ────────────────────────────────────────────────────────────

  test('ID not present in text → null', () => {
    const text = '{~~old~>new~~}[^cn-1]';
    expect(findMarkupRangeById(text, 'cn-99')).toBeNull();
  });

  test('empty string → null', () => {
    expect(findMarkupRangeById('', 'cn-1')).toBeNull();
  });

  // ── Code zone exclusion ────────────────────────────────────────────────────

  test('open delimiter inside backtick code span is ignored', () => {
    // `{~~` is inside inline code — should not be treated as a real open.
    const text = 'Use `{~~` to start. {~~real~>replacement~~}[^cn-1]';
    const r = findMarkupRangeById(text, 'cn-1');
    expect(r).not.toBeNull();
    expect(text.slice(r!.start, r!.end)).toBe('{~~real~>replacement~~}[^cn-1]');
  });

  test('entire markup inside fenced code block is ignored', () => {
    const text = '```\n{~~old~>new~~}[^cn-1]\n```\nclean prose';
    expect(findMarkupRangeById(text, 'cn-1')).toBeNull();
  });

  // ── Adjacent spans (non-nested) ────────────────────────────────────────────

  test('two adjacent spans — each found by its own ID', () => {
    const text = '{++ins++}[^cn-1]{--del--}[^cn-2]';
    const r1 = findMarkupRangeById(text, 'cn-1');
    expect(r1).not.toBeNull();
    expect(text.slice(r1!.start, r1!.end)).toBe('{++ins++}[^cn-1]');
    expect(r1!.type).toBe('ins');

    const r2 = findMarkupRangeById(text, 'cn-2');
    expect(r2).not.toBeNull();
    expect(text.slice(r2!.start, r2!.end)).toBe('{--del--}[^cn-2]');
    expect(r2!.type).toBe('del');
  });
});

// ── removeMarkupById ─────────────────────────────────────────────────────────

describe('removeMarkupById', () => {
  test('removes the span and ref, leaves surrounding text intact', () => {
    const text = 'Before {~~old~>new~~}[^cn-1] after.';
    expect(removeMarkupById(text, 'cn-1')).toBe('Before  after.');
  });

  test('ID not found → text unchanged', () => {
    const text = '{~~old~>new~~}[^cn-1]';
    expect(removeMarkupById(text, 'cn-99')).toBe(text);
  });

  test('removes innermost span without disturbing outer span', () => {
    const text =
      '{~~outer{~~inner~>x~~}[^cn-2]~>y~~}[^cn-1]';
    const after = removeMarkupById(text, 'cn-2');
    // Inner span {~~inner~>x~~}[^cn-2] is removed; outer {~~outer~>y~~}[^cn-1] remains.
    expect(after).toBe('{~~outer~>y~~}[^cn-1]');
  });

  test('removes multi-type nested inner span correctly', () => {
    const text = '{~~outer{++middle++}[^cn-2]~>y~~}[^cn-1]';
    const after = removeMarkupById(text, 'cn-2');
    expect(after).toBe('{~~outer~>y~~}[^cn-1]');
  });

  test('removes entire three-layer structure when given outermost ID', () => {
    const text =
      '{~~{~~OLD{~~inner~>x~~}[^cn-3]~>MIDDLE~~}[^cn-2.1]~>CLEAN~~}[^cn-4]';
    const after = removeMarkupById(text, 'cn-4');
    expect(after).toBe('');
  });
});
