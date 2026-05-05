/**
 * Inverse-of-parser: construct a typed L3Document from ChangeNode[].
 *
 * After this module, core has full parse↔emit symmetry:
 *   parseL3(serializeL3(changeNodesToL3Document(body, changes)))
 *   produces an L3Document whose getChanges() is equivalent to the input
 *   ChangeNode[] (modulo derived range/anchored fields).
 *
 * See docs/superpowers/specs/2026-04-27-core-changenode-to-l3-document.md §3.
 */

import type { L3Document } from '../model/document.js';
import type { ChangeNode } from '../model/types.js';
import type { Footnote, FootnoteLine, FootnoteHeader, EditOp } from '../model/footnote.js';
import type { Approval, Revision, DiscussionComment, Resolution } from '../model/types.js';
import { changeTypeToShortCode, nodeStatus } from '../model/types.js';
import { formatL3EditOpLine } from './footnote-generator.js';

/** Ensure a handle has exactly one leading '@' for emission into footnote text. */
function normalizeAuthor(author: string): string {
  return author.startsWith('@') ? author : '@' + author;
}

/**
 * Construct an L3Document from a clean body string and an array of ChangeNodes.
 *
 * The returned document is suitable for passing to serializeL3() to produce
 * L3 text, and then to convertL3ToL2() for L2 wire output.
 *
 * sourceRange is set to { startLine: -1, endLine: -1 } as the
 * constructed-footnote sentinel (these footnotes have no source location).
 */
export function changeNodesToL3Document(
  body: string,
  changes: readonly ChangeNode[],
): L3Document {
  const footnotes = changes.map(buildFootnoteFromChange);
  return { format: 'L3', body, footnotes };
}

// ─── Internal: per-change builder ──────────────────────────────────────────

function buildFootnoteFromChange(change: ChangeNode): Footnote {
  const header = buildHeader(change);
  const editOp = buildEditOp(change);
  const bodyLines = buildBodyLines(change, editOp);

  // Derived projections must be populated here, not just left for parseFootnoteBlock
  // to re-derive from bodyLines: the round-trip property depends on the constructed
  // Footnote being structurally equivalent to a parsed one (the test compares both),
  // so projections need to land on the constructed object directly.
  //
  // metadata.context is intentionally not read — FootnoteNativeParser does not copy
  // parsed Footnote.context into ChangeNode.metadata.context, so it never reaches
  // this constructor. The drop happens upstream, not here.
  const meta = change.metadata;
  const reason = meta?.comment ?? undefined;
  const discussion: readonly DiscussionComment[] = meta?.discussion ?? [];
  const approvals: readonly Approval[] = meta?.approvals ?? [];
  const rejections: readonly Approval[] = meta?.rejections ?? [];
  const requestChanges: readonly Approval[] = meta?.requestChanges ?? [];
  const revisions: readonly Revision[] = meta?.revisions ?? [];
  const resolution: Resolution | null = meta?.resolution ?? null;

  // Build imageMetadata / equationMetadata projections.
  const imageMetadata = meta?.imageMetadata
    ? Object.freeze({ ...meta.imageMetadata })
    : undefined;
  const equationMetadata = meta?.equationMetadata
    ? Object.freeze({ ...meta.equationMetadata })
    : undefined;

  return {
    id: change.id,
    header,
    editOp,
    bodyLines,
    reason,
    discussion,
    approvals,
    rejections,
    requestChanges,
    revisions,
    resolution,
    supersedes: change.supersedes,
    supersededBy: change.supersededBy ?? [],
    imageMetadata,
    equationMetadata,
    // Sentinel: constructed footnotes have no source location.
    sourceRange: { startLine: -1, endLine: -1 },
  };
}

// ─── Header ────────────────────────────────────────────────────────────────

function buildHeader(change: ChangeNode): FootnoteHeader {
  const meta = change.metadata;

  const author = normalizeAuthor(meta?.author ?? 'unknown');

  const date = meta?.date ?? '';
  const type = changeTypeToShortCode(change.type);
  const status = narrowStatus(nodeStatus(change));

  return { author, date, type, status };
}

