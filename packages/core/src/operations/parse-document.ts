/**
 * Parse / serialize the typed Document model.
 *
 * Pure functions with no state. FormatService.parseL2/parseL3 (Plan 2)
 * will be thin delegates to these.
 *
 * Round-trip invariant: serializeL3(parseL3(text)) === text modulo trailing-
 * whitespace normalization. The FootnoteLine.unknown variant preserves any
 * unrecognized lines verbatim via their `raw` field.
 *
 * See docs/superpowers/specs/2026-04-07-view-and-format-cleanup-design.md
 * §"FormatService primitives".
 */

import type { L2Document, L3Document } from '../model/document.js';
import { splitBodyAndFootnotes } from '../footnote-patterns.js';
import { parseFootnoteBlock } from '../parser/footnote-block-parser.js';

export function parseL2(text: string): L2Document {
  const lines = text.split('\n');
  const { footnoteLines } = splitBodyAndFootnotes(lines);
  // footnoteLines is a contiguous suffix of lines; its first element is at index
  // (lines.length - footnoteLines.length) in the original array. This matches the
  // formula used by FootnoteNativeParser.parseFootnotes() so both parse paths
  // produce identical Footnote.sourceRange.startLine values.
  const footnoteStartIndex = lines.length - footnoteLines.length;
  const footnotes = parseFootnoteBlock(footnoteLines, footnoteStartIndex);
  return { format: 'L2', text, footnotes };
}

export function parseL3(text: string): L3Document {
  const lines = text.split('\n');
  const { bodyLines, footnoteLines } = splitBodyAndFootnotes(lines);
  // footnoteLines is a contiguous suffix of lines; its first element is at index
  // (lines.length - footnoteLines.length) in the original array. This matches the
  // formula used by FootnoteNativeParser.parseFootnotes() so both parse paths
  // produce identical Footnote.sourceRange.startLine values.
  const footnoteStartIndex = lines.length - footnoteLines.length;
  const footnotes = parseFootnoteBlock(footnoteLines, footnoteStartIndex);
  return { format: 'L3', body: bodyLines.join('\n'), footnotes };
}

/**
 * Serialize an L2Document back to text.
 * Round-trip invariant: parseL2(text).text === text, so serializeL2 returns
 * doc.text as-is.
 */
export function serializeL2(doc: L2Document): string {
  if (doc.footnotes.length === 0) {
    return doc.text.endsWith('\n') ? doc.text : doc.text + '\n';
  }
  return doc.text;
}

/**
 * Serialize an L3Document back to text: body + blank line + footnote section
 * reconstructed from each Footnote's bodyLines in order.
 */
export function serializeL3(doc: L3Document): string {
  if (doc.footnotes.length === 0) {
    return doc.body + '\n';
  }
  const footnoteLines: string[] = [];
  for (const f of doc.footnotes) {
    const headerAuthor = f.header.author.startsWith('@') ? f.header.author : '@' + f.header.author;
    footnoteLines.push(`[^${f.id}]: ${headerAuthor} | ${f.header.date} | ${f.header.type} | ${f.header.status}`);
    for (const bl of f.bodyLines) {
      footnoteLines.push(bl.raw);
    }
  }
  return doc.body + '\n\n' + footnoteLines.join('\n') + '\n';
}
