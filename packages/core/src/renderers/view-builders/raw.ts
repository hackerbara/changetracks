import { buildSessionHashes } from './session-hashes.js';
import { parseForFormat } from '../../format-aware-parse.js';
import { buildDeliberationHeader, findFootnoteSectionRange, computeContinuationLines } from '../view-builder-utils.js';
import type { ThreeZoneDocument, ThreeZoneLine } from '../three-zone-types.js';
import type { BuiltinView } from '../../host/types.js';

export interface RawViewOptions {
  filePath: string;
  trackingStatus: 'tracked' | 'untracked';
  protocolMode: string;
  defaultView: BuiltinView;
  viewPolicy: string;
}

export function buildRawDocument(
  rawContent: string,
  options: RawViewOptions,
): ThreeZoneDocument {
  const changes = parseForFormat(rawContent).getChanges();
  const sessionHashesResult = buildSessionHashes(rawContent, changes);

  const rawLines = rawContent.split('\n');

  const continuations = computeContinuationLines(rawContent, changes);

  const lines: ThreeZoneLine[] = rawLines.map((text, i) => {
    const lineNum = i + 1;
    const sh = sessionHashesResult.byRawLine.get(lineNum)!;
    return {
      margin: {
        lineNumber: lineNum,
        hash: sh.raw,
        flags: [],
      },
      content: [{ type: 'plain' as const, text }],
      metadata: [],
      rawLineNumber: lineNum,
      continuesChange: continuations.has(i) || undefined,
      sessionHashes: {
        raw: sh.raw,
        committed: sh.committed,
        currentView: sh.currentView,
      },
    };
  });

  const header = buildDeliberationHeader({
    ...options,
    changes,
    lineRange: { start: 1, end: lines.length, total: lines.length },
  });

  const fnRange = findFootnoteSectionRange(changes);
  const footnoteSection = fnRange
    ? rawLines.slice(fnRange[0], fnRange[1] + 1).join('\n')
    : undefined;

  return { view: 'raw', header, lines, footnoteSection };
}