/**
 * Narrow nodeStatus()'s `string` return to the FootnoteHeader.status union.
 * nodeStatus lowercases a ChangeStatus enum value, so today the result is
 * always one of these three. The runtime check fails loudly if a future
 * ChangeStatus variant is added without updating this constructor.
 */
function narrowStatus(s: string): 'proposed' | 'accepted' | 'rejected' {
  if (s === 'proposed' || s === 'accepted' || s === 'rejected') return s;
  throw new Error(`changeNodesToL3Document: unsupported ChangeStatus "${s}"`);
}

// ─── EditOp ────────────────────────────────────────────────────────────────

/**
 * Build the EditOp typed record when the change has a line-hash anchor with
 * a non-empty embedding. Returns null otherwise — guards against an undefined
 * embedding emitting the literal text "undefined" into the L3 footnote.
 */
function buildEditOp(change: ChangeNode): EditOp | null {
  const anchor = change.anchor;
  if (!anchor || anchor.kind !== 'line-hash') return null;
  if (!anchor.embedding) return null; // guard against 'undefined' literal bug

  const lineNumber = anchor.line;
  const hash = anchor.hash;
  const op = anchor.embedding;

  return { resolutionPath: 'hash', lineNumber, hash, op };
}

// ─── bodyLines emission ─────────────────────────────────────────────────────

function buildBodyLines(change: ChangeNode, editOp: EditOp | null): readonly FootnoteLine[] {
  const lines: FootnoteLine[] = [];
  const meta = change.metadata;

  // 1. edit-op (only when anchor is line-hash AND embedding is non-empty)
  if (editOp) {
    const raw = formatL3EditOpLine(editOp.lineNumber, editOp.hash, editOp.op);
    lines.push({ kind: 'edit-op', editOp, raw });
  }

  // 2. reason — when metadata.comment is non-empty
  if (meta?.comment) {
    lines.push(emitReasonLine(meta.comment));
  }

  // 3. revisions block — header + one line per revision
  if (meta?.revisions && meta.revisions.length > 0) {
    lines.push({ kind: 'revisions-header', raw: '    revisions:' });
    for (const rev of meta.revisions) {
      lines.push(emitRevisionLine(rev));
    }
  }

  // 4. request-changes — one per entry
  if (meta?.requestChanges) {
    for (const rc of meta.requestChanges) {
      lines.push(emitApprovalLikeLine('request-changes', rc));
    }
  }

  // 5. approvals — one per entry
  if (meta?.approvals) {
    for (const ap of meta.approvals) {
      lines.push(emitApprovalLikeLine('approved', ap));
    }
  }

  // 6. rejections — one per entry
  if (meta?.rejections) {
    for (const rj of meta.rejections) {
      lines.push(emitApprovalLikeLine('rejected', rj));
    }
  }

  // 7. discussion — one per entry
  if (meta?.discussion) {
    for (const dc of meta.discussion) {
      lines.push(emitDiscussionLine(dc));
    }
  }

  // 8. resolution
  if (meta?.resolution) {
    lines.push(emitResolutionLine(meta.resolution));
  }

  // 9. supersedes (singular)
  if (change.supersedes) {
    const raw = `    supersedes: ${change.supersedes}`;
    lines.push({ kind: 'supersedes', target: change.supersedes, raw });
  }

  // 10. superseded-by (array)
  if (change.supersededBy) {
    for (const target of change.supersededBy) {
      const raw = `    superseded-by: ${target}`;
      lines.push({ kind: 'superseded-by', target, raw });
    }
  }

  // 11. image-meta
  if (meta?.imageMetadata) {
    for (const [key, value] of Object.entries(meta.imageMetadata)) {
      const raw = `    ${key}: ${value}`;
      lines.push({ kind: 'image-meta', key, value, raw });
    }
  }

  // 12. equation-meta
  if (meta?.equationMetadata) {
    for (const [key, value] of Object.entries(meta.equationMetadata)) {
      const raw = `    ${key}: ${value}`;
      lines.push({ kind: 'equation-meta', key, value, raw });
    }
  }

  return lines;
}

