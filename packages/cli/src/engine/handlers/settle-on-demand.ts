import {
  applyAcceptedChanges,
  applyRejectedChanges,
  ChangeStatus,
  CriticMarkupParser,
  defaultNormalizer,
} from '@changedown/core';
import { contentZoneText, findUniqueMatch } from '../file-ops.js';

/**
 * Settle-on-demand: if `oldText` matches inside an accepted/rejected CriticMarkup
 * construct (either via exact match inside the markup, or via the current-text
 * fallback), settle those constructs first so the subsequent proposal operates on
 * clean prose.
 *
 * Returns the file content to use (settled if settlement happened) and whether
 * settlement occurred. When settlement occurs, the caller must write the settled
 * content to disk before applying the proposal.
 *
 * Only accepted and rejected changes are settled — proposed changes are never
 * auto-settled.
 */
export function settleOnDemandIfNeeded(
  fileContent: string,
  oldText: string,
): { content: string; settled: boolean } {
  // Quick path: no CriticMarkup in file, no settlement needed.
  if (!oldText || !/\{\+\+|\{--|\{~~|\{==|\{>>/.test(fileContent)) {
    return { content: fileContent, settled: false };
  }

  // Parse the document to find accepted/rejected changes.
  const parser = new CriticMarkupParser();
  const doc = parser.parse(fileContent, { skipCodeBlocks: false });
  const changes = doc.getChanges();

  // Filter to only accepted/rejected changes (these are candidates for settlement).
  const settleableChanges = changes.filter(
    (c) => c.status === ChangeStatus.Accepted || c.status === ChangeStatus.Rejected,
  );

  if (settleableChanges.length === 0) {
    return { content: fileContent, settled: false };
  }

  // Try matching old_text in the content zone (without footnotes).
  let match: ReturnType<typeof findUniqueMatch> | undefined;
  try {
    match = findUniqueMatch(contentZoneText(fileContent), oldText, defaultNormalizer);
  } catch {
    // Match not found or ambiguous — let the caller handle the error
    return { content: fileContent, settled: false };
  }

  const matchStart = match.index;
  const matchEnd = match.index + match.length;

  // Check if the match range overlaps any accepted or rejected change range.
  // This catches both:
  // 1. Exact match landing inside CriticMarkup construct (e.g., `new` inside `{~~old~>new~~}`)
  // 2. Settled-text match (wasSettledMatch=true) expanding to cover markup constructs
  const overlapsSettleable = settleableChanges.some(
    (c) => c.range.start < matchEnd && c.range.end > matchStart,
  );

  if (!overlapsSettleable) {
    return { content: fileContent, settled: false };
  }

  // Settle accepted changes first, then rejected changes.
  // applyAcceptedChanges and applyRejectedChanges preserve footnote refs
  // inline adjacent to the settled text (the audit trail remains).
  const { currentContent: afterAccepted } = applyAcceptedChanges(fileContent);
  const { currentContent: afterRejected } = applyRejectedChanges(afterAccepted);

  return { content: afterRejected, settled: true };
}
