/**
 * Simple view builder — Current projection (accept-all) with EOL metadata.
 *
 * Displays clean text (CriticMarkup delimiters hidden) with per-footnote
 * annotations appended to the end of each line. Shares metadata zone
 * structure with the working view.
 */

import { parseForFormat } from '../../format-aware-parse.js';
import { type ChangeNode } from '../../model/types.js';
import { buildSessionHashes } from './session-hashes.js';
import { buildLineMetadataFromFootnotes } from './line-metadata.js';
import {
  buildDeliberationHeader,
  buildLineRefMap,
  computeContinuationLines,
  computePAFlags,
} from '../view-builder-utils.js';
import type { ThreeZoneDocument, ThreeZoneLine } from '../three-zone-types.js';
import type { BuiltinView } from '../../host/types.js';

export interface SimpleBuildOptions {
  filePath: string;
  trackingStatus: 'tracked' | 'untracked';
  protocolMode: string;
  defaultView: BuiltinView;
  viewPolicy: string;
}

export function buildSimpleDocument(
  rawContent: string,
  options: SimpleBuildOptions,
): ThreeZoneDocument {
  const changes = parseForFormat(rawContent, { skipCodeBlocks: false }).getChanges();
  const sessionHashesResult = buildSessionHashes(rawContent, changes);

  // Reuse the currentResult already computed inside buildSessionHashes
  const currentResult = sessionHashesResult.currentResult;

  const footnoteMap = new Map<string, ChangeNode>();
  for (const node of changes) footnoteMap.set(node.id, node);

  // Trim trailing blank lines from the current projection
  const currentLines = [...currentResult.lines];
  while (
    currentLines.length > 0 &&
    currentLines[currentLines.length - 1].text.trim() === ''
  ) {
    currentLines.pop();
  }

  // Build raw-line → refs map for metadata zone
  const rawLines = rawContent.split('\n');
  const lineRefMap = buildLineRefMap(rawLines);
  const continuations = computeContinuationLines(rawContent, changes);

  const lines: ThreeZoneLine[] = currentLines.map(sl => {
    // Use refs from the corresponding raw line for metadata zone
    const refIds = lineRefMap.get(sl.rawLineNum - 1);
    const metadata = buildLineMetadataFromFootnotes(refIds, footnoteMap);

    const flags = computePAFlags(refIds, footnoteMap);

    const sh = sessionHashesResult.byRawLine.get(sl.rawLineNum)!;

    return {
      margin: {
        lineNumber: sl.currentLineNum,
        hash: sh.currentView ?? sl.hash, // currentView hash
        flags,
      },
      content: [{ type: 'plain' as const, text: sl.text }],
      metadata,
      rawLineNumber: sl.rawLineNum,
      continuesChange: continuations.has(sl.rawLineNum - 1) || undefined,
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

  return { view: 'simple', header, lines };
}