// ─── Per-variant line emitters ──────────────────────────────────────────────

function emitReasonLine(comment: string): FootnoteLine {
  const raw = `    reason: ${comment}`;
  return { kind: 'reason', text: comment, raw };
}

/**
 * Emit an approval-like line: approved:, rejected:, or request-changes:.
 *
 * Wire format (verified against APPROVED_RE / REJECTED_RE / REQUEST_CHANGES_RE):
 *   `    keyword: @author date[ "reason"]`
 *
 * Uses timestamp.raw when available (preserves full ISO timestamp); falls back
 * to the deprecated date field.
 */
function emitApprovalLikeLine(
  keyword: 'approved' | 'rejected' | 'request-changes',
  action: Approval,
): FootnoteLine {
  // Use timestamp.raw to preserve the full ISO timestamp (e.g. 2026-04-27T12:00:00Z).
  // Fall back to the deprecated date field for older records.
  const dateStr = action.timestamp?.raw ?? action.date;
  const authorStr = normalizeAuthor(action.author);
  const reasonPart = action.reason ? ` "${action.reason}"` : '';
  const raw = `    ${keyword}: ${authorStr} ${dateStr}${reasonPart}`;

  if (keyword === 'approved') {
    return { kind: 'approval', action, raw };
  } else if (keyword === 'rejected') {
    return { kind: 'rejection', action, raw };
  } else {
    return { kind: 'request-changes', action, raw };
  }
}

/**
 * Emit a revision line.
 *
 * Wire format (verified against REVISION_RE):
 *   `    r\d+ @?author date: "text"`  with 4-space indent
 *
 * REVISION_RE = /^ {4,}(r\d+)\s+(@?\S+)\s+(\S+):\s+"([^"]*)"$/
 */
function emitRevisionLine(rev: Revision): FootnoteLine {
  const dateStr = rev.timestamp?.raw ?? rev.date;
  // Author in revision lines may or may not have @; emit with one leading @ for symmetry.
  const authorStr = normalizeAuthor(rev.author);
  const raw = `    ${rev.label} ${authorStr} ${dateStr}: "${rev.text}"`;
  return { kind: 'revision', revision: rev, raw };
}

/**
 * Emit a discussion reply line.
 *
 * Wire format (verified against real fixtures and FOOTNOTE_THREAD_REPLY):
 *   `    @author date[ [label]]: text`
 *
 * The continuation guard in footnote-block-parser.ts:109 requires 4-space
 * indent (`!body.startsWith('    ')`). The parser then uses FOOTNOTE_THREAD_REPLY
 * for initial detection and the replyMatch regex:
 *   /^\s+@(\S+)\s+(\S+)(?:\s+\[([^\]]+)\])?:\s*(.*)$/
 *
 * The parser always sets depth: 0 (hardcoded in the body).
 */
function emitDiscussionLine(dc: DiscussionComment): FootnoteLine {
  const dateStr = dc.timestamp?.raw ?? dc.date;
  const authorStr = normalizeAuthor(dc.author);
  const labelPart = dc.label ? ` [${dc.label}]` : '';
  const raw = `    ${authorStr} ${dateStr}${labelPart}: ${dc.text}`;
  return { kind: 'discussion', reply: dc, raw };
}

/**
 * Emit a resolution line.
 *
 * Wire format (verified against RESOLVED_RE and OPEN_RE):
 *   resolved: `    resolved: @author date[ "reason"]`
 *   open:     `    open[ -- reason]`
 */
function emitResolutionLine(res: Resolution): FootnoteLine {
  if (res.type === 'resolved') {
    const dateStr = res.timestamp?.raw ?? res.date;
    const authorStr = normalizeAuthor(res.author);
    const reasonPart = res.reason ? ` "${res.reason}"` : '';
    const raw = `    resolved: ${authorStr} ${dateStr}${reasonPart}`;
    return { kind: 'resolution', resolution: res, raw };
  } else {
    // type === 'open'
    const raw = res.reason ? `    open -- ${res.reason}` : `    open`;
    return { kind: 'resolution', resolution: res, raw };
  }
}
