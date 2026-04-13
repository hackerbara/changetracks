/**
 * Review view builder — produces a ThreeZoneDocument with typed CriticMarkup spans.
 *
 * The review view is the richest view: it preserves all CriticMarkup inline,
 * identifies `[^cn-N]` footnote refs as anchor spans (preserving the caret), and projects
 * footnote metadata into Zone 3 (LineMetadata[]) on each line.
 *
 * Three zones per line:
 *   Zone 1 (Margin): lineNumber, hash, flags (P/A)
 *   Zone 2 (Content): typed ContentSpan[] with CriticMarkup decomposed into
 *     delimiter, insertion, deletion, sub_old, sub_arrow, sub_new, highlight,
 *     comment, anchor, and plain spans
 *   Zone 3 (Metadata): LineMetadata[] from footnotes referenced on this line
 */

import { buildSessionHashes } from './session-hashes.js';
import { buildLineMetadataFromFootnotes } from './line-metadata.js';
import { parseForFormat } from '../../format-aware-parse.js';
import { findFootnoteBlockStart } from '../../footnote-utils.js';
import { type ChangeNode } from '../../model/types.js';
import {
  buildDeliberationHeader,
  buildLineRefMap,
  findFootnoteSectionRange,
  computeContinuationLines,
  computePAFlags,
  type BuildHeaderOptions,
} from '../view-builder-utils.js';
import type {
  ThreeZoneDocument,
  ThreeZoneLine,
  ContentSpan,
  LineMetadata,
} from '../three-zone-types.js';
import type { BuiltinView } from '../../host/types.js';

// ─── CriticMarkup regex for per-line span decomposition ─────────────────────

/**
 * Matches all 5 CriticMarkup types on a single line.
 *
 * Capture groups:
 *   0: full match
 *   1: insertion content  ({++text++} → text)
 *   2: deletion content   ({--text--} → text)
 *   3: sub old            ({~~old~>new~~} → old)
 *   4: sub new            ({~~old~>new~~} → new)
 *   5: highlight content  ({==text==} → text)
 *   6: comment content    ({>>text<<} → text)
 *
 * Uses non-greedy matching within each type. Single-line-safe character
 * class negation for insertion/deletion/highlight/comment, and explicit
 * ~> split for substitution.
 */
const CRITIC_MARKUP_RE = /\{\+\+((?:[^+]|\+(?!\+\}))*?)\+\+\}|\{--((?:[^-]|-(?!-\}))*?)--\}|\{~~((?:[^~]|~(?!>))*?)~>((?:[^~]|~(?!~\}))*?)~~\}|\{==((?:[^=]|=(?!=\}))*?)==\}|\{>>((?:[^<]|<(?!<\}))*?)<<\}/g;

/**
 * Matches a footnote reference `[^cn-N]` or `[^cn-N.M]`.
 * Capture group 1: the ID (e.g. "cn-1", "cn-2.3").
 */
const FOOTNOTE_REF_RE = /\[\^(cn-\d+(?:\.\d+)?)\]/g;

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ReviewBuildOptions {
  filePath: string;
  trackingStatus: 'tracked' | 'untracked';
  protocolMode: string;
  defaultView: BuiltinView;
  viewPolicy: string;
}

/**
 * Build a ThreeZoneDocument in review view from raw file content.
 *
 * 1. Parse footnotes for metadata
 * 2. Find and exclude footnote section lines (+ preceding blank line)
 * 3. For each content line:
 *    a. Decompose CriticMarkup into typed ContentSpan[]
 *    b. Identify [^cn-N] refs as anchor spans (preserving caret)
 *    c. Build Zone 3 metadata from referenced footnotes
 *    d. Compute flags from footnote statuses
 * 4. Build deliberation header with aggregate counts
 */
export function buildReviewDocument(
  content: string,
  options: ReviewBuildOptions,
): ThreeZoneDocument {
  // Parse once — every projection reuses these changes
  const changes = parseForFormat(content).getChanges();

  const sessionHashesResult = buildSessionHashes(content, changes);

  const rawLines = content.split('\n');
  const footnoteMap = new Map<string, ChangeNode>();
  for (const node of changes) {
    footnoteMap.set(node.id, node);
  }

  // Determine footnote section range to exclude (unchanged from today)
  let fnRange = findFootnoteSectionRange(changes);
  if (!fnRange) {
    const blockStart = findFootnoteBlockStart(rawLines);
    if (blockStart < rawLines.length) {
      fnRange = [blockStart, rawLines.length - 1];
    }
  }

  const lineRefMap = buildLineRefMap(rawLines);
  const continuations = computeContinuationLines(content, changes);

  const outputLines: ThreeZoneLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    if (fnRange && i >= fnRange[0] && i <= fnRange[1]) continue;
    if (fnRange && i === fnRange[0] - 1 && rawLines[i].trim() === '') continue;

    const rawLine = rawLines[i];
    const lineNum = i + 1;

    const contentSpans = buildContentSpans(rawLine, footnoteMap);
    const refIds = lineRefMap.get(i);
    const metadata = buildLineMetadataFromFootnotes(refIds, footnoteMap);
    const flags = computePAFlags(refIds, footnoteMap);

    const sh = sessionHashesResult.byRawLine.get(lineNum)!;
    // display↔hash alignment
    const marginHash = sh.raw;

    outputLines.push({
      margin: { lineNumber: lineNum, hash: marginHash, flags },
      content: contentSpans,
      metadata,
      rawLineNumber: lineNum,
      continuesChange: continuations.has(i) || undefined,
      sessionHashes: {
        raw: sh.raw,
        committed: sh.committed,
        currentView: sh.currentView,
      },
    });
  }

  const header = buildDeliberationHeader({
    filePath: options.filePath,
    trackingStatus: options.trackingStatus,
    protocolMode: options.protocolMode,
    defaultView: options.defaultView,
    viewPolicy: options.viewPolicy,
    changes,
  });

  return {
    view: 'working',
    header,
    lines: outputLines,
  };
}

