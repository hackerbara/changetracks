/**
 * Browser-safe inline formatting codec shared by DOCX import/export and the
 * live Word add-in.
 *
 * This module deliberately has no dependency on `docx`, JSZip, Pandoc, image
 * builders, or Node APIs. It only translates between:
 *   - markdown inline text used by ChangeDown payloads,
 *   - plain formatted run spans,
 *   - small OOXML run fragments from Word.
 */

export type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
};

export type TextSegment = {
  kind: 'text';
  text: string;
} & InlineStyle;

export type LinkSegment = {
  kind: 'link';
  text: string;
  url: string;
} & InlineStyle;

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

export interface FormattedRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  hyperlink?: string;
}

export interface OffsetMapEntry {
  plainStart: number;
  plainEnd: number;
  markdownStart: number;
  markdownEnd: number;
}

export interface MarkdownProjection {
  plainText: string;
  markdownText: string;
  offsetMap: OffsetMapEntry[];
}

export interface FormattingDelta {
  kind: 'none' | 'formatting' | 'text' | 'text-and-formatting';
  oldPlain: string;
  newPlain: string;
  oldMarkdown: string;
  newMarkdown: string;
}

export interface FormattingRevisionProjection {
  plainText: string;
  originalMarkdown: string;
  modifiedMarkdown: string;
  current: MarkdownProjection;
  previous: MarkdownProjection;
}

function styleOf(seg: InlineSegment): InlineStyle {
  if (seg.kind === 'image' || seg.kind === 'math') return {};
  return {
    ...(seg.bold ? { bold: true } : {}),
    ...(seg.italic ? { italic: true } : {}),
    ...(seg.strikethrough ? { strikethrough: true } : {}),
    ...(seg.underline ? { underline: true } : {}),
    ...(seg.code ? { code: true } : {}),
  };
}

function sameStyle(a: InlineStyle, b: InlineStyle): boolean {
  return !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strikethrough === !!b.strikethrough &&
    !!a.underline === !!b.underline &&
    !!a.code === !!b.code;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/([\\`*_[\]()!~$<>])/g, '\\$1');
}

function unescapeMarkdownText(text: string): string {
  return text.replace(/\\([\\`*_[\]()!~$<>])/g, '$1');
}

function escapeMarkdownLinkDestination(url: string): string {
  const escaped = url.replace(/>/g, '%3E');
  return `<${escaped}>`;
}

function unescapeMarkdownLinkDestination(url: string): string {
  return url.replace(/\\([()<>])/g, '$1');
}

function tryParseLinkAt(text: string, pos: number): { text: string; url: string; length: number } | null {
  if (text[pos] !== '[') return null;
  let i = pos + 1;
  let label = '';
  let depth = 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] !== undefined) {
      label += text[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) break;
    }
    label += ch;
    i++;
  }
  if (i >= text.length || text[i] !== ']' || text[i + 1] !== '(') return null;
  i += 2;
  let url = '';
  if (text[i] === '<') {
    i++;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '\\' && text[i + 1] !== undefined) {
        url += text[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === '>') {
        i++;
        break;
      }
      url += ch;
      i++;
    }
    if (text[i] !== ')') return null;
    return { text: label, url: unescapeMarkdownLinkDestination(url), length: i - pos + 1 };
  }
  let parenDepth = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] !== undefined) {
      url += text[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === '(') parenDepth++;
    if (ch === ')') {
      if (parenDepth === 0) return { text: label, url: unescapeMarkdownLinkDestination(url), length: i - pos + 1 };
      parenDepth--;
    }
    url += ch;
    i++;
  }
  return null;
}

/**
 * State-machine inline parser. This is the dependency-light version of the
 * existing DOCX exporter parser, with `italic` normalized as the canonical
 * property name.
 */
