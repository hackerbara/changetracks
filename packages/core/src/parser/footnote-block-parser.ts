/**
 * Shared footnote block parser.
 *
 * Walks a contiguous run of footnote definition lines and emits typed
 * Footnote[] with structured bodyLines + derived projections. Called by
 * both the L2 CriticMarkupParser and the L3 FootnoteNativeParser so both
 * formats produce the same typed Footnote shape.
 *
 * See docs/superpowers/specs/2026-04-07-view-and-format-cleanup-design.md
 * §"Typed document model" and "Phase 2: Typed document model".
 */

import type { Footnote, FootnoteLine, FootnoteHeader, EditOp } from '../model/footnote.js';
import type { DiscussionComment, Resolution, Approval, Revision } from '../model/types.js';
import { parseTimestamp } from '../timestamp.js';
import { FOOTNOTE_DEF_START, FOOTNOTE_L3_EDIT_OP, FOOTNOTE_THREAD_REPLY } from '../footnote-patterns.js';
import { parseFootnoteHeader } from '../footnote-utils.js';
import { parseContextualEditOp } from './contextual-edit-op.js';

// Approval/rejection metadata line patterns (4-space indent).
const APPROVED_RE = /^ {4}approved:\s+(\S+)\s+(\S+)(?:\s+"([^"]*)")?/;
const REJECTED_RE = /^ {4}rejected:\s+(\S+)\s+(\S+)(?:\s+"([^"]*)")?/;
const REQUEST_CHANGES_RE = /^ {4}request-changes:\s+(\S+)\s+(\S+)(?:\s+"([^"]*)")?/;
const REVISION_RE = /^ {4,}(r\d+)\s+(@?\S+)\s+(\S+):\s+"([^"]*)"$/;

/** Build an Approval record from a regex match (shared by approved/rejected branches). */
function parseApprovalLine(match: RegExpMatchArray): Approval {
  return {
    author: match[1],
    date: match[2],
    timestamp: parseTimestamp(match[2]),
    reason: match[3] || undefined,
  };
}

const REASON_RE   = /^ {4}reason:\s+(.*)$/;
const CONTEXT_RE  = /^ {4}context:\s+(.*)$/;
const RESOLVED_RE = /^ {4}resolved:\s+(\S+)\s+(\S+)(?:\s+"([^"]*)")?/;
const OPEN_RE     = /^ {4}open(?:\s+--\s+(.*))?$/;
const SUPERSEDES_RE    = /^ {4}supersedes:\s+(\S+)\s*$/;
const SUPERSEDED_BY_RE = /^ {4}superseded-by:\s+(\S+)\s*$/;
const IMAGE_META_RE    = /^ {4}(image-[\w-]+):\s*(.*)$/;
const EQUATION_META_RE = /^ {4}(equation-[\w-]+):\s*(.*)$/;

/**
 * Parse a contiguous block of footnote definition lines into typed Footnote[].
 *
 * @param lines - The lines to parse (no trailing newlines expected on each entry).
 * @param startLineOffset - 0-based line number of `lines[0]` in the original document,
 *   used to populate `Footnote.sourceRange` for Plan 4 footnote block dimming.
 */
