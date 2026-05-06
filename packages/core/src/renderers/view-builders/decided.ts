/**
 * Decided view builder — Decided projection (accepted applied, proposals reverted).
 *
 * Clean prose with no metadata zone. A-only flags on lines touched by an
 * applied accepted change. Bottom status footer (rendered by plain-text.ts
 * from header.counts, not a separate IR field).
 */

import { parseForFormat } from '../../format-aware-parse.js';
import { buildSessionHashes } from './session-hashes.js';
import {
  buildDeliberationHeader,
  computeContinuationLines,
} from '../view-builder-utils.js';
import type { ThreeZoneDocument, ThreeZoneLine, LineFlag } from '../three-zone-types.js';
import type { BuiltinView } from '../../host/types.js';

export interface DecidedBuildOptions {
  filePath: string;
  trackingStatus: 'tracked' | 'untracked';
  protocolMode: string;
  defaultView: BuiltinView;
  viewPolicy: string;
}

export function buildDecidedDocument(
  rawContent: string,
  options: DecidedBuildOptions,
): ThreeZoneDocument {
  const changes = parseForFormat(rawContent, { skipCodeBlocks: false }).getChanges();
  const sessionHashesResult = buildSessionHashes(rawContent, changes);

  // Reuse the decidedResult already computed inside buildSessionHashes
  const decidedResult = sessionHashesResult.decidedResult;

  // Trim trailing blank lines from the decided projection
  const decidedLines = [...decidedResult.lines];
  while (
    decidedLines.length > 0 &&
    decidedLines[decidedLines.length - 1].text.trim() === ''
  ) {
    decidedLines.pop();
  }

  const continuations = computeContinuationLines(rawContent, changes);

  const lines: ThreeZoneLine[] = decidedLines.map(cl => {
    const sh = sessionHashesResult.byRawLine.get(cl.rawLineNum)!;
    const flags = cl.flag ? [cl.flag as LineFlag] : [];

    return {
      margin: {
        lineNumber: cl.decidedLineNum,
        hash: cl.hash,
        flags,
      },
      content: [{ type: 'plain' as const, text: cl.text }],
      metadata: [],
      rawLineNumber: cl.rawLineNum,
      continuesChange: continuations.has(cl.rawLineNum - 1) || undefined,
      sessionHashes: {
        raw: sh.raw,
        committed: sh.committed,
        currentView: sh.currentView,
      },
    };
  });

  const header = buildDeliberationHeader({
    filePath: options.filePath,
    trackingStatus: options.trackingStatus,
    protocolMode: options.protocolMode,
    defaultView: options.defaultView,
    viewPolicy: options.viewPolicy,
    changes,
    lineRange: { start: 1, end: lines.length, total: lines.length },
  });

  return { view: 'decided', header, lines };
}
