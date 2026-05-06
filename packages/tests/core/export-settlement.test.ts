import { describe, expect, it, beforeAll } from 'vitest';
import { initHashline, materializeResolvedChangesForExport } from '@changedown/core';

describe('materializeResolvedChangesForExport', () => {
  beforeAll(async () => {
    await initHashline();
  });

  it('applies accepted changes and preserves proposed changes for review export', () => {
    const input = [
      'Keep {++accepted++}[^cn-1] and {++pending++}[^cn-2].',
      '',
      '[^cn-1]: @ai | 2026-05-05 | ins | accepted',
      '[^cn-2]: @ai | 2026-05-05 | ins | proposed',
    ].join('\n');

    const result = materializeResolvedChangesForExport(input);

    expect(result.text).toContain('Keep accepted and {++pending++}[^cn-2].');
    expect(result.text).not.toContain('[^cn-1]:');
    expect(result.text).toContain('[^cn-2]:');
    expect(result.settledIds).toEqual(['cn-1']);
  });

  it('reverts rejected changes and preserves unrelated footnotes', () => {
    const input = [
      'Use {~~old~>new~~}[^cn-1] wording and {==marked==}[^cn-2].',
      '',
      '[^cn-1]: @ai | 2026-05-05 | sub | rejected',
      '[^cn-2]: @ai | 2026-05-05 | hi | proposed',
    ].join('\n');

    const result = materializeResolvedChangesForExport(input);

    expect(result.text).toContain('Use old wording and {==marked==}[^cn-2].');
    expect(result.text).not.toContain('[^cn-1]:');
    expect(result.text).toContain('[^cn-2]:');
    expect(result.settledIds).toEqual(['cn-1']);
  });
});