// ─── Span building ──────────────────────────────────────────────────────────

/**
 * Decompose a single line into typed ContentSpan[].
 *
 * Strategy:
 * 1. Find all CriticMarkup regions via regex
 * 2. Between regions, identify [^cn-N] footnote refs as anchor spans
 * 3. Emit typed spans for each region
 */
function buildContentSpans(
  line: string,
  footnoteMap: Map<string, ChangeNode>,
): ContentSpan[] {
  const spans: ContentSpan[] = [];
  let lastIndex = 0;

  // Reset regex state
  const re = new RegExp(CRITIC_MARKUP_RE.source, 'g');

  for (const match of line.matchAll(re)) {
    const matchStart = match.index!;

    // Emit plain/anchor spans for text between last match and this match
    if (matchStart > lastIndex) {
      const between = line.slice(lastIndex, matchStart);
      emitPlainAndAnchors(between, footnoteMap, spans);
    }

    // Determine which CriticMarkup type matched and emit typed spans
    if (match[1] !== undefined) {
      // Insertion: {++text++}
      spans.push({ type: 'delimiter', text: '{++' });
      spans.push({ type: 'insertion', text: match[1] });
      spans.push({ type: 'delimiter', text: '++}' });
    } else if (match[2] !== undefined) {
      // Deletion: {--text--}
      spans.push({ type: 'delimiter', text: '{--' });
      spans.push({ type: 'deletion', text: match[2] });
      spans.push({ type: 'delimiter', text: '--}' });
    } else if (match[3] !== undefined || match[4] !== undefined) {
      // Substitution: {~~old~>new~~}
      spans.push({ type: 'delimiter', text: '{~~' });
      spans.push({ type: 'sub_old', text: match[3] ?? '' });
      spans.push({ type: 'sub_arrow', text: '~>' });
      spans.push({ type: 'sub_new', text: match[4] ?? '' });
      spans.push({ type: 'delimiter', text: '~~}' });
    } else if (match[5] !== undefined) {
      // Highlight: {==text==}
      spans.push({ type: 'delimiter', text: '{==' });
      spans.push({ type: 'highlight', text: match[5] });
      spans.push({ type: 'delimiter', text: '==}' });
    } else if (match[6] !== undefined) {
      // Comment: {>>text<<}
      spans.push({ type: 'delimiter', text: '{>>' });
      spans.push({ type: 'comment', text: match[6] });
      spans.push({ type: 'delimiter', text: '<<}' });
    }

    lastIndex = matchStart + match[0].length;
  }

  // Emit any remaining text after the last match
  if (lastIndex < line.length) {
    const remaining = line.slice(lastIndex);
    emitPlainAndAnchors(remaining, footnoteMap, spans);
  }

  // If the line was empty or produced no spans, emit a single empty plain span
  if (spans.length === 0) {
    spans.push({ type: 'plain', text: '' });
  }

  return spans;
}

/**
 * Process a plain text segment, identifying `[^cn-N]` footnote refs as
 * anchor spans (preserving the caret for raw-file consistency).
 */
function emitPlainAndAnchors(
  text: string,
  footnoteMap: Map<string, ChangeNode>,
  spans: ContentSpan[],
): void {
  let lastIdx = 0;
  const re = new RegExp(FOOTNOTE_REF_RE.source, 'g');

  for (const match of text.matchAll(re)) {
    const matchStart = match.index!;
    const id = match[1];
    const node = footnoteMap.get(id);

    // Plain text before this ref
    if (matchStart > lastIdx) {
      spans.push({ type: 'plain', text: text.slice(lastIdx, matchStart) });
    }

    if (node) {
      // Known footnote: emit [^cn-N] anchor (preserving caret for raw-file consistency)
      spans.push({ type: 'anchor', text: `[^${node.id}]` });
    } else {
      // Unknown ref: keep as plain text
      spans.push({ type: 'plain', text: match[0] });
    }

    lastIdx = matchStart + match[0].length;
  }

  // Remaining text after last ref
  if (lastIdx < text.length) {
    spans.push({ type: 'plain', text: text.slice(lastIdx) });
  }
}

