/**
 * Shared session-hash computation for all view builders.
 *
 * One parse, one pass, all three hash fields per raw line. Every view
 * builder calls this helper and picks its primary hash and line-numbering
 * space from the returned result.
 *
 * Hash fields are `string | undefined` when the raw line has no presence
 * in that projection (e.g., accepted-deletion lines have no decided
 * counterpart; footnote-definition lines have no current counterpart).
 */

import { computeDecidedView } from '../../decided-text.js';
import { computeCurrentView } from '../../operations/current-text.js';
import { computeLineHash } from '../../hashline.js';
import type { ChangeNode } from '../../model/types.js';
import type { DecidedViewResult } from '../../decided-text.js';
import type { CurrentViewResult } from '../../operations/current-text.js';

export interface SessionHashes {
  raw: string;       // always present
  committed?: string;   // absent for accepted-deletion lines and footnote defs
  currentView?: string; // absent for footnote-definition lines
}

export interface SessionHashesResult {
  byRawLine: Map<number, SessionHashes>;
  decidedResult: DecidedViewResult;    // full result from computeDecidedView
  currentResult: CurrentViewResult;    // full result from computeCurrentView
  decidedLineByRaw: Map<number, number>;
  currentLineByRaw: Map<number, number>;
  rawLineByDecided: Map<number, number>;
  rawLineByCurrent: Map<number, number>;
}

/**
 * Build per-raw-line session hashes. Reuses `computeDecidedView` and
 * `computeCurrentView` with pre-parsed changes to avoid re-parsing.
 */
export function buildSessionHashes(
  rawContent: string,
  changes: ChangeNode[],
): SessionHashesResult {
  const rawLines = rawContent.split('\n');
  const decidedResult = computeDecidedView(rawContent, changes);
  const currentResult = computeCurrentView(rawContent, changes);

  // Build committed hash lookup by raw line number
  const committedByRaw = new Map<number, string>();
  for (const cl of decidedResult.lines) {
    committedByRaw.set(cl.rawLineNum, cl.hash);
  }

  // Build currentView hash lookup by raw line number
  const currentViewByRaw = new Map<number, string>();
  for (const sl of currentResult.lines) {
    currentViewByRaw.set(sl.rawLineNum, sl.hash);
  }

  // Assemble SessionHashes per raw line
  const byRawLine = new Map<number, SessionHashes>();
  for (let i = 0; i < rawLines.length; i++) {
    const rawLineNum = i + 1; // 1-indexed
    const rawHash = computeLineHash(i, rawLines[i], rawLines);
    byRawLine.set(rawLineNum, {
      raw: rawHash,
      committed: committedByRaw.get(rawLineNum),
      currentView: currentViewByRaw.get(rawLineNum),
    });
  }

  // Build line-number cross-mappings
  const decidedLineByRaw = new Map<number, number>();
  const rawLineByDecided = new Map<number, number>();
  for (const cl of decidedResult.lines) {
    decidedLineByRaw.set(cl.rawLineNum, cl.decidedLineNum);
    rawLineByDecided.set(cl.decidedLineNum, cl.rawLineNum);
  }

  const currentLineByRaw = new Map<number, number>();
  const rawLineByCurrent = new Map<number, number>();
  for (const sl of currentResult.lines) {
    currentLineByRaw.set(sl.rawLineNum, sl.currentLineNum);
    rawLineByCurrent.set(sl.currentLineNum, sl.rawLineNum);
  }

  return {
    byRawLine,
    decidedResult,
    currentResult,
    decidedLineByRaw,
    currentLineByRaw,
    rawLineByDecided,
    rawLineByCurrent,
  };
}
