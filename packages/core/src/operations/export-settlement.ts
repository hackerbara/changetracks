import { applyAcceptedChanges, applyRejectedChanges } from './current-text.js';

export interface ExportSettlementResult {
  text: string;
  settledIds: string[];
}

export function materializeResolvedChangesForExport(input: string): ExportSettlementResult {
  const accepted = applyAcceptedChanges(input);
  const rejected = applyRejectedChanges(accepted.currentContent);
  const settledIds = [...accepted.appliedIds, ...rejected.appliedIds];

  if (settledIds.length === 0) {
    return { text: input, settledIds: [] };
  }

  const settledIdSet = new Set(settledIds);
  let text = stripFootnoteBlocksForIds(rejected.currentContent, settledIdSet);
  const refPattern = new RegExp(`\\[\\^(?:${settledIds.map(escapeRegExp).join('|')})\\]`, 'g');
  text = text.replace(refPattern, '');

  return { text, settledIds };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripFootnoteBlocksForIds(text: string, ids: Set<string>): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = /^\[\^([^\]]+)\]:/.exec(line);
    if (match && ids.has(match[1]!)) {
      i++;
      while (i < lines.length && (/^\s{4}/.test(lines[i]!) || lines[i]!.trim() === '')) {
        if (lines[i]!.trim() === '' && (i + 1 >= lines.length || !/^\s{4}/.test(lines[i + 1]!))) break;
        i++;
      }
      i--;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}
