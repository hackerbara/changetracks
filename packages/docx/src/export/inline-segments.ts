import {
  parseInlineSegments as parseInlineSegmentsCanonical,
  type InlineSegment as CanonicalInlineSegment,
} from '../inline-codec/index.js';

export type TextSegment = {
  kind: 'text';
  text: string;
  bold?: boolean;
  italics?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
};

export type LinkSegment = {
  kind: 'link';
  text: string;
  url: string;
  bold?: boolean;
  italics?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
};

export type ImageSegment = {
  kind: 'image';
  altText: string;
  path: string;
};

export type MathSegment = {
  kind: 'math';
  latex: string;
  displayMode: boolean;
};

export type InlineSegment = TextSegment | LinkSegment | ImageSegment | MathSegment;

/**
 * State-machine inline parser. Walks text character by character,
 * toggling formatting flags on delimiters, emitting segments on transitions.
 *
 * Delimiter precedence: longest match first (*** before ** before *).
 * Code spans are exclusive — no inner delimiters recognized until closing `.
 * Link/image detection uses regex lookahead at [ and ![ positions.
 */
export function parseInlineSegments(text: string): InlineSegment[] {
  return parseInlineSegmentsCanonical(text).map((seg: CanonicalInlineSegment) => {
    if (seg.kind === 'text') {
      const out: TextSegment = { kind: 'text', text: seg.text };
      if (seg.bold) out.bold = true;
      if (seg.italic) out.italics = true;
      if (seg.strikethrough) out.strikethrough = true;
      if (seg.underline) out.underline = true;
      if (seg.code) out.code = true;
      return out;
    }
    if (seg.kind === 'link') {
      const out: LinkSegment = { kind: 'link', text: seg.text, url: seg.url };
      if (seg.bold) out.bold = true;
      if (seg.italic) out.italics = true;
      if (seg.strikethrough) out.strikethrough = true;
      if (seg.underline) out.underline = true;
      return out;
    }
    return seg;
  });
}
