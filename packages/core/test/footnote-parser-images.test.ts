import { describe, it, expect } from 'vitest';
import { parseFootnotes } from '../src/footnote-parser.js';

describe('footnote-parser image-dimensions', () => {
  it('parses image-dimensions from ins footnote', () => {
    const content = `Some text

[^ct-1]: @alice | 2026-03-14 | ins | proposed
    image-dimensions: 2.5in x 1.8in
`;
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('ct-1');
    expect(fn).toBeDefined();
    expect(fn!.imageDimensions).toEqual({ widthIn: 2.5, heightIn: 1.8 });
  });

  it('parses image-dimensions from image-type footnote', () => {
    const content = `![alt](media/hash.png)

[^ct-2]: @system | 2026-03-14 | image | proposed
    image-dimensions: 4.0in x 3.0in
`;
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('ct-2');
    expect(fn).toBeDefined();
    expect(fn!.type).toBe('image');
    expect(fn!.imageDimensions).toEqual({ widthIn: 4.0, heightIn: 3.0 });
  });

  it('returns undefined imageDimensions when not present', () => {
    const content = `[^ct-3]: @alice | 2026-03-14 | ins | proposed\n`;
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('ct-3');
    expect(fn).toBeDefined();
    expect(fn!.imageDimensions).toBeUndefined();
  });

  it('parses image-dimensions alongside reason', () => {
    const content = `[^ct-4]: @alice | 2026-03-14 | ins | proposed
    reason: added diagram
    image-dimensions: 6.5in x 4.2in
`;
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('ct-4');
    expect(fn!.reason).toBe('added diagram');
    expect(fn!.imageDimensions).toEqual({ widthIn: 6.5, heightIn: 4.2 });
  });

  it('handles fractional inch values', () => {
    const content = `[^ct-5]: @alice | 2026-03-14 | image | proposed
    image-dimensions: 0.3333333333333333in x 0.3333333333333333in
`;
    const footnotes = parseFootnotes(content);
    const fn = footnotes.get('ct-5');
    expect(fn!.imageDimensions!.widthIn).toBeCloseTo(0.333, 3);
    expect(fn!.imageDimensions!.heightIn).toBeCloseTo(0.333, 3);
  });
});
