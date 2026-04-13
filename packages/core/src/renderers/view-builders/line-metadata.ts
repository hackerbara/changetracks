import { nodeStatus, type ChangeNode, changeTypeToShortCode } from '../../model/types.js';
import type { LineMetadata } from '../three-zone-types.js';

/**
 * Build LineMetadata[] from footnote IDs referenced on a line.
 * Shared by working.ts and simple.ts.
 */
export function buildLineMetadataFromFootnotes(
  refIds: Set<string> | undefined,
  footnoteMap: Map<string, ChangeNode>,
): LineMetadata[] {
  if (!refIds) return [];
  const metadata: LineMetadata[] = [];

  for (const id of refIds) {
    const node = footnoteMap.get(id);
    if (!node) continue;
    const status = nodeStatus(node);

    // reason: comment field or the first discussion entry
    const discussion = node.metadata?.discussion ?? [];
    const reason = node.metadata?.comment || discussion[0]?.text || undefined;

    // latestThreadTurn: only when 2+ discussion entries exist (first is already reason)
    const latestThreadTurn = discussion.length >= 2
      ? { author: discussion[discussion.length - 1].author, text: discussion[discussion.length - 1].text }
      : undefined;

    metadata.push({
      changeId: node.id,
      type: changeTypeToShortCode(node.type),
      status: status as LineMetadata['status'],
      author: node.metadata?.author ?? node.inlineMetadata?.author,
      reason,
      replyCount: (node.replyCount ?? 0) > 0 ? node.replyCount : undefined,
      latestThreadTurn,
    });
  }
  return metadata;
}
