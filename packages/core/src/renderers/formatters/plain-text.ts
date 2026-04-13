import type { ThreeZoneDocument, ThreeZoneLine, DeliberationHeader, LineMetadata } from '../three-zone-types.js';

/**
 * Formats a ThreeZoneDocument as plain text for agent consumption.
 *
 * Output structure:
 *   - Header block: file path, policy, tracking status, counts, authors
 *   - Separator: `---`
 *   - Lines: `LINENUM:HASH FLAG| content {>>metadata<<}`
 *
 * Metadata density varies by view:
 *   - working: full (changeId, author, reason, reply count)
 *   - simple: [cn-ID @author type status: reason | @author: turn]
 *   - decided: none
 */
export function formatPlainText(doc: ThreeZoneDocument): string {
  const parts: string[] = [];

  // Header
  parts.push(formatHeader(doc.header, doc.view));
  parts.push('');

  // Lines
  const padWidth = doc.lines.length > 0
    ? Math.max(String(doc.lines[doc.lines.length - 1].margin.lineNumber).length, 2)
    : 2;

  for (const line of doc.lines) {
    parts.push(formatLine(line, padWidth, doc.view));
  }

  return parts.join('\n');
}

function formatHeader(header: DeliberationHeader, view: string): string {
  const lines: string[] = [];
  lines.push(`## ${header.filePath} | policy: ${header.protocolMode} | tracking: ${header.trackingStatus}`);

  const counts = `proposed: ${header.counts.proposed} | accepted: ${header.counts.accepted} | rejected: ${header.counts.rejected}`;
  const threads = header.threadCount > 0 ? ` | threads: ${header.threadCount}` : '';
  lines.push(`## ${counts}${threads}`);

  if (header.authors.length > 0) {
    lines.push(`## authors: ${header.authors.join(', ')}`);
  }

  if (header.lineRange) {
    lines.push(`## lines: ${header.lineRange.start}-${header.lineRange.end} of ${header.lineRange.total}`);
  }

  lines.push('---');
  return lines.join('\n');
}

function formatLine(line: ThreeZoneLine, padWidth: number, view: string): string {
  // Zone 1: Margin
  const num = String(line.margin.lineNumber).padStart(padWidth, ' ');
  const flag = line.margin.flags.length > 0 ? line.margin.flags[0] : ' ';
  const margin = `${num}:${line.margin.hash} ${flag}|`;

  // Zone 2: Content
  const content = line.content.map(s => s.text).join('');

  // Zone 3: Metadata
  const meta = formatMetadata(line.metadata, view);

  return meta ? `${margin} ${content} ${meta}` : `${margin} ${content}`;
}

function ensureAt(author: string | undefined, fallback = ''): string {
  if (!author) return fallback;
  return author.startsWith('@') ? author : `@${author}`;
}

function formatMetadata(metadata: LineMetadata[], view: string): string {
  if (metadata.length === 0) return '';

  return metadata.map(m => {
    if (view === 'simple') {
      // [cn-ID @author type status: reason | @author: turn]
      const author = ensureAt(m.author);
      let block = `[${m.changeId}`;
      if (author) block += ` ${author}`;
      if (m.type) block += ` ${m.type}`;
      if (m.status) block += ` ${m.status}`;
      if (m.reason) block += `: ${m.reason}`;
      if (m.latestThreadTurn) {
        const turnAuthor = ensureAt(m.latestThreadTurn.author, '@?');
        block += ` | ${turnAuthor}: ${m.latestThreadTurn.text}`;
      }
      block += ']';
      return block;
    }
    // Working view: full metadata
    let block = `{>>${m.changeId}`;
    if (m.author) block += ` ${m.author}:`;
    if (m.reason) block += ` ${m.reason}`;
    if (m.replyCount && m.replyCount > 0) {
      block += ` | ${m.replyCount} ${m.replyCount === 1 ? 'reply' : 'replies'}`;
    }
    block += '<<}';
    return block;
  }).join(' ');
}
