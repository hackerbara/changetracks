/**
 * Committed-view computation.
 *
 * Per-line: processes a single raw line of CriticMarkup and returns the "committed" text:
 * - Accepted changes are applied (insertions kept, deletions removed, subs show new)
 * - Pending/unknown changes are reverted (insertions removed, deletions kept, subs show old)
 * - Rejected changes are reverted (same as pending for content, but don't set P/A flag)
 * - Highlights always show content, comments always removed
 * - Footnote refs always removed
 *
 * Document-level: parses footnotes, computes decided text for whole file,
 * hashes each committed line, builds committed<->raw line mapping.
 */

import { findFootnoteBlockStart } from './footnote-utils.js';
import { parseForFormat } from './format-aware-parse.js';
import { nodeStatus, type ChangeNode } from './model/types.js';
import { computeLineHash } from './hashline.js';
import {
  multiLineSubstitution,
  multiLineInsertion,
  multiLineDeletion,
  multiLineHighlight,
  multiLineComment,
  hasCriticMarkup,
} from './critic-regex.js';
import {
  footnoteRefGlobal,
  FOOTNOTE_DEF_START_QUICK,
} from './footnote-patterns.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FootnoteStatus {
  status: 'proposed' | 'accepted' | 'rejected';
}

export interface DecidedLineResult {
  text: string;
  flag: '' | 'P' | 'A';
  changeIds: string[];
}

// CriticMarkup regex patterns imported from critic-regex.ts (multi-line family).
// Footnote ref patterns imported from footnote-patterns.ts.
// Order matters: substitutions first (contain ~> which would confuse simpler patterns).

// ─── Core function ───────────────────────────────────────────────────────────

/**
 * Resolve the effective status for a change ID against the footnotes map.
 * Unknown IDs default to 'proposed' (safe default).
 */
function resolveStatus(
  changeId: string | undefined,
  footnotes: Map<string, FootnoteStatus>,
): 'proposed' | 'accepted' | 'rejected' {
  if (!changeId) return 'proposed'; // bare markup = proposed
  const info = footnotes.get(changeId);
  if (!info) return 'proposed'; // unknown ID = proposed
  return info.status;
}

/**
 * Apply one pass of the six CriticMarkup replacement steps.
 *
 * Extracted from computeDecidedLine to support bounded recursion: the caller
 * may invoke this multiple times when residual markup survives the first pass
 * (e.g., pre-existing nested CriticMarkup in documents written before the
 * assertResolved chokepoints landed).
 *
 * The trackStatus callback is owned by the outer computeDecidedLine frame and
 * accumulates change IDs and flag state across all passes. Nested constructs
 * carry distinct cn-N IDs, so repeated calls do not produce duplicate entries.
 */
function applyDecidedReplacementsOnce(
  text: string,
  footnotes: Map<string, FootnoteStatus>,
  trackStatus: (status: 'proposed' | 'accepted' | 'rejected', changeId: string | undefined) => void,
): string {
  let result = text;

  // 1. Substitutions: {~~old~>new~~}[^cn-N]?
  result = result.replace(multiLineSubstitution(), (_match, old: string, newText: string, _refFull: string | undefined, refId: string | undefined) => {
    const status = resolveStatus(refId, footnotes);
    trackStatus(status, refId);
    // accepted → new text; proposed/rejected → old text
    return status === 'accepted' ? newText : old;
  });

  // 2. Insertions: {++text++}[^cn-N]?
  result = result.replace(multiLineInsertion(), (_match, content: string, _refFull: string | undefined, refId: string | undefined) => {
    const status = resolveStatus(refId, footnotes);
    trackStatus(status, refId);
    // accepted → keep text; proposed/rejected → remove
    return status === 'accepted' ? content : '';
  });

  // 3. Deletions: {--text--}[^cn-N]?
  result = result.replace(multiLineDeletion(), (_match, content: string, _refFull: string | undefined, refId: string | undefined) => {
    const status = resolveStatus(refId, footnotes);
    trackStatus(status, refId);
    // accepted → remove text; proposed/rejected → keep text (revert deletion)
    return status === 'accepted' ? '' : content;
  });

  // 4. Highlights: {==text==}[^cn-N]? — always show content, no flag, no changeId
  result = result.replace(multiLineHighlight(), (_match, content: string) => {
    return content;
  });

  // 5. Comments: {>>text<<} — always removed
  result = result.replace(multiLineComment(), '');

  // 6. Standalone footnote refs: [^cn-N] — always removed
  result = result.replace(footnoteRefGlobal(), '');

  return result;
}

/** Maximum number of replacement passes in computeDecidedLine. */
const MAX_DECIDED_DEPTH = 3;