export function parseInlineSegments(text: string): InlineSegment[] {
  if (!text) return [];

  const segments: InlineSegment[] = [];
  let pos = 0;
  let acc = '';

  let bold = false;
  let italic = false;
  let strikethrough = false;
  let underline = false;
  let code = false;

  function flush(): void {
    if (!acc) return;
    const seg: TextSegment = { kind: 'text', text: acc };
    if (bold) seg.bold = true;
    if (italic) seg.italic = true;
    if (strikethrough) seg.strikethrough = true;
    if (underline) seg.underline = true;
    if (code) seg.code = true;
    segments.push(seg);
    acc = '';
  }

  while (pos < text.length) {
    if (code) {
      if (text[pos] === '`') {
        flush();
        code = false;
        pos++;
      } else {
        acc += text[pos++];
      }
      continue;
    }

    if (text[pos] === '\\' && text[pos + 1] !== undefined) {
      acc += text[pos + 1];
      pos += 2;
      continue;
    }

    if (text.startsWith('$$', pos)) {
      const end = text.indexOf('$$', pos + 2);
      if (end !== -1) {
        flush();
        segments.push({ kind: 'math', latex: text.slice(pos + 2, end), displayMode: true });
        pos = end + 2;
        continue;
      }
    }

    if (text[pos] === '$' && text[pos + 1] !== '$' && text[pos + 1] !== ' ' && text[pos + 1] !== undefined) {
      const end = text.indexOf('$', pos + 1);
      if (end !== -1 && text[end - 1] !== ' ') {
        flush();
        segments.push({ kind: 'math', latex: text.slice(pos + 1, end), displayMode: false });
        pos = end + 1;
        continue;
      }
    }

    if (text.startsWith('***', pos)) {
      flush();
      bold = !bold;
      italic = !italic;
      pos += 3;
      continue;
    }
    if (text.startsWith('**', pos)) {
      flush();
      bold = !bold;
      pos += 2;
      continue;
    }
    if (text[pos] === '*') {
      flush();
      italic = !italic;
      pos++;
      continue;
    }
    if (text.startsWith('~~', pos)) {
      flush();
      strikethrough = !strikethrough;
      pos += 2;
      continue;
    }
    if (text.startsWith('</u>', pos)) {
      flush();
      underline = false;
      pos += 4;
      continue;
    }
    if (text.startsWith('<u>', pos)) {
      flush();
      underline = true;
      pos += 3;
      continue;
    }
    if (text[pos] === '`') {
      flush();
      code = true;
      pos++;
      continue;
    }

    if (text.startsWith('![', pos)) {
      const imgMatch = text.slice(pos).match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (imgMatch) {
        flush();
        segments.push({ kind: 'image', altText: imgMatch[1] ?? '', path: imgMatch[2] ?? '' });
        pos += imgMatch[0].length;
        continue;
      }
    }

    if (text[pos] === '[') {
      const link = tryParseLinkAt(text, pos);
      if (link) {
        flush();
        const seg: LinkSegment = { kind: 'link', text: link.text, url: link.url };
        if (bold) seg.bold = true;
        if (italic) seg.italic = true;
        if (strikethrough) seg.strikethrough = true;
        if (underline) seg.underline = true;
        if (code) seg.code = true;
        segments.push(seg);
        pos += link.length;
        continue;
      }
    }

    acc += text[pos++];
  }

  flush();
  return segments;
}

export function inlineSegmentsToPlainText(segments: readonly InlineSegment[]): string {
  return segments.map((seg) => {
    if (seg.kind === 'text' || seg.kind === 'link') return seg.text;
    if (seg.kind === 'image') return seg.altText;
    return seg.latex;
  }).join('');
}

export function stripInlineMarkdown(markdown: string): string {
  return inlineSegmentsToPlainText(parseInlineSegments(markdown));
}

function wrapMarkdown(text: string, style: InlineStyle): string {
  let out = style.code ? text : escapeMarkdownText(text);
  return wrapMarkdownMarkup(out, style);
}

function wrapMarkdownMarkup(markup: string, style: InlineStyle): string {
  let out = markup;
  if (style.code) out = `\`${out}\``;
  if (style.strikethrough) out = `~~${out}~~`;
  if (style.bold && style.italic) out = `***${out}***`;
  else if (style.bold) out = `**${out}**`;
  else if (style.italic) out = `*${out}*`;
  if (style.underline) out = `<u>${out}</u>`;
  return out;
}

export function formattedRunsToMarkdown(runs: readonly FormattedRun[]): string {
  let out = '';
  for (const run of runs) {
    if (!run.text) continue;
    if (run.hyperlink) {
      const link = `[${escapeMarkdownText(run.text)}](${escapeMarkdownLinkDestination(run.hyperlink)})`;
      out += wrapMarkdownMarkup(link, run);
    } else {
      out += wrapMarkdown(run.text, run);
    }
  }
  return out;
}

