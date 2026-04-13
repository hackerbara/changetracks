import {
  initHashline,
  parseForFormat, buildSessionHashes,
  type CurrentViewResult, type DecidedViewResult,
} from '@changedown/core';
import type { SessionState } from './state.js';
import type { ChangeDownConfig } from './config.js';

/**
 * Recompute and record session hashes after a file write.
 * Clears the ID counter cache, updates hashes, preserves lastReadView.
 *
 * When the agent's lastReadView is 'decided' or 'simple', computes the
 * corresponding projected view and stores view-specific hashes (committed
 * or currentView) alongside the raw/current base hashes. Returns the computed
 * view result so callers can reuse it without double-computing.
 *
 * For the working view, also computes decided hashes so the view-aware
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
  const lastView = state.getLastReadView(filePath) ?? 'raw';

  const changes = parseForFormat(content).getChanges();
  const sessionHashesResult = buildSessionHashes(content, changes);

  const hashes: Array<{
    line: number; raw: string;
    committed?: string; currentView?: string; rawLineNum?: number;
  }> = [];

  for (const [rawLineNum, sh] of sessionHashesResult.byRawLine) {
    let lineNumInView: number | undefined;
    switch (lastView) {
      case 'working':
      case 'raw':
      case 'original':
        lineNumInView = rawLineNum;
        break;
      case 'simple':
        lineNumInView = sessionHashesResult.currentLineByRaw.get(rawLineNum);
        break;
      case 'decided':
        lineNumInView = sessionHashesResult.decidedLineByRaw.get(rawLineNum);
        break;
    }
    if (lineNumInView === undefined) continue;

    if (lastView === 'raw' || lastView === 'original') {
      // Raw/original views: only raw hash — no committed or currentView fields.
      hashes.push({ line: lineNumInView, raw: sh.raw, rawLineNum });
    } else {
      hashes.push({
        line: lineNumInView,
        raw: sh.raw,
        committed: sh.committed,
        currentView: sh.currentView,
        rawLineNum,
      });
    }
  }

  state.rerecordAfterWrite(filePath, content, hashes);

  // Return real view results (not stubs) so callers that iterate .lines get
  // actual line data (rawLineNum, hash, text, etc.). propose-change.ts:1264
  // iterates currentView.lines and decidedView.lines to build viewProjection.
  if (lastView === 'decided') {
    return { decidedView: sessionHashesResult.decidedResult };
  }
  if (lastView === 'simple' || lastView === 'working') {
    return { currentView: sessionHashesResult.currentResult };
  }
  return undefined;
}