/**
 * Compute the decided view of a single line.
 *
 * Processes CriticMarkup in this order:
 * 1. Substitutions (contain ~> separator)
 * 2. Insertions
 * 3. Deletions
 * 4. Highlights
 * 5. Comments
 * 6. Standalone footnote refs
 *
 * Bounded recursion (depth ≤ MAX_DECIDED_DEPTH): if a replacement produces
 * residual CriticMarkup (possible in pre-existing files with nested constructs),
 * up to MAX_DECIDED_DEPTH passes are applied. Healthy documents with no markup
 * skip the loop entirely (depth=0). Documents with one level of markup resolve
 * in one pass. Beyond MAX_DECIDED_DEPTH, residual markup is left as-is for
 * `cd repair` (Tranche 8) to address.
 */
export function computeDecidedLine(
  line: string,
  footnotes: Map<string, FootnoteStatus>,
): DecidedLineResult {
  let result = line;
  const changeIds: string[] = [];
  let hasProposed = false;
  let hasAccepted = false;

  // Track status for flag computation (rejected changes don't set flags).
  // This closure is passed into applyDecidedReplacementsOnce across all passes;
  // nested constructs carry distinct cn-N IDs so no duplicates arise.
  function trackStatus(status: 'proposed' | 'accepted' | 'rejected', changeId: string | undefined): void {
    if (changeId) changeIds.push(changeId);
    if (status === 'proposed') hasProposed = true;
    else if (status === 'accepted') hasAccepted = true;
    // rejected: neither flag
  }

  let depth = 0;
  while (depth < MAX_DECIDED_DEPTH && hasCriticMarkup(result)) {
    result = applyDecidedReplacementsOnce(result, footnotes, trackStatus);
    depth++;
  }

  // Compute flag: P takes priority over A
  let flag: '' | 'P' | 'A' = '';
  if (hasProposed) flag = 'P';
  else if (hasAccepted) flag = 'A';

  return { text: result, flag, changeIds };
}

// ─── Document-level types ────────────────────────────────────────────────────

export interface DecidedLine {
  decidedLineNum: number;  // 1-indexed, sequential (no gaps)
  rawLineNum: number;        // 1-indexed, raw file line number
  text: string;              // decided text (no CriticMarkup)
  hash: string;              // decided hash (2 hex chars)
  flag: '' | 'P' | 'A';     // status flag
  changeIds: string[];       // cn-N IDs on this line
}

export interface DecidedViewResult {
  lines: DecidedLine[];
  summary: { proposed: number; accepted: number; rejected: number; clean: number };
  decidedToRaw: Map<number, number>;  // committed line num → raw line num
  rawToDecided: Map<number, number>;  // raw line num → committed line num
  changes: ChangeNode[];
}

export interface FormatOptions {
  filePath: string;
  trackingStatus: string;
}

// ─── Footnote line detection ─────────────────────────────────────────────────

// FOOTNOTE_DEF_START_QUICK imported from footnote-patterns.ts

/**
 * Build a set of 0-based line indices that belong to footnote definitions.
 * Includes the header line and all indented continuation lines.
 */
function findFootnoteLineIndices(lines: string[]): Set<number> {
  const indices = new Set<number>();

  const blockStart = findFootnoteBlockStart(lines);
  for (let i = blockStart; i < lines.length; i++) {
    if (!FOOTNOTE_DEF_START_QUICK.test(lines[i])) continue;

    // Mark the header line
    indices.add(i);

    // Scan indented continuation lines
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      // Blank line: only include if followed by more indented content (same footnote)
      if (line.trim() === '') {
        let k = j + 1;
        while (k < lines.length && lines[k].trim() === '') k++;
        if (k < lines.length && /^\s+\S/.test(lines[k])) {
          indices.add(j);
          j++;
          continue;
        }
        break;
      }
      // Indented line = continuation
      if (/^\s+\S/.test(line)) {
        indices.add(j);
        j++;
        continue;
      }
      break;
    }
  }

  return indices;
}

// ─── CriticMarkup detection ─────────────────────────────────────────────────

// hasCriticMarkup imported from critic-regex.ts

// ─── Document-level computation ──────────────────────────────────────────────

/**
 * Compute the decided view for an entire file.
 *
 * 1. Parses footnotes to get statuses
 * 2. Identifies footnote definition lines (excluded from output)
 * 3. Processes each non-footnote line through computeDecidedLine
 * 4. Skips lines that were entirely pending insertions (become empty)
 * 5. Assigns sequential committed line numbers and computes hashes
 * 6. Builds bidirectional line mapping
 */
