import { describe, it, expect } from 'vitest';
import { findFootnoteBlockStart } from '@changetracks/core/internals';

describe('findFootnoteBlockStart', () => {
  it('returns lines.length for content without footnotes', () => {
    const lines = ['# Title', 'Some text', ''];
    expect(findFootnoteBlockStart(lines)).toBe(3);
  });

  it('finds footnote block at end of file', () => {
    const lines = [
      '# Title',
      'Body text here.',
      '',
      '[^ct-1]: @alice | 2026-02-17 | ins | proposed',
      '    reason: spelling fix',
    ];
    expect(findFootnoteBlockStart(lines)).toBe(3);
  });

  it('finds block with multiple footnotes', () => {
    const lines = [
      '# Title',
      'Body.',
      '',
      '[^ct-1]: @alice | 2026-02-17 | ins | proposed',
      '    reason: fix',
      '[^ct-2]: @bob | 2026-02-17 | del | accepted',
      '    approved: @alice 2026-02-17 "ok"',
    ];
    expect(findFootnoteBlockStart(lines)).toBe(3);
  });

  it('ignores [^ct- inside CriticMarkup substitution wrapping a code fence', () => {
    const lines = [
      '# Title',
      'Body paragraph.',
      '```markdown',
      '[^ct-5]: @alice | 2026-03-14 | ins | proposed',
      '    image-dimensions: 2.5in x 1.8in',
      '[^ct-6]: @system | 2026-03-14 | image | proposed',
      '    image-dimensions: 4.0in x 3.0in',
      '```',
      'More body text.',
      '',
      '[^ct-1]: @alice | 2026-03-14 | creation | proposed',
      '    @alice 2026-03-14T16:50:21Z: File created',
    ];
    // Should find the REAL footnote at index 10, not the false positives inside the code fence
    expect(findFootnoteBlockStart(lines)).toBe(10);
  });


  it('ignores [^ct- inside CriticMarkup substitution (no code fence)', () => {
    const lines = [
      '# Title',
      'Body paragraph.',
      'new text',
      '',
      '[^ct-1]: @alice | 2026-03-14 | ins | proposed',
    ];
    // The [^ct-5] on index 2 is inside CriticMarkup, not a real footnote
    expect(findFootnoteBlockStart(lines)).toBe(4);
  });

  it('ignores [^ct- inside a code fence in body', () => {
    const lines = [
      '# Title',
      '```markdown',
      '[^ct-5]: @alice | 2026-02-17 | ins | proposed',
      '```',
      'Body text.',
      '',
      '[^ct-1]: @alice | 2026-02-17 | ins | proposed',
    ];
    expect(findFootnoteBlockStart(lines)).toBe(6);
  });

  it('handles file that is entirely footnotes', () => {
    const lines = [
      '[^ct-1]: @alice | 2026-02-17 | ins | proposed',
      '[^ct-2]: @bob | 2026-02-17 | del | accepted',
    ];
    expect(findFootnoteBlockStart(lines)).toBe(0);
  });

  it('handles empty file', () => {
    const lines = [''];
    expect(findFootnoteBlockStart(lines)).toBe(1);
  });

  it('handles trailing blank lines after footnotes', () => {
    const lines = [
      'Body.',
      '',
      '[^ct-1]: @alice | 2026-02-17 | ins | proposed',
      '',
      '',
    ];
    // Block starts at line 2 (the footnote def); trailing blanks are part of the block
    expect(findFootnoteBlockStart(lines)).toBe(2);
  });

  it('handles blank separators between footnotes', () => {
    const lines = [
      'Body.',
      '',
      '[^ct-1]: @alice | 2026-02-17 | ins | proposed',
      '    reason: fix',
      '',
      '[^ct-2]: @bob | 2026-02-17 | del | accepted',
    ];
    expect(findFootnoteBlockStart(lines)).toBe(2);
  });

  it('handles malformed trailing footnote (matches FOOTNOTE_DEF_START but not LENIENT)', () => {
    const lines = [
      'Body.',
      '',
      '[^ct-1]: @alice | 2026-02-17 | ins | proposed',
      '    reason: fix',
      '[^ct-2]: garbled content here',
    ];
    // FOOTNOTE_DEF_START matches [^ct-2]: even though header is malformed
    expect(findFootnoteBlockStart(lines)).toBe(2);
  });

  it('handles dotted IDs (ct-N.M)', () => {
    const lines = [
      'Body.',
      '',
      '[^ct-5.2]: @alice | 2026-02-17 | del | proposed',
    ];
    expect(findFootnoteBlockStart(lines)).toBe(2);
  });

  it('handles continuation lines with varying indentation', () => {
    const lines = [
      'Body.',
      '',
      '[^ct-1]: @alice | 2026-02-17 | sub | proposed',
      '    reason: complex change',
      '  @bob 2026-02-18: short indent reply',
      '        deep indent content',
    ];
    // All indented lines (/^\s+\S/) are continuations
    expect(findFootnoteBlockStart(lines)).toBe(2);
  });
});
