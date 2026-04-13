/**
 * Decided view builder — Decided projection (accepted applied, proposals reverted).
 *
 * Clean prose with no metadata zone. A-only flags on lines touched by an
 * applied accepted change. Bottom status footer (rendered by plain-text.ts
 * from header.counts, not a separate IR field).
 */

import { parseForFormat } from '../../format-aware-parse.js';
import { nodeStatus, type ChangeNode } from '../../model/types.js';
import { buildSessionHashes } from './session-hashes.js';
import {
  buildDeliberationHeader,
  buildLineRefMap,
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

  const footnoteMap = new Map<string, ChangeNode>();
  for (const node of changes) footnoteMap.set(node.id, node);

  // Trim trailing blank lines from the decided projection
  const decidedLines = [...decidedResult.lines];
  while (
    decidedLines.length > 0 &&
    decidedLines[decidedLines.length - 1].text.trim() === ''
  ) {
    decidedLines.pop();
  }

  const rawLines = rawContent.split('\n');
  const lineRefMap = buildLineRefMap(rawLines);
  const continuations = computeContinuationLines(rawContent, changes);

  const lines: ThreeZoneLine[] = decidedLines.map(cl => {
    const refIds = lineRefMap.get(cl.rawLineNum - 1);
    const flags = computeAFlagOnly(refIds, footnoteMap);

    const sh = sessionHashesResult.byRawLine.get(cl.rawLineNum)!;

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

function computeAFlagOnly(
  refIds: Set<string> | undefined,
  footnoteMap: Map<string, ChangeNode>,
): LineFlag[] {
  if (!refIds) return [];
  for (const id of refIds) {
    const node = footnoteMap.get(id);
    if (!node) continue;
    const status = nodeStatus(node);
    if (status === 'accepted') return ['A'];
  }
  return [];
}