export function formattedRunsToPlainText(runs: readonly FormattedRun[]): string {
  return runs.map((r) => r.text).join('');
}

export function inlineSegmentsToFormattedRuns(segments: readonly InlineSegment[]): FormattedRun[] {
  return segments.flatMap((seg): FormattedRun[] => {
    if (seg.kind === 'text') return [{ text: seg.text, ...styleOf(seg) }];
    if (seg.kind === 'link') return [{ text: seg.text, hyperlink: seg.url, ...styleOf(seg) }];
    if (seg.kind === 'image') return seg.altText ? [{ text: seg.altText }] : [];
    return [{ text: seg.latex }];
  });
}

export function markdownToFormattedRuns(markdown: string): FormattedRun[] {
  return inlineSegmentsToFormattedRuns(parseInlineSegments(markdown));
}

export function projectFormattedRunsToMarkdown(runs: readonly FormattedRun[]): MarkdownProjection {
  let plainText = '';
  let markdownText = '';
  const offsetMap: OffsetMapEntry[] = [];
  for (const run of runs) {
    const plainStart = plainText.length;
    const markdownStart = markdownText.length;
    const runMarkdown = formattedRunsToMarkdown([run]);
    plainText += run.text;
    markdownText += runMarkdown;
    offsetMap.push({
      plainStart,
      plainEnd: plainText.length,
      markdownStart,
      markdownEnd: markdownText.length,
    });
  }
  return { plainText, markdownText, offsetMap };
}

export function classifyFormattingDelta(oldMarkdown: string, newMarkdown: string): FormattingDelta {
  const oldPlain = stripInlineMarkdown(oldMarkdown);
  const newPlain = stripInlineMarkdown(newMarkdown);
  if (oldMarkdown === newMarkdown) {
    return { kind: 'none', oldPlain, newPlain, oldMarkdown, newMarkdown };
  }
  if (oldPlain === newPlain) {
    return { kind: 'formatting', oldPlain, newPlain, oldMarkdown, newMarkdown };
  }
  const oldHadFormatting = oldMarkdown !== oldPlain;
  const newHadFormatting = newMarkdown !== newPlain;
  return {
    kind: oldHadFormatting || newHadFormatting ? 'text-and-formatting' : 'text',
    oldPlain,
    newPlain,
    oldMarkdown,
    newMarkdown,
  };
}

function attrVal(attrs: string, names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(`${name}=(["'])(.*?)\\1`);
    const match = attrs.match(re);
    if (match) return match[2];
  }
  return undefined;
}

function booleanProp(xml: string, tag: string): boolean | undefined {
  const re = new RegExp(`<w:${tag}\\b([^>]*)\\/?>(?:</w:${tag}>)?`, 'i');
  const match = xml.match(re);
  if (!match) return undefined;
  const val = attrVal(match[1] ?? '', ['w:val', 'val']);
  if (val === undefined) return true;
  return !(val === 'false' || val === '0' || val === 'off');
}

function underlineProp(xml: string): boolean | undefined {
  const match = xml.match(/<w:u\b([^>]*)\/?>(?:<\/w:u>)?/i);
  if (!match) return undefined;
  const val = attrVal(match[1] ?? '', ['w:val', 'val']);
  return val !== 'none' && val !== 'false' && val !== '0';
}

export function parseRunPropertiesXml(rPrXml: string): InlineStyle {
  const currentOnly = rPrXml.replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/gi, '');
  return {
    ...(booleanProp(currentOnly, 'b') ? { bold: true } : {}),
    ...(booleanProp(currentOnly, 'i') ? { italic: true } : {}),
    ...(booleanProp(currentOnly, 'strike') ? { strikethrough: true } : {}),
    ...(underlineProp(currentOnly) ? { underline: true } : {}),
  };
}

