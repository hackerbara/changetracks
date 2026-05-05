import type { ThreeZoneDocument, ThreeZoneLine, DeliberationHeader, LineMetadata } from '../three-zone-types.js';
import type { BuiltinView } from '../../host/types.js';

/**
 * Formats a ThreeZoneDocument as plain text for agent consumption.
 *
 * The header is view-sensitive: working and simple views emit a 2-line summary
 * (counts + thread count, then authors) followed by `---`; decided and raw views
 * emit no header. Each content line is rendered as `LINENUM:HASH FLAG| text`,
 * with bracket metadata appended for working and simple views (`[changeId @author type status…]`).
 * The decided view appends a bottom status footer (`── accepted N · rejected N · proposed N · threads N ──`)
 * when any counts are non-zero.
 */
export function formatPlainText(doc: ThreeZoneDocument): string {
  const parts: string[] = [];

  const header = formatHeader(doc.header, doc.view);
  if (header) {
    parts.push(header);
    parts.push('');
  }

  const padWidth = doc.lines.length > 0
    ? Math.max(String(doc.lines[doc.lines.length - 1].margin.lineNumber).length, 2)
    : 2;

  for (const line of doc.lines) {
    parts.push(formatLine(line, padWidth, doc.view));
  }

  const footer = formatDecidedFooter(doc);
  if (footer) {
    parts.push(footer);
  }

  return parts.join('\n');
}

function formatHeader(header: DeliberationHeader, view: BuiltinView): string {
  if (view === 'decided' || view === 'raw') return '';

  const lines: string[] = [];
  const counts = `proposed: ${header.counts.proposed} | accepted: ${header.counts.accepted} | rejected: ${header.counts.rejected}`;
  const threads = header.threadCount > 0 ? ` | threads: ${header.threadCount}` : '';
  lines.push(`## ${counts}${threads}`);

  if (header.authors.length > 0) {
    lines.push(`## authors: ${header.authors.join(', ')}`);
  }

  lines.push('---');
  return lines.join('\n');
}

function formatDecidedFooter(doc: ThreeZoneDocument): string {
  if (doc.view !== 'decided') return '';
  const { counts, threadCount } = doc.header;
  const anyCount = counts.proposed > 0 || counts.accepted > 0 || counts.rejected > 0 || threadCount > 0;
  if (!anyCount) return '';
  return `── accepted ${counts.accepted} · rejected ${counts.rejected} · proposed ${counts.proposed} · threads ${threadCount} ──`;
}

function formatLine(line: ThreeZoneLine, padWidth: number, view: BuiltinView): string {
  // Zone 1: Margin
  const num = String(line.margin.lineNumber).padStart(padWidth, ' ');
  const flag = line.margin.flags.length > 0 ? line.margin.flags[0] : ' ';
  const margin = `${num}:${line.margin.hash} ${flag}|`;

  // Zone 2: Content
  const content = line.content.map(s => s.text).join('');

  // Zone 3: Metadata
  const meta = formatMetadata(line.metadata);

  return meta ? `${margin} ${content} ${meta}` : `${margin} ${content}`;
}

const MAX_TURN_CODE_POINTS = 60;

function truncateByCodePoints(text: string, max: number): string {
  if (text.length <= max) return text;
  const cps = [...text];
  if (cps.length <= max) return text;
  return cps.slice(0, max).join('') + '…';
}

/**
 * Ensures exactly one leading `@` on an author handle.
 * Callers may supply the handle with or without the prefix; this function always returns `@handle`.
 */
function withAtPrefix(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

export function formatMetadata(metadata: LineMetadata[]): string {
  if (metadata.length === 0) return '';

  return metadata.map(m => {
    const parts: string[] = [m.changeId];

    if (m.author) parts.push(withAtPrefix(m.author));
    if (m.type)   parts.push(m.type);
    if (m.status) parts.push(m.status);

    let head = parts.join(' ');

    if (m.reason) {
      head += `: "${m.reason}"`;
    }

    if (m.latestThreadTurn) {
      const turnAuthor = m.latestThreadTurn.author ? `${withAtPrefix(m.latestThreadTurn.author)}: ` : '';
      const turnText = truncateByCodePoints(m.latestThreadTurn.text, MAX_TURN_CODE_POINTS);
      head += ` | ${turnAuthor}${turnText}`;
    }

    return `[${head}]`;
  }).join(' ');
}