export function computeDecidedView(rawText: string, preParsed?: ChangeNode[]): DecidedViewResult {
  const rawLines = rawText.split('\n');

  // 1. Parse via unified parser → ChangeNode[]
  const changes = preParsed ?? parseForFormat(rawText).getChanges();

  // 2. Build Map<id, FootnoteStatus> from ChangeNode metadata
  const statusMap = new Map<string, FootnoteStatus>();
  for (const node of changes) {
    const rawStatus = nodeStatus(node);
    statusMap.set(node.id, {
      status: (rawStatus === 'accepted' || rawStatus === 'rejected') ? rawStatus : 'proposed',
    });
  }

  // 3. Find footnote definition line indices (excluded from decided view)
  const footnoteLineIndices = findFootnoteLineIndices(rawLines);

  // 4. Process each non-footnote raw line (two-pass: collect texts, then hash)
  //    Pass 1: collect committed line texts+metadata without hashing
  const preLines: Array<{
    decidedLineNum: number;
    rawLineNum: number;
    text: string;
    flag: '' | 'P' | 'A';
    changeIds: string[];
  }> = [];
  let decidedLineNum = 0;
  let cleanCount = 0;

  for (let rawIdx = 0; rawIdx < rawLines.length; rawIdx++) {
    // Skip footnote definition lines
    if (footnoteLineIndices.has(rawIdx)) continue;

    const rawLine = rawLines[rawIdx];
    const lineResult = computeDecidedLine(rawLine, statusMap);

    // Skip lines that were entirely pending insertions (raw had CriticMarkup,
    // committed is empty/whitespace, and the raw line was not already blank)
    const rawIsBlank = rawLine.trim() === '';
    const committedIsBlank = lineResult.text.trim() === '';
    if (!rawIsBlank && committedIsBlank && hasCriticMarkup(rawLine)) {
      continue;
    }

    // Assign sequential committed line number (1-indexed)
    decidedLineNum++;
    const rawLineNum = rawIdx + 1; // 1-indexed

    // Track clean vs flagged
    if (lineResult.flag === '') {
      cleanCount++;
    }

    preLines.push({
      decidedLineNum,
      rawLineNum,
      text: lineResult.text,
      flag: lineResult.flag,
      changeIds: lineResult.changeIds,
    });
  }

  //    Pass 2: extract all decided texts, then hash each with full context
  const allCommittedTexts = preLines.map(l => l.text);
  const decidedLines: DecidedLine[] = [];
  const decidedToRaw = new Map<number, number>();
  const rawToDecided = new Map<number, number>();

  for (const pre of preLines) {
    const hash = computeLineHash(pre.decidedLineNum - 1, pre.text, allCommittedTexts);

    decidedLines.push({
      decidedLineNum: pre.decidedLineNum,
      rawLineNum: pre.rawLineNum,
      text: pre.text,
      hash,
      flag: pre.flag,
      changeIds: pre.changeIds,
    });

    // Build bidirectional mapping
    decidedToRaw.set(pre.decidedLineNum, pre.rawLineNum);
    rawToDecided.set(pre.rawLineNum, pre.decidedLineNum);
  }

  // 5. Build summary counts from changes
  const summary = { proposed: 0, accepted: 0, rejected: 0, clean: cleanCount };
  for (const node of changes) {
    const s = nodeStatus(node);
    if (s === 'proposed') summary.proposed++;
    else if (s === 'accepted') summary.accepted++;
    else if (s === 'rejected') summary.rejected++;
  }

  return { lines: decidedLines, summary, decidedToRaw, rawToDecided, changes };
}

// ─── Format output ──────────────────────────────────────────────────────────

/**
 * Format a decided view as text output.
 *
 * Produces a header with file path, tracking status, and change summary,
 * followed by lines formatted as: `N:HHF|content`
 * where N = line number, HH = hash, F = flag (P, A, or space).
 */
export function formatDecidedOutput(
  view: DecidedViewResult,
  options: FormatOptions,
): string {
  const headerLines: string[] = [];

  // Line 1: file path
  headerLines.push(`## file: ${options.filePath}`);

  // Line 2: view info + tracking + change summary
  const summaryParts: string[] = [];
  if (view.summary.proposed > 0) summaryParts.push(`${view.summary.proposed}P`);
  if (view.summary.accepted > 0) summaryParts.push(`${view.summary.accepted}A`);
  if (view.summary.rejected > 0) summaryParts.push(`${view.summary.rejected}R`);
  const changeSummary = summaryParts.length > 0 ? summaryParts.join(' ') : 'clean';

  headerLines.push(
    `## view: decided | tracking: ${options.trackingStatus} | changes: ${changeSummary}`,
  );

  // Line 3: line range
  const totalLines = view.lines.length;
  if (totalLines > 0) {
    headerLines.push(`## lines: 1-${totalLines} of ${totalLines}`);
  } else {
    headerLines.push('## lines: (empty)');
  }

  // Determine padding width for line numbers
  const maxLineNum = totalLines > 0 ? view.lines[view.lines.length - 1].decidedLineNum : 1;
  const padWidth = Math.max(String(maxLineNum).length, 2);

  // Format content lines
  const contentLines = view.lines.map(line => {
    const num = String(line.decidedLineNum).padStart(padWidth, ' ');
    const flag = line.flag || ' ';
    return `${num}:${line.hash}${flag}|${line.text}`;
  });

  return [...headerLines, '', ...contentLines].join('\n');
}
