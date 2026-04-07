import {
  initHashline, computeLineHash, computeCurrentLineHash, currentLine,
  computeCurrentView, computeDecidedView,
  type CurrentViewResult, type DecidedViewResult,
} from '@changedown/core';
import type { SessionState } from './state.js';
import type { ChangeDownConfig } from './config.js';

/**
 * Recompute and record session hashes after a file write.
 * Clears the ID counter cache, updates hashes, preserves lastReadView.
 *
 * When the agent's lastReadView is 'settled' or 'changes', computes the
 * corresponding projected view and stores view-specific hashes (currentView
 * or committed) alongside the raw/current base hashes. Returns the computed
 * view result so callers can reuse it without double-computing.
 *
 * For the review view, also computes decided hashes so the view-aware
 * resolution pipeline can match stale decided hashes from the agent's
 * original read across batch boundaries.
 *
 * Call this after EVERY fs.writeFile() in any tool handler.
 */
export async function rerecordState(
  state: SessionState | undefined,
  filePath: string,
  content: string,
  config: ChangeDownConfig
): Promise<{ currentView?: CurrentViewResult; decidedView?: DecidedViewResult } | undefined> {
  if (!state) return undefined;

  if (!config.hashline.enabled) {
    state.resetFile(filePath);
    return undefined;
  }

  await initHashline();
  const lines = content.split('\n');
  const allCurrent = lines.map(l => currentLine(l));
  const lastView = state.getLastReadView(filePath);

  let hashes: Array<{
    line: number; raw: string; current: string;
    committed?: string; currentView?: string; rawLineNum?: number;
  }>;

  let sv: CurrentViewResult | undefined;
  let cv: DecidedViewResult | undefined;

  if (lastView === 'settled') {
    sv = computeCurrentView(content);
    hashes = sv.lines.map(sl => ({
      line: sl.currentLineNum,
      raw: computeLineHash(sl.rawLineNum - 1, lines[sl.rawLineNum - 1], lines),
      current: computeCurrentLineHash(sl.rawLineNum - 1, lines[sl.rawLineNum - 1], allCurrent),
      currentView: sl.hash,
      rawLineNum: sl.rawLineNum,
    }));
  } else if (lastView === 'changes') {
    cv = computeDecidedView(content);
    hashes = cv.lines.map(cl => ({
      line: cl.decidedLineNum,
      raw: computeLineHash(cl.rawLineNum - 1, lines[cl.rawLineNum - 1], lines),
      current: computeCurrentLineHash(cl.rawLineNum - 1, lines[cl.rawLineNum - 1], allCurrent),
      committed: cl.hash,
      rawLineNum: cl.rawLineNum,
    }));
  } else if (lastView === 'review') {
    // Review view: raw line numbers + committed hashes for cross-batch stability.
    cv = computeDecidedView(content);
    const rawToDecidedHash = new Map<number, string>();
    for (const cl of cv.lines) {
      rawToDecidedHash.set(cl.rawLineNum, cl.hash);
    }
    hashes = lines.map((line, i) => ({
      line: i + 1,
      raw: computeLineHash(i, line, lines),
      current: computeCurrentLineHash(i, line, allCurrent),
      committed: rawToDecidedHash.get(i + 1),
    }));
  } else {
    // raw: line numbers are raw (identity mapping)
    hashes = lines.map((line, i) => ({
      line: i + 1,
      raw: computeLineHash(i, line, lines),
      current: computeCurrentLineHash(i, line, allCurrent),
    }));
  }

  state.rerecordAfterWrite(filePath, content, hashes);

  if (sv) return { currentView: sv };
  if (cv) return { decidedView: cv };
  return undefined;
}
