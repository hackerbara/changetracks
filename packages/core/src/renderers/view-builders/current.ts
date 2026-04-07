import { computeCurrentView } from '../../operations/current-text.js';
import { computeLineHash } from '../../hashline.js';
import { computeCurrentLineHash, currentLine } from '../../hashline-tracked.js';
import { parseForFormat } from '../../format-aware-parse.js';
import { buildDeliberationHeader } from '../view-builder-utils.js';
import type { ThreeZoneDocument, ThreeZoneLine, ViewMode } from '../three-zone-types.js';

export interface CurrentViewOptions {
  filePath: string;
  trackingStatus: 'tracked' | 'untracked';
  protocolMode: string;
  defaultView: ViewMode;
  viewPolicy: string;
}

export function buildCurrentDocument(
  rawContent: string,
  options: CurrentViewOptions,
): ThreeZoneDocument {
  const changes = parseForFormat(rawContent, { skipCodeBlocks: false }).getChanges();
  const currentResult = computeCurrentView(rawContent, changes);
  const rawLines = rawContent.split('\n');
  const allCurrent = rawLines.map(l => currentLine(l));

  // Trim trailing blank lines from footnote stripping
  while (
    currentResult.lines.length > 0 &&
    currentResult.lines[currentResult.lines.length - 1].text.trim() === ''
  ) {
    currentResult.lines.pop();
  }

  const lines: ThreeZoneLine[] = currentResult.lines.map(sl => ({
    margin: {
      lineNumber: sl.currentLineNum,
      hash: sl.hash,
      flags: [],
    },
    content: [{ type: 'plain' as const, text: sl.text }],
    metadata: [],
    rawLineNumber: sl.rawLineNum,
    sessionHashes: {
      raw: computeLineHash(sl.rawLineNum - 1, rawLines[sl.rawLineNum - 1] ?? '', rawLines),
      current: computeCurrentLineHash(sl.rawLineNum, rawLines[sl.rawLineNum - 1] ?? '', allCurrent),
      currentView: sl.hash,
      rawLineNum: sl.rawLineNum,
    },
  }));

  const header = buildDeliberationHeader({
    ...options,
    changes,
    lineRange: { start: 1, end: lines.length, total: lines.length },
  });

  return { view: 'settled', header, lines };
}