export function parsePreviousRunPropertiesXml(rPrXml: string): InlineStyle {
  const change = rPrXml.match(/<w:rPrChange\b[\s\S]*?<w:rPr\b[\s\S]*?<\/w:rPr>[\s\S]*?<\/w:rPrChange>/i)?.[0] ?? '';
  const previous = change.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0] ?? '';
  return parseRunPropertiesXml(previous);
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function extractFirstElementXml(xml: string, tagName: string): string {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  const open = openRe.exec(xml);
  if (!open) return '';
  let depth = 1;
  let cursor = (open.index ?? 0) + open[0].length;
  const tagRe = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tagRe.lastIndex = cursor;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml)) !== null) {
    const token = match[0];
    if (token.startsWith(`</${tagName}`)) depth--;
    else if (!token.endsWith('/>')) depth++;
    cursor = match.index + token.length;
    if (depth === 0) return xml.slice(open.index, cursor);
  }
  return xml.slice(open.index);
}

function relationshipTarget(attrs: string, relationships?: Record<string, string>): string | undefined {
  const relId = attrVal(attrs, ['r:id', 'id']);
  const base = relId && relationships?.[relId] ? relationships[relId] : undefined;
  const anchor = attrVal(attrs, ['w:anchor', 'anchor']);
  const docLocation = attrVal(attrs, ['w:docLocation', 'docLocation']);
  const fragment = anchor ?? docLocation;
  if (base && fragment) return `${base}#${fragment}`;
  if (base) return base;
  return fragment ? `#${fragment}` : undefined;
}

function parseHyperlinkInstruction(instr: string): string | undefined {
  const match = instr.match(/\bHYPERLINK\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const target = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!target) return undefined;
  const bookmark = instr.match(/\\l\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const fragment = bookmark?.[1] ?? bookmark?.[2] ?? bookmark?.[3];
  return fragment ? `${target}#${fragment}` : target;
}

export function extractOoxmlRelationshipTargets(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const relRe = /<Relationship\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = relRe.exec(xml)) !== null) {
    const attrs = match[1] ?? '';
    const type = attrVal(attrs, ['Type']);
    if (type && !/\/hyperlink$/i.test(type)) continue;
    const id = attrVal(attrs, ['Id']);
    const target = attrVal(attrs, ['Target']);
    if (id && target) out[id] = decodeXmlText(target);
  }
  return out;
}

function parseOoxmlRun(runXml: string, hyperlink?: string): FormattedRun | null {
  const rPr = extractFirstElementXml(runXml, 'w:rPr');
  const style = parseRunPropertiesXml(rPr);
  const texts: string[] = [];
  const textRe = /<w:(?:t|delText)\b[^>]*>([\s\S]*?)<\/w:(?:t|delText)>/gi;
  let textMatch: RegExpExecArray | null;
  while ((textMatch = textRe.exec(runXml)) !== null) {
    texts.push(decodeXmlText(textMatch[1] ?? ''));
  }
  if (texts.length === 0) return null;
  return {
    text: texts.join(''),
    ...style,
    ...(hyperlink ? { hyperlink } : {}),
  };
}

export function parseOoxmlRuns(xml: string, relationships?: Record<string, string>): FormattedRun[] {
  const runs: FormattedRun[] = [];
  const rels = relationships ?? extractOoxmlRelationshipTargets(xml);
  const tokenRe = /<w:fldSimple\b[\s\S]*?<\/w:fldSimple>|<w:hyperlink\b[\s\S]*?<\/w:hyperlink>|<w:r\b[\s\S]*?<\/w:r>/gi;
  let match: RegExpExecArray | null;
  let pendingFieldHyperlink: string | undefined;
  let activeFieldHyperlink: string | undefined;

  while ((match = tokenRe.exec(xml)) !== null) {
    const tokenXml = match[0];

    if (/^<w:hyperlink\b/i.test(tokenXml)) {
      const attrs = tokenXml.match(/^<w:hyperlink\b([^>]*)>/i)?.[1] ?? '';
      const hyperlink = relationshipTarget(attrs, rels);
      const innerRunRe = /<w:r\b[\s\S]*?<\/w:r>/gi;
      let innerMatch: RegExpExecArray | null;
      while ((innerMatch = innerRunRe.exec(tokenXml)) !== null) {
        const run = parseOoxmlRun(innerMatch[0], hyperlink);
        if (run) runs.push(run);
      }
      continue;
    }

    if (/^<w:fldSimple\b/i.test(tokenXml)) {
      const attrs = tokenXml.match(/^<w:fldSimple\b([^>]*)>/i)?.[1] ?? '';
      const hyperlink = parseHyperlinkInstruction(decodeXmlText(attrVal(attrs, ['w:instr', 'instr']) ?? ''));
      const innerRunRe = /<w:r\b[\s\S]*?<\/w:r>/gi;
      let innerMatch: RegExpExecArray | null;
      while ((innerMatch = innerRunRe.exec(tokenXml)) !== null) {
        const run = parseOoxmlRun(innerMatch[0], hyperlink);
        if (run) runs.push(run);
      }
      continue;
    }

    const instrText = tokenXml.match(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/i)?.[1];
    if (instrText !== undefined) {
      pendingFieldHyperlink = parseHyperlinkInstruction(decodeXmlText(instrText));
      continue;
    }

    const fldCharType = attrVal(tokenXml.match(/<w:fldChar\b([^>]*)\/?>/i)?.[1] ?? '', ['w:fldCharType', 'fldCharType']);
    if (fldCharType === 'separate') {
      activeFieldHyperlink = pendingFieldHyperlink;
      continue;
    }
    if (fldCharType === 'end') {
      pendingFieldHyperlink = undefined;
      activeFieldHyperlink = undefined;
      continue;
    }

    const run = parseOoxmlRun(tokenXml, activeFieldHyperlink);
    if (run) runs.push(run);
  }
  return runs;
}

