import { describe, it, expect } from 'vitest';
import { applyRejectedChanges } from '@changedown/mcp/internals';

function bodyOf(text: string): string {
  return text.split('\n\n')[0];
}

describe('applyRejectedChanges', () => {
  it('settles rejected insertion by removing inline markup, preserving footnote ref and definition', () => {
    const input =
      'Hello {++ beautiful ++}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | ins | rejected';
    const { currentContent, appliedIds } = applyRejectedChanges(input);
    // Rejected insertion: {++ beautiful ++} removed, footnote ref [^cn-1] stays
    expect(bodyOf(currentContent)).toBe('Hello [^cn-1]world');
    expect(currentContent).toContain('[^cn-1]: @alice | 2026-02-11 | ins | rejected');
    expect(currentContent).toContain('{++ beautiful ++}world');
    expect(appliedIds).toEqual(['cn-1']);
  });

  it('settles rejected deletion by restoring original text, preserving footnote ref and definition', () => {
    const input =
      'Hello {-- beautiful --}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | del | rejected';
    const { currentContent, appliedIds } = applyRejectedChanges(input);
    // Rejected deletion: original text restored with footnote ref
    expect(bodyOf(currentContent)).toBe('Hello  beautiful [^cn-1]world');
    expect(currentContent).toContain('[^cn-1]: @alice | 2026-02-11 | del | rejected');
    expect(currentContent).toContain('{-- beautiful --}world');
    expect(appliedIds).toEqual(['cn-1']);
  });

  it('settles rejected substitution by restoring original text, preserving footnote ref and definition', () => {
    const input =
      'Hello {~~beautiful~>ugly~~}[^cn-1]world\n\n[^cn-1]: @alice | 2026-02-11 | sub | rejected';
    const { currentContent, appliedIds } = applyRejectedChanges(input);
    // Rejected substitution: original text (before ~>) restored with footnote ref
    expect(bodyOf(currentContent)).toContain('beautiful[^cn-1]');
    expect(bodyOf(currentContent)).not.toContain('ugly');
    expect(bodyOf(currentContent)).not.toContain('{~~');
    expect(currentContent).toContain('{~~beautiful~>ugly~~}world');
    expect(currentContent).toContain('[^cn-1]:');
    expect(appliedIds).toEqual(['cn-1']);
  });

  it('leaves proposed and accepted changes untouched', () => {
    const input = [
      '{++new++}[^cn-1] {--old--}[^cn-2]',
      '',
      '[^cn-1]: @a | 2026-02-11 | ins | proposed',
      '[^cn-2]: @a | 2026-02-11 | del | accepted',
    ].join('\n');
    const { currentContent, appliedIds } = applyRejectedChanges(input);
    expect(currentContent).toBe(input);
    expect(appliedIds).toEqual([]);
  });

  it('returns empty appliedIds when no rejected changes', () => {
    const input = 'No markup here.';
    const { currentContent, appliedIds } = applyRejectedChanges(input);
    expect(currentContent).toBe(input);
    expect(appliedIds).toEqual([]);
  });

  it('mix of rejected and proposed: only rejected settled', () => {
    const input = [
      'A {++rejected++}[^cn-1] B {++proposed++}[^cn-2] C',
      '',
      '[^cn-1]: @a | 2026-02-11 | ins | rejected',
      '[^cn-2]: @a | 2026-02-11 | ins | proposed',
    ].join('\n');
    const { currentContent, appliedIds } = applyRejectedChanges(input);
    expect(appliedIds).toEqual(['cn-1']);
    // cn-1 rejected insertion removed, footnote ref kept
    expect(currentContent).toContain('[^cn-1]');
    expect(bodyOf(currentContent)).not.toContain('{++rejected++}');
    // cn-2 proposed: untouched
    expect(currentContent).toContain('{++proposed++}[^cn-2]');
    // Both footnote definitions preserved
    expect(currentContent).toContain('[^cn-1]:');
    expect(currentContent).toContain('[^cn-2]:');
  });

  it('mix of rejected and accepted: only rejected settled', () => {
    const input = [
      'A {++accepted++}[^cn-1] B {++rejected++}[^cn-2] C',
      '',
      '[^cn-1]: @a | 2026-02-11 | ins | accepted',
      '[^cn-2]: @a | 2026-02-11 | ins | rejected',
    ].join('\n');
    const { currentContent, appliedIds } = applyRejectedChanges(input);
    expect(appliedIds).toEqual(['cn-2']);
    // cn-1 accepted: untouched by reject settler
    expect(currentContent).toContain('{++accepted++}[^cn-1]');
    // cn-2 rejected insertion removed, footnote ref kept
    expect(currentContent).toContain('[^cn-2]');
    expect(bodyOf(currentContent)).not.toContain('{++rejected++}');
    // Both footnote definitions preserved
    expect(currentContent).toContain('[^cn-1]:');
    expect(currentContent).toContain('[^cn-2]:');
  });

  it('footnotes for settled rejected changes are preserved (Layer 1)', () => {
    const input =
      'X {++y++}[^cn-1] Z\n\n[^cn-1]: @a | 2026-02-11 | ins | rejected\n    reason: no thanks';
    const { currentContent } = applyRejectedChanges(input);
    // Layer 1: footnote definition and inline ref preserved for audit trail
    expect(currentContent).toContain('[^cn-1]:');
    expect(currentContent).toContain('[^cn-1] Z');
    expect(bodyOf(currentContent)).not.toContain('{++');
    expect(currentContent).toContain('{++y++} Z');
  });
});
