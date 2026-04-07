import { describe, it, expect } from 'vitest';
import { generateViewModeCSS } from '@changedown/preview';

describe('generateViewModeCSS', () => {
  it('returns CSS string containing simple (changes) mode selectors', () => {
    const css = generateViewModeCSS();
    expect(css).toContain('[data-view-name="simple"]');
  });

  it('contains hiding rules for deletions', () => {
    const css = generateViewModeCSS();
    expect(css).toContain('.cn-del');
    expect(css).toContain('display: none');
  });

  it('contains plain text rules for insertions', () => {
    const css = generateViewModeCSS();
    expect(css).toContain('.cn-ins');
    expect(css).toContain('text-decoration: none');
  });

  it('contains change gutter rules', () => {
    const css = generateViewModeCSS();
    expect(css).toContain('border-left: 3px solid');
    expect(css).toContain(':has(ins.cn-ins)');
  });

  it('contains light theme variants', () => {
    const css = generateViewModeCSS();
    expect(css).toContain('.vscode-light');
    expect(css).toContain('.cn-light');
  });
});