export function parseOoxmlFormattingRevision(xml: string, fallbackText = ''): FormattingRevisionProjection | null {
  const currentRuns: FormattedRun[] = [];
  const previousRuns: FormattedRun[] = [];
  const runRe = /<w:r\b[\s\S]*?<\/w:r>/gi;
  let match: RegExpExecArray | null;
  while ((match = runRe.exec(xml)) !== null) {
    const runXml = match[0];
    const rPr = extractFirstElementXml(runXml, 'w:rPr');
    if (!/<w:rPrChange\b/i.test(rPr)) continue;
    const currentStyle = parseRunPropertiesXml(rPr);
    const previousStyle = parsePreviousRunPropertiesXml(rPr);
    const texts: string[] = [];
    const textRe = /<w:(?:t|delText)\b[^>]*>([\s\S]*?)<\/w:(?:t|delText)>/gi;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRe.exec(runXml)) !== null) {
      texts.push(decodeXmlText(textMatch[1] ?? ''));
    }
    const text = texts.join('');
    if (!text) continue;
    currentRuns.push({ text, ...currentStyle });
    previousRuns.push({ text, ...previousStyle });
  }
  if (currentRuns.length === 0) return null;
  const current = projectFormattedRunsToMarkdown(currentRuns);
  const previous = projectFormattedRunsToMarkdown(previousRuns);
  const plainText = current.plainText || previous.plainText || fallbackText;
  if (fallbackText && plainText !== fallbackText) return null;
  return {
    plainText,
    originalMarkdown: previous.markdownText || plainText,
    modifiedMarkdown: current.markdownText || plainText,
    current,
    previous,
  };
}

export function ooxmlToMarkdown(xml: string, fallbackText = '', relationships?: Record<string, string>): MarkdownProjection {
  const runs = parseOoxmlRuns(xml, relationships);
  if (runs.length === 0) {
    return {
      plainText: fallbackText,
      markdownText: fallbackText,
      offsetMap: fallbackText
        ? [{ plainStart: 0, plainEnd: fallbackText.length, markdownStart: 0, markdownEnd: fallbackText.length }]
        : [],
    };
  }
  return projectFormattedRunsToMarkdown(runs);
}

export interface RunFormattingPlan {
  text: string;
  style: InlineStyle;
  hyperlink?: string;
  plainStart: number;
  plainEnd: number;
}

export function markdownToFormattingPlan(markdown: string): RunFormattingPlan[] {
  const runs = markdownToFormattedRuns(markdown);
  let offset = 0;
  return runs.map((run) => {
    const start = offset;
    offset += run.text.length;
    return {
      text: run.text,
      style: {
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italic: true } : {}),
        ...(run.strikethrough ? { strikethrough: true } : {}),
        ...(run.underline ? { underline: true } : {}),
        ...(run.code ? { code: true } : {}),
      },
      ...(run.hyperlink ? { hyperlink: run.hyperlink } : {}),
      plainStart: start,
      plainEnd: offset,
    };
  });
}

export function hasAnyFormatting(markdown: string): boolean {
  return markdownToFormattingPlan(markdown).some((p) => !sameStyle(p.style, {}) || !!p.hyperlink);
}
