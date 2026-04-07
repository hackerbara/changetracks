import { describe, it, expect } from 'vitest';
import { computeSettlement } from 'changedown/internals';

describe('computeSettlement', () => {
  it('settles an accepted insertion (removes markup, keeps text)', () => {
    const content = [
      'Hello {++world++}[^cn-1].',
      '',
      '[^cn-1]: @alice | 2026-02-01 | ins | accepted',
      '    reason: added greeting',
    ].join('\n');
    const result = computeSettlement(content);
    expect(result.appliedCount).toBe(1);
    // After settlement, the inline markup is removed but footnote ref and definition remain (Layer 1)
    expect(result.currentContent).toContain('world');
    expect(result.currentContent).not.toContain('{++');
    expect(result.currentContent).not.toContain('++}');
  });

  it('settles an accepted deletion (removes markup and text)', () => {
    const content = [
      'Hello {--world--}[^cn-1] there.',
      '',
      '[^cn-1]: @alice | 2026-02-01 | del | accepted',
      '    reason: removed word',
    ].join('\n');
    const result = computeSettlement(content);
    expect(result.appliedCount).toBe(1);
    expect(result.currentContent).not.toContain('{--');
    expect(result.currentContent).not.toContain('--}');
    // The deleted text "world" is removed; "Hello" and "there" remain
    expect(result.currentContent).toContain('Hello');
    expect(result.currentContent).toContain('there');
  });

  it('leaves proposed changes untouched', () => {
    const content = 'Hello {++world++} there.';
    const result = computeSettlement(content);
    expect(result.appliedCount).toBe(0);
    expect(result.currentContent).toBe(content);
  });

  it('returns zero settledCount when no changes exist', () => {
    const content = 'Just plain text.';
    const result = computeSettlement(content);
    expect(result.appliedCount).toBe(0);
    expect(result.currentContent).toBe(content);
  });
});
