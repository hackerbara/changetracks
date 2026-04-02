import { describe, it, expect } from 'vitest';
import { parseFootnotes } from '../src/footnote-parser.js';

describe('footnote-parser equation metadata', () => {
  it('parses equation-* metadata keys', () => {
    const content = [
      '# Doc',
      '$E=mc^2$',
      '',
      '[^cn-1]: @system | 2026-03-31 | equation | proposed',
      '    equation-omml: PG06b01hdGhQYXJhPg==',
      '    equation-latex-hash: abc123def456',
      '    equation-display: false',
    ].join('\n');
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('cn-1');
    expect(fn).toBeDefined();
    expect(fn!.type).toBe('equation');
    expect(fn!.equationMetadata).toEqual({
      'equation-omml': 'PG06b01hdGhQYXJhPg==',
      'equation-latex-hash': 'abc123def456',
      'equation-display': 'false',
    });
  });

  it('parses equation metadata alongside reason', () => {
    const content = [
      '[^cn-2]: @system | 2026-03-31 | equation | proposed',
      '    reason: imported from DOCX',
      '    equation-omml: PG06b01hdGhQYXJhPg==',
      '    equation-latex-hash: xyz789',
    ].join('\n');
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('cn-2');
    expect(fn!.reason).toBe('imported from DOCX');
    expect(fn!.equationMetadata).toBeDefined();
    expect(fn!.equationMetadata!['equation-omml']).toBe('PG06b01hdGhQYXJhPg==');
    expect(fn!.equationMetadata!['equation-latex-hash']).toBe('xyz789');
  });

  it('returns undefined equationMetadata when no equation-* keys present', () => {
    const content = `[^cn-3]: @alice | 2026-03-14 | ins | proposed
    reason: just a text change
`;
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('cn-3');
    expect(fn).toBeDefined();
    expect(fn!.equationMetadata).toBeUndefined();
  });

  it('does not mix image-* and equation-* metadata', () => {
    const content = [
      '[^cn-4]: @system | 2026-03-31 | equation | proposed',
      '    equation-omml: PG06b01hdGhQYXJhPg==',
      '    image-float: anchor',
    ].join('\n');
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('cn-4');
    expect(fn!.equationMetadata).toEqual({
      'equation-omml': 'PG06b01hdGhQYXJhPg==',
    });
    expect(fn!.imageMetadata).toEqual({
      'image-float': 'anchor',
    });
  });
});