export function parseFootnoteBlock(
  lines: readonly string[],
  startLineOffset: number = 0,
): Footnote[] {
  const footnotes: Footnote[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!FOOTNOTE_DEF_START.test(line)) { i++; continue; }

    const idMatch = line.match(/^\[\^(cn-[\w.]+)\]:/);
    const headerRaw = parseFootnoteHeader(line);
    // `!idMatch` is unreachable in practice: FOOTNOTE_DEF_START (`/^\[\^cn-\d+(?:\.\d+)?\]:/`)
    // is strictly more restrictive than the idMatch regex (`[\w.]+`), so every line that
    // passes the FOOTNOTE_DEF_START guard above will also match idMatch.
    // `!headerRaw` IS reachable for malformed headers that lack the required 4 pipe-separated
    // fields (e.g. `[^cn-1]: truncated`). In that case we skip the block silently — the
    // line does not belong to any well-formed footnote and will be dropped.
    if (!idMatch || !headerRaw) { i++; continue; }

    const id = idMatch[1];
    // parseFootnoteHeader strips the leading `@` from the author field; we
    // re-prepend it here so the typed model stores canonical `@alice` form.
    // If parseFootnoteHeader is ever changed to preserve the `@`, remove this.
    const header: FootnoteHeader = {
      author: '@' + headerRaw.author,
      date: headerRaw.date,
      type: headerRaw.type,
      status: (headerRaw.status as 'proposed' | 'accepted' | 'rejected'),
    };

    const startLine = i;
    i++;

    const bodyLines: FootnoteLine[] = [];
    let editOp: EditOp | null = null;
    let reason: string | undefined;
    let context: string | undefined;
    const discussion: DiscussionComment[] = [];
    const approvals: Approval[] = [];
    const rejections: Approval[] = [];
    const requestChanges: Approval[] = [];
    const revisions: Revision[] = [];
    let inRevisions = false;
    let resolution: Resolution | null = null;
    let imageMetadata: Record<string, string> | undefined;
    let equationMetadata: Record<string, string> | undefined;
    let supersedesTarget: string | undefined;
    const supersededByTargets: string[] = [];

    while (i < lines.length) {
      const body = lines[i];
      // Stop if we hit another footnote definition header
      if (FOOTNOTE_DEF_START.test(body)) break;
      // Stop if line is non-empty, non-blank, and does not start with 4 spaces
      // (continuation lines must be indented)
      if (body.length > 0 && body.trim() !== '' && !body.startsWith('    ')) break;

      if (body === '' || body.trim() === '') {
        bodyLines.push({ kind: 'blank', raw: '' });
        i++; continue;
      }

      // Edit-op line: `    N:HH op-text`
      const opMatch = body.match(FOOTNOTE_L3_EDIT_OP);
      if (opMatch && !editOp) {
        const lineNumber = parseInt(opMatch[1], 10);
        const hash = opMatch[2].toLowerCase();
        const opString = opMatch[3];
        let op = opString;
        let contextBefore: string | undefined;
        let contextAfter: string | undefined;
        try {
          const ctx = parseContextualEditOp(opString);
          if (ctx) {
            op = ctx.opString;
            contextBefore = ctx.contextBefore;
            contextAfter = ctx.contextAfter;
          }
        } catch { /* fall through to raw op */ }
        // Build the discriminated EditOp variant based on whether context was extracted.
        if (contextBefore !== undefined && contextAfter !== undefined) {
          editOp = { resolutionPath: 'context', lineNumber, hash, op, contextBefore, contextAfter };
        } else {
          editOp = { resolutionPath: 'hash', lineNumber, hash, op };
        }
        bodyLines.push({ kind: 'edit-op', editOp, raw: body });
        i++; continue;
      }

      const reasonMatch = body.match(REASON_RE);
      if (reasonMatch) {
        const text = reasonMatch[1];
        if (reason === undefined) reason = text;
        bodyLines.push({ kind: 'reason', text, raw: body });
        i++; continue;
      }

      const contextMatch = body.match(CONTEXT_RE);
      if (contextMatch) {
        const text = contextMatch[1];
        if (context === undefined) context = text;
        bodyLines.push({ kind: 'context', text, raw: body });
        i++; continue;
      }

      if (FOOTNOTE_THREAD_REPLY.test(body)) {
        const replyMatch = body.match(/^\s+@(\S+)\s+(\S+)(?:\s+\[([^\]]+)\])?:\s*(.*)$/);
        if (replyMatch) {
          const reply: DiscussionComment = {
            author: replyMatch[1],
            date: replyMatch[2],
            label: replyMatch[3] ?? undefined,   // group 3: optional [label]
            timestamp: parseTimestamp(replyMatch[2]),
            text: replyMatch[4],                 // group 4: text (shifted from group 3)
            depth: 0,
          };
          discussion.push(reply);
          bodyLines.push({ kind: 'discussion', reply, raw: body });
          i++; continue;
        }
      }

      const approvedMatch = body.match(APPROVED_RE);
      if (approvedMatch) {
        const action = parseApprovalLine(approvedMatch);
        approvals.push(action);
        bodyLines.push({ kind: 'approval', action, raw: body });
        i++; continue;
      }

      const rejectedMatch = body.match(REJECTED_RE);
      if (rejectedMatch) {
        const action = parseApprovalLine(rejectedMatch);
        rejections.push(action);
        bodyLines.push({ kind: 'rejection', action, raw: body });
        i++; continue;
      }

      const requestChangesMatch = body.match(REQUEST_CHANGES_RE);
      if (requestChangesMatch) {
        const action = parseApprovalLine(requestChangesMatch);
        requestChanges.push(action);
        bodyLines.push({ kind: 'request-changes', action, raw: body });
        i++; continue;
      }

      if (body.trim() === 'revisions:') {
        inRevisions = true;
        bodyLines.push({ kind: 'revisions-header', raw: body });
        i++; continue;
      }

      if (inRevisions) {
        const revMatch = body.match(REVISION_RE);
        if (revMatch) {
          const rev: Revision = {
            label: revMatch[1],
            author: revMatch[2],
            date: revMatch[3],
            timestamp: parseTimestamp(revMatch[3]),
            text: revMatch[4],
          };
          revisions.push(rev);
          bodyLines.push({ kind: 'revision', revision: rev, raw: body });
          i++; continue;
        }
        // Non-revision line exits the revisions block (mirrors parser.ts:506)
        inRevisions = false;
      }

      const resolvedMatch = body.match(RESOLVED_RE);
      if (resolvedMatch) {
        const res: Resolution = {
          type: 'resolved',
          author: resolvedMatch[1],
          date: resolvedMatch[2],
          timestamp: parseTimestamp(resolvedMatch[2]),
          reason: resolvedMatch[3] || undefined,
        };
        if (!resolution) resolution = res;
        bodyLines.push({ kind: 'resolution', resolution: res, raw: body });
        i++; continue;
      }

      const openMatch = body.match(OPEN_RE);
      if (openMatch) {
        const res: Resolution = { type: 'open', reason: openMatch[1] || undefined };
        if (!resolution) resolution = res;
        bodyLines.push({ kind: 'resolution', resolution: res, raw: body });
        i++; continue;
      }

      const supersedesMatch = body.match(SUPERSEDES_RE);
      if (supersedesMatch) {
        const target = supersedesMatch[1];
        if (supersedesTarget === undefined) supersedesTarget = target;
        bodyLines.push({ kind: 'supersedes', target, raw: body });
        i++; continue;
      }

      const supersededByMatch = body.match(SUPERSEDED_BY_RE);
      if (supersededByMatch) {
        const target = supersededByMatch[1];
        supersededByTargets.push(target);
        bodyLines.push({ kind: 'superseded-by', target, raw: body });
        i++; continue;
      }

      const imgMatch = body.match(IMAGE_META_RE);
      if (imgMatch) {
        imageMetadata = imageMetadata ?? {};
        imageMetadata[imgMatch[1]] = imgMatch[2].trim();
        bodyLines.push({ kind: 'image-meta', key: imgMatch[1], value: imgMatch[2].trim(), raw: body });
        i++; continue;
      }

      const eqMatch = body.match(EQUATION_META_RE);
      if (eqMatch) {
        equationMetadata = equationMetadata ?? {};
        equationMetadata[eqMatch[1]] = eqMatch[2].trim();
        bodyLines.push({ kind: 'equation-meta', key: eqMatch[1], value: eqMatch[2].trim(), raw: body });
        i++; continue;
      }

      // Fallback: unknown continuation line — preserved at source position for round-trip fidelity
      bodyLines.push({ kind: 'unknown', raw: body });
      i++;
    }

    const endLine = i - 1;
    footnotes.push({
      id,
      header,
      editOp,
      bodyLines,
      reason,
      context,
      discussion,
      approvals,
      rejections,
      requestChanges,
      revisions,
      resolution,
      imageMetadata: imageMetadata ? Object.freeze(imageMetadata) : undefined,
      equationMetadata: equationMetadata ? Object.freeze(equationMetadata) : undefined,
      supersedes: supersedesTarget,
      supersededBy: Object.freeze(supersededByTargets),
      sourceRange: { startLine: startLineOffset + startLine, endLine: startLineOffset + endLine },
    });
  }

  return footnotes;
}
