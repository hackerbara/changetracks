import { ChangeNode, ChangeType, ChangeStatus, OffsetRange } from '../model/types.js';
import { VirtualDocument } from '../model/document.js';
import { parseOp } from '../op-parser.js';
import { parseTimestamp } from '../timestamp.js';
import { computeLineHash } from '../hashline.js';
import { relocateHashRef } from '../hashline-cleanup.js';
import { FOOTNOTE_DEF_START, FOOTNOTE_L3_EDIT_OP, splitBodyAndFootnotes, CTX_RE, unescapeCtxString, IMAGE_DIMENSIONS_RE } from '../footnote-patterns.js';
import { parseFootnoteBlock } from './footnote-block-parser.js';
import type { Footnote as TypedFootnote } from '../model/footnote.js';
import { tryFindUniqueMatch, type UniqueMatch } from '../file-ops.js';
import { defaultNormalizer } from '../text-normalizer.js';
import { resolveReplayFromParsedFootnotes, type ReplayFootnote } from '../operations/scrub.js';
import { lineOffset } from '../comment-syntax.js';
import { parseContextualEditOp } from './contextual-edit-op.js';

export { parseContextualEditOp };

/** Extract deletion context from the portion of opString after the CriticMarkup closer. */
function parseDeletionContext(opString: string): { before: string; after: string } | null {
  // Find end of {--text--} in the opString
  const closerIdx = opString.indexOf('--}');
  if (closerIdx < 0) return null;
  const remainder = opString.slice(closerIdx + 3);
  const match = remainder.match(CTX_RE);
  if (!match) return null;
  return { before: unescapeCtxString(match[1]), after: unescapeCtxString(match[2]) };
}

export interface ParsedFootnote {
  id: string;
  author: string;
  date: string;
  type: string;
  status: string;
  lineNumber?: number;
  hash?: string;
  opString?: string;
  /** Contextual embedding, pre-parsed by parseFootnoteBlock. When set,
   *  resolveChanges skips the redundant parseContextualEditOp call. */
  contextBefore?: string;
  contextAfter?: string;
  /** Scratch storage for unmatched continuation lines during parsing.
   *  Fed into parseFootnoteBlock (Task 5) which classifies them structurally. */
  unknownBodyLines?: string[];
  approvals?: Array<{ author: string; date: string; reason: string }>;
  rejections?: Array<{ author: string; date: string; reason: string }>;
  /** 0-indexed line in the raw text where this footnote header starts */
  startLine?: number;
  /** 0-indexed line where this footnote ends (inclusive) */
  endLine?: number;
  /** Number of discussion thread reply lines in the footnote body */
  replyCount?: number;
  /** Parsed image dimensions from `image-dimensions:` metadata line */
  imageDimensions?: { widthIn: number; heightIn: number };
  /** Additional image metadata key-value pairs from `image-*:` lines */
  imageMetadata?: Record<string, string>;
  /** Additional equation metadata key-value pairs from `equation-*:` lines */
  equationMetadata?: Record<string, string>;
}

export class FootnoteNativeParser {
  parse(text: string): VirtualDocument {
    const lines = text.split('\n');
    const { bodyLines, footnoteLines } = splitBodyAndFootnotes(lines);

    const footnotes = this.parseFootnotes(lines);
    if (footnotes.length === 0) {
      return new VirtualDocument([]);
    }

    const changes = this.resolveChanges(footnotes, bodyLines);

    // freshAnchors: updated edit-op lines from the scrub replay, keyed by change ID.
    // Populated during the replay fallback below; used to compute resolvedText.
    let freshAnchors = new Map<string, string>();

    // Resolution protocol fallback: if any changes are unanchored,
    // run the scrub replay (backward+forward) using already-parsed footnote
    // data — avoids re-parsing the document through resolve().
    if (changes.some(c => !c.anchored)) {
      try {
        const bodyText = bodyLines.join('\n');

        // Convert ParsedFootnote[] to ReplayFootnote[], reconstructing the
        // full indented LINE:HASH edit-op line from the parsed fields.
        const replayFootnotes: ReplayFootnote[] = footnotes.map(fn => ({
          id: fn.id,
          type: fn.type,
          status: fn.status,
          lineNumber: fn.lineNumber,
          hash: fn.hash,
          opString: fn.opString,
          editOpLine: fn.opString && fn.lineNumber !== undefined && fn.hash
            ? `    ${fn.lineNumber}:${fn.hash} ${fn.opString}`
            : undefined,
        }));

        const replay = resolveReplayFromParsedFootnotes(bodyText, replayFootnotes);

        for (const node of changes) {
          if (node.anchored) continue;
          const finalPos = replay.finalPositions.get(node.id);
          const isConsumed = replay.consumption.has(node.id);
          // Only mark anchored if the protocol provides a valid body range.
          // Consumed ops stay anchored:false but are visible to LSP consumers
          // via their footnote-block range (assigned below).
          if (finalPos && !isConsumed) {
            node.anchored = true;
            node.range = { start: finalPos.start, end: finalPos.end };
            node.contentRange = { ...node.range };
            node.resolutionPath = 'replay';
          }
          const freshAnchor = replay.freshAnchors.get(node.id);
          if (freshAnchor) node.freshAnchor = freshAnchor;
          const consumed = replay.consumption.get(node.id);
          if (consumed) {
            node.consumedBy = consumed.consumedBy;
            node.consumptionType = consumed.type;

            // Assign footnote definition block as range for consumed ops
            // so LSP consumers have a valid position to attach UI to.
            if (node.footnoteLineRange) {
              const start = lineOffset(lines, node.footnoteLineRange.startLine);
              const end = lineOffset(lines, node.footnoteLineRange.endLine) + lines[node.footnoteLineRange.endLine].length;
              node.range = { start, end };
              node.contentRange = { ...node.range };
            }
          }
        }

        freshAnchors = replay.freshAnchors;
      } catch {
        // Resolution protocol failed — leave nodes unanchored
      }
    }

    // Compute real coherence rate from resolved vs total changes.
    // Ghost nodes (anchored:false) count as unresolved.
    const resolvableCount = changes.length;
    const resolvedCount = changes.filter(c => c.anchored || !!c.consumedBy).length;
    const coherenceRate = resolvableCount > 0
      ? Math.round((resolvedCount / resolvableCount) * 100)
      : 100;

    // Build resolvedText: rewrite footnote section with fresh anchors from replay.
    // Only set if at least one anchor changed (signals LSP write-back is needed).
    let resolvedText: string | undefined;
    if (freshAnchors.size > 0) {
      const rebuiltFootnotes: string[] = [];
      let anyChanged = false;
      let fi = 0;
      while (fi < footnoteLines.length) {
        const fline = footnoteLines[fi];
        const idMatch = fline.match(/^\[\^(cn-[\w.]+)\]:/);
        if (idMatch) {
          const freshAnchor = freshAnchors.get(idMatch[1]);
          rebuiltFootnotes.push(fline);
          fi++;
          let editOpReplaced = false;
          while (fi < footnoteLines.length) {
            const contLine = footnoteLines[fi];
            if (FOOTNOTE_DEF_START.test(contLine)) break;
            if (!editOpReplaced && FOOTNOTE_L3_EDIT_OP.test(contLine) && freshAnchor) {
              if (freshAnchor !== contLine) anyChanged = true;
              rebuiltFootnotes.push(freshAnchor);
              editOpReplaced = true;
              fi++;
            } else if (/^\s/.test(contLine) || contLine.trim() === '') {
              rebuiltFootnotes.push(contLine);
              fi++;
            } else {
              break;
            }
          }
        } else {
          rebuiltFootnotes.push(fline);
          fi++;
        }
      }
      if (anyChanged) {
        resolvedText = bodyLines.join('\n') + '\n\n' + rebuiltFootnotes.join('\n') + '\n';
      }
    }

    return new VirtualDocument(changes, coherenceRate, [], resolvedText);
  }

  /**
   * Test-only hook: run just the footnote-scanning phase and return the raw
   * ParsedFootnote structs before change resolution.  Used by
   * parser-bug-fixes.test.ts to assert on `unknownBodyLines` directly.
   *
   * @internal Do NOT call from production code.
   */
  _testScanFootnotes(text: string): ParsedFootnote[] {
    return this.parseFootnotes(text.split('\n'));
  }

  private parseFootnotes(lines: string[]): ParsedFootnote[] {
    const { footnoteLines } = splitBodyAndFootnotes(lines);
    // startLineOffset: the 0-indexed position of footnoteLines[0] in the original `lines` array.
    // This is used by parseFootnoteBlock to populate Footnote.sourceRange for accurate
    // footnoteLineRange values in ChangeNode enrichment.
    const startLineOffset = lines.length - footnoteLines.length;
    const typed = parseFootnoteBlock(footnoteLines, startLineOffset);
    return typed.map(f => this.typedToLegacy(f));
  }

  /** Adapter: typed Footnote (new) → ParsedFootnote (legacy resolver input). */
  private typedToLegacy(f: TypedFootnote): ParsedFootnote {
    let imageDimensions: { widthIn: number; heightIn: number } | undefined;
    const dimRaw = f.imageMetadata?.['image-dimensions'];
    if (dimRaw) {
      const m = dimRaw.match(IMAGE_DIMENSIONS_RE);
      if (m) imageDimensions = { widthIn: parseFloat(m[1]), heightIn: parseFloat(m[2]) };
    }
    const contextBefore = f.editOp?.resolutionPath === 'context' ? f.editOp.contextBefore : undefined;
    const contextAfter = f.editOp?.resolutionPath === 'context' ? f.editOp.contextAfter : undefined;
    return {
      id: f.id,
      author: f.header.author,
      date: f.header.date,
      type: f.header.type,
      status: f.header.status,
      startLine: f.sourceRange.startLine,
      endLine: f.sourceRange.endLine,
      lineNumber: f.editOp?.lineNumber,
      hash: f.editOp?.hash,
      opString: f.editOp
        ? (f.editOp.resolutionPath === 'context'
          ? `${f.editOp.contextBefore ?? ''}${f.editOp.op}${f.editOp.contextAfter ?? ''}`
          : f.editOp.op)
        : undefined,
      contextBefore,
      contextAfter,
      replyCount: f.discussion.length,
      approvals: f.approvals.length > 0
        ? f.approvals.map(a => ({ author: a.author, date: a.date, reason: a.reason ?? '' }))
        : undefined,
      rejections: f.rejections.length > 0
        ? f.rejections.map(a => ({ author: a.author, date: a.date, reason: a.reason ?? '' }))
        : undefined,
      imageDimensions,
      imageMetadata: f.imageMetadata ? { ...f.imageMetadata } : undefined,
      equationMetadata: f.equationMetadata ? { ...f.equationMetadata } : undefined,
      unknownBodyLines: f.bodyLines.filter(l => l.kind === 'unknown').map(l => (l as { raw: string }).raw.trim()),
    };
  }

  private resolveChanges(
    footnotes: ParsedFootnote[],
    bodyLines: string[],
  ): ChangeNode[] {
    const changes: ChangeNode[] = [];

    // Precompute cumulative line-start offsets for O(1) lookup
    const lineOffsets: number[] = [0];
    for (let i = 0; i < bodyLines.length; i++) {
      lineOffsets.push(lineOffsets[i] + bodyLines[i].length + 1);
    }

    for (const fn of footnotes) {
      const changeType = this.resolveType(fn.type);
      if (changeType === null) continue; // Skip unrecognized change types
      const status = this.resolveStatus(fn.status);

      // Parse the CriticMarkup op to extract text content.
      // For contextual format (e.g. "Protocol overview"), extract the
      // CriticMarkup portion first — parseOp expects the string to start with
      // a CriticMarkup delimiter.
      let parsedOp: ReturnType<typeof parseOp> | null = null;
      let ctxResult: ReturnType<typeof parseContextualEditOp> = null;
      if (fn.opString) {
        try {
          if (fn.contextBefore !== undefined || fn.contextAfter !== undefined) {
            // Context already parsed by parseFootnoteBlock — reuse to avoid redundant re-parse.
            const before = fn.contextBefore ?? '';
            const after = fn.contextAfter ?? '';
            const criticMarkupOp = fn.opString.slice(before.length, fn.opString.length - after.length);
            ctxResult = { contextBefore: before, contextAfter: after, opString: criticMarkupOp };
            parsedOp = parseOp(criticMarkupOp);
          } else {
            ctxResult = parseContextualEditOp(fn.opString);
            parsedOp = parseOp(ctxResult ? ctxResult.opString : fn.opString);
          }
        } catch {
          // Malformed op — skip this footnote
          continue;
        }
      }

      // Resolve range in body text
      const rangeResult = this.resolveRangeAndContent(
        fn,
        parsedOp,
        ctxResult,
        changeType,
        status,
        bodyLines,
        lineOffsets,
      );
      const { range, originalText, modifiedText, comment, anchored, resolutionPath } = rangeResult;

      // Build the ChangeNode
      const node: ChangeNode = {
        id: fn.id,
        type: changeType,
        status,
        range,
        contentRange: { ...range }, // L3: range === contentRange (no delimiters in body)
        level: 2,
        // anchored:false means position could not be deterministically resolved (Invariant A).
        // anchored:true (default) means either resolved uniquely or explicitly OK (deletion line-start).
        anchored: anchored !== false,
        metadata: {
          author: fn.author,
          date: fn.date,
          comment: comment ?? parsedOp?.reasoning ?? undefined,
        },
      };

      if (originalText !== undefined) node.originalText = originalText;
      if (modifiedText !== undefined) node.modifiedText = modifiedText;

      // Populate enriched fields
      if (fn.startLine !== undefined) {
        node.footnoteLineRange = { startLine: fn.startLine, endLine: fn.endLine ?? fn.startLine };
      }
      node.replyCount = fn.replyCount ?? 0;
      if (fn.imageDimensions) {
        node.metadata!.imageDimensions = fn.imageDimensions;
      }
      if (fn.imageMetadata) {
        node.metadata!.imageMetadata = fn.imageMetadata;
      }
      if (fn.equationMetadata) {
        node.metadata!.equationMetadata = fn.equationMetadata;
      }
      if (resolutionPath !== undefined) {
        node.resolutionPath = resolutionPath;
      }
      if (rangeResult.deletionSeamOffset !== undefined) {
        node.deletionSeamOffset = rangeResult.deletionSeamOffset;
      }

      // Approvals
      if (fn.approvals && fn.approvals.length > 0) {
        node.metadata!.approvals = fn.approvals.map(a => ({
          author: a.author,
          date: a.date,
          timestamp: parseTimestamp(a.date),
          reason: a.reason || undefined,
        }));
      }

      // Rejections
      if (fn.rejections && fn.rejections.length > 0) {
        node.metadata!.rejections = fn.rejections.map(r => ({
          author: r.author,
          date: r.date,
          timestamp: parseTimestamp(r.date),
          reason: r.reason || undefined,
        }));
      }

      changes.push(node);
    }

    changes.sort((a, b) => a.range.start - b.range.start);
    return changes;
  }

  /**
   * Resolve the character range for a change node in the body text.
   *
   * For L3:
   * - Insertion: search for newText on the target line via findUniqueMatch; range covers the matched text
   * - Deletion: range covers the full contextual anchor span (contextBefore + contextAfter).
   *   `deletionSeamOffset` gives the byte offset within this span where the deletion occurred
   *   (equals contextBefore.length). The spec's Contextual Uniqueness Guarantee ensures this
   *   span appears exactly once on the target line (04-spec.md §"Contextual Embedding").
   *   Zero-width ranges appear only as the {0,0} anchored:false sentinel (Invariant A).
   *   This is deliberate — do NOT revert to zero-width seam without understanding
   *   the plan builder's ghost-text injection and accept-change.ts's seam-based removal.
   * - Substitution: search for newText (proposed/accepted) or oldText (rejected) on target line
   * - Highlight: search for the highlighted text on the target line
   * - Comment: fall back to line start (no text to anchor to)
   * - Rejected insertion: text is not in body; zero-width range at line start
   *
   * DETERMINISTIC ANCHOR RESOLUTION INVARIANTS (spec §11):
   *
   * Invariant A — Non-deletion ops (ins, sub, highlight) MUST resolve uniquely via
   * findUniqueMatch on the hash-resolved line. If the match fails (text not found or
   * ambiguous), the node is marked anchored:false. There is NO fallback to line-start
   * for non-deletion ops. Silent fallback produces wrong decoration placement.
   *
   * Invariant B — Deletion ops resolve via @ctx:"before"||"after" ONLY. The deleted
   * text is absent from the body so there is nothing to search for. Line-start fallback
   * when @ctx is missing is acceptable degradation (not a silent error).
   *
   * Invariant C — anchored:false is an error path, not a silent default. Consumers
   * must not render anchored:false nodes as correctly placed decorations.
   *
   * Task 3 enforced Invariant A by removing the fallbackRange branches for
   * ins/sub/highlight and setting anchored:false + sentinel range {0,0} instead.
   */
  private resolveRangeAndContent(
    fn: ParsedFootnote,
    parsedOp: ReturnType<typeof parseOp> | null,
    ctxResult: ReturnType<typeof parseContextualEditOp>,
    changeType: ChangeType,
    status: ChangeStatus,
    bodyLines: string[],
    lineOffsets: number[],
  ): {
    range: OffsetRange;
    originalText?: string;
    modifiedText?: string;
    comment?: string;
    anchored?: boolean;  // false = could not resolve position deterministically (Invariant A)
    resolutionPath?: 'hash' | 'context' | 'rejected';
    deletionSeamOffset?: number;  // byte offset within range to the deletion seam
  } {
    // Resolve the effective line number — verify hash and relocate if needed
    let effectiveLineNumber = fn.lineNumber;
    let hashMatched = false;
    if (fn.lineNumber !== undefined && fn.hash) {
      const hashCheckIdx = fn.lineNumber - 1;
      if (hashCheckIdx >= 0 && hashCheckIdx < bodyLines.length) {
        const actualHash = computeLineHash(hashCheckIdx, bodyLines[hashCheckIdx], bodyLines);
        if (actualHash.toLowerCase() === fn.hash.toLowerCase()) {
          hashMatched = true;
        } else {
          const relocated = relocateHashRef(
            { line: fn.lineNumber, hash: fn.hash },
            bodyLines,
            computeLineHash,
          );
          if (relocated?.relocated) {
            effectiveLineNumber = relocated.newLine;
            hashMatched = true;
          }
        }
      }
    }

    // Compute the character offset of the start of the target line
    const lineIdx = (effectiveLineNumber ?? 1) - 1;
    const lineOffset = (lineIdx >= 0 && lineIdx < lineOffsets.length)
      ? lineOffsets[lineIdx]
      : 0;
    const lineContent = (lineIdx >= 0 && lineIdx < bodyLines.length)
      ? bodyLines[lineIdx]
      : '';

    // Fallback zero-width range at line start
    const fallbackRange: OffsetRange = { start: lineOffset, end: lineOffset };

    if (!parsedOp) {
      // No op string — settled/ghost footnote. No deterministic position can be resolved.
      // Mark anchored:false so consumers can filter these ghost nodes (Invariant A).
      return { range: fallbackRange, anchored: false, comment: fn.unknownBodyLines?.[0], resolutionPath: 'rejected' };
    }

    // Unified matching: find search text on the target line via findUniqueMatch
    const findOnLine = (searchText: string): UniqueMatch | null => {
      if (!searchText || !lineContent) return null;
      return tryFindUniqueMatch(lineContent, searchText, defaultNormalizer);
    };

    // ── Contextual edit-op resolution ─────────────────────────────────────
    // New format: `3:hash Protocol {++o++}verview` — the surrounding text
    // provides a body-match anchor so the op position can be pinpointed even
    // when the changed text alone is ambiguous. ctxResult and parsedOp are
    // pre-computed by the caller — no need to re-parse here.
    if (ctxResult && parsedOp) {
      const { contextBefore, contextAfter } = ctxResult;

      // Build the body-match string — what actually appears in the body for this op
      let bodyMatch: string;
      switch (changeType) {
        case ChangeType.Insertion:
          if (status === ChangeStatus.Rejected) {
            bodyMatch = contextBefore + contextAfter;
          } else {
            bodyMatch = contextBefore + parsedOp.newText + contextAfter;
          }
          break;
        case ChangeType.Deletion:
          bodyMatch = contextBefore + contextAfter;
          break;
        case ChangeType.Substitution:
          if (status === ChangeStatus.Rejected) {
            bodyMatch = contextBefore + parsedOp.oldText + contextAfter;
          } else {
            bodyMatch = contextBefore + parsedOp.newText + contextAfter;
          }
          break;
        case ChangeType.Highlight:
          bodyMatch = contextBefore + parsedOp.oldText + contextAfter;
          break;
        default:
          bodyMatch = contextBefore + contextAfter;
      }

      const bodyMatchResult = findOnLine(bodyMatch);

      if (bodyMatchResult) {
        const matchStart = lineOffset + bodyMatchResult.index;
        const opStart = matchStart + contextBefore.length;

        // Compute the range based on change type. For deletions, the matched span
        // IS the contextual anchor (contextBefore + contextAfter from the body).
        // See 04-spec.md §"Contextual Embedding" / §"Contextual Uniqueness Guarantee".
        let rangeStart: number;
        let rangeEnd: number;
        let deletionSeamOffset: number | undefined;

        switch (changeType) {
          case ChangeType.Insertion: {
            rangeStart = opStart;
            rangeEnd = opStart + (status === ChangeStatus.Rejected ? 0 : parsedOp.newText.length);
            break;
          }
          case ChangeType.Deletion: {
            // The spec's Contextual Uniqueness Guarantee ensures contextBefore + contextAfter
            // appears exactly once on the target line. The matched span IS the anchor —
            // preserve it as a non-zero range. Zero-width ranges exist only as the {0,0}
            // anchored:false sentinel (Invariant A). deletionSeamOffset records where the
            // deleted text used to live within this anchor span so the plan builder and
            // accept-change logic can find the exact removal point without re-scanning.
            // See: website-v2/public/content/04-spec.md §"Contextual Embedding".
            rangeStart = matchStart;
            rangeEnd = matchStart + bodyMatch.length;
            deletionSeamOffset = contextBefore.length;
            break;
          }
          case ChangeType.Substitution: {
            rangeStart = opStart;
            rangeEnd = opStart + (status === ChangeStatus.Rejected
              ? parsedOp.oldText.length
              : parsedOp.newText.length);
            break;
          }
          case ChangeType.Highlight: {
            rangeStart = opStart;
            rangeEnd = opStart + parsedOp.oldText.length;
            break;
          }
          default:
            rangeStart = opStart;
            rangeEnd = opStart;
        }

        return {
          range: { start: rangeStart, end: rangeEnd },
          originalText: parsedOp.oldText || undefined,
          modifiedText: parsedOp.newText || undefined,
          comment: parsedOp.reasoning ?? undefined,
          deletionSeamOffset,
          // When the hash also matched, label as 'hash' (same semantics as the
          // old resolve() Phase A: hash gate passed, context match pinpointed position).
          // When only context matched (hash mismatch or relocation), label as 'context'.
          resolutionPath: hashMatched ? 'hash' : 'context',
        };
      }
      // If body-match not found on line, fall through to legacy resolution
    }
    // ── End contextual resolution ──────────────────────────────────────────

    switch (changeType) {
      case ChangeType.Insertion: {
        // Invariant A: resolve by unique text match (newText) in line content.
        // No fallback to line-start for non-deletion cases.
        const text = parsedOp.newText;
        if (text === '') {
          return { range: fallbackRange, modifiedText: text, resolutionPath: hashMatched ? 'hash' : undefined };
        }
        // Rejected insertions: body still contains the inserted text (applyReview
        // only updates the footnote header, not the body). Search for newText so
        // settlement can locate and remove it.
        // Proposed/accepted insertions: same search — newText is in the body.
        const match = findOnLine(text);
        if (!match) {
          // Invariant A: non-deletion op could not be uniquely resolved — signal unresolved.
          // Use a zero-width sentinel range (not fallbackRange) so consumers can detect
          // the unresolved state without confusing it with a valid line-start position.
          return { range: { start: 0, end: 0 }, modifiedText: text, anchored: false };
        }
        const range: OffsetRange = {
          start: lineOffset + match.index,
          end: lineOffset + match.index + match.length,
        };
        return { range, modifiedText: text, resolutionPath: hashMatched ? 'hash' : undefined };
      }

      case ChangeType.Deletion: {
        // Invariant B: @ctx required for deterministic positioning.
        // Deleted text is absent from body — only context-based positioning is possible.
        const text = parsedOp.oldText;
        // Try context-based positioning from @ctx: field
        const ctx = fn.opString ? parseDeletionContext(fn.opString) : null;
        if (ctx) {
          const joined = ctx.before + ctx.after;
          if (joined.length > 0) {
            const match = findOnLine(joined);
            if (match) {
              return {
                range: {
                  start: lineOffset + match.index,
                  end: lineOffset + match.index + joined.length,
                },
                originalText: text,
                deletionSeamOffset: ctx.before.length,
                resolutionPath: hashMatched ? 'hash' : undefined,
              };
            }
          }
        }
        // No @ctx or context match failed — degrade to full-line range.
        // Per spec: the only zero-width range is the {0,0} sentinel for anchored:false.
        // A degraded-but-anchored deletion gets the whole target line; deletionSeamOffset
        // stays undefined so the plan builder renders ghost text at range.start.
        const lineEnd = lineOffset + lineContent.length;
        return {
          range: { start: lineOffset, end: lineEnd },
          originalText: text,
          resolutionPath: hashMatched ? 'hash' : undefined,
        };
      }

      case ChangeType.Substitution: {
        // Invariant A: resolve by unique text match in line content.
        // Body always contains newText regardless of status — applyReview only
        // updates the footnote header, not the body text. Search for newText
        // so settlement can locate and revert if rejected.
        // No fallback to line-start for non-deletion cases.
        const oldText = parsedOp.oldText;
        const newText = parsedOp.newText;
        const searchText = newText;
        const match = searchText ? findOnLine(searchText) : null;
        if (!match) {
          // Invariant A: non-deletion op could not be uniquely resolved — signal unresolved.
          return { range: { start: 0, end: 0 }, originalText: oldText, modifiedText: newText, anchored: false };
        }
        const range: OffsetRange = {
          start: lineOffset + match.index,
          end: lineOffset + match.index + match.length,
        };
        return { range, originalText: oldText, modifiedText: newText, resolutionPath: hashMatched ? 'hash' : undefined };
      }

      case ChangeType.Highlight: {
        // Highlights carry a comment annotation — the comment is the primary
        // payload, the text anchor is positioning. Unlike ins/sub where
        // decorating the wrong text is actively harmful, a highlight pinned
        // to the correct line (even at line-start) is still useful because
        // the user sees the comment. Best-effort: resolve if we can, fall
        // back to line-start if we can't, but always render.
        const text = parsedOp.oldText;
        const comment = parsedOp.reasoning;
        if (!text) {
          // Empty text (malformed footnote, Word round-trip artifact, cursor-
          // point highlight). Best-effort: pin to line-start, show comment.
          return { range: fallbackRange, comment };
        }
        const match = findOnLine(text);
        if (!match) {
          // Text not found or ambiguous on line. Best-effort: pin to line-
          // start so the comment is still visible on the correct line.
          return { range: fallbackRange, comment, resolutionPath: hashMatched ? 'hash' : undefined };
        }
        const range: OffsetRange = {
          start: lineOffset + match.index,
          end: lineOffset + match.index + match.length,
        };
        return { range, comment, resolutionPath: hashMatched ? 'hash' : undefined };
      }

      case ChangeType.Comment: {
        // Comments have no text to anchor to — line-start is the correct and only option.
        // (spec §11 summary table: comment always anchored at line-start)
        // When parsedOp.reasoning is empty, fall back to discussion text from the footnote body.
        const comment = (parsedOp.reasoning || undefined) ?? (parsedOp.oldText || fn.unknownBodyLines?.[0]);
        return { range: fallbackRange, comment, resolutionPath: hashMatched ? 'hash' : undefined };
      }

      default:
        return { range: fallbackRange, resolutionPath: hashMatched ? 'hash' : undefined };
    }
  }

  private resolveType(type: string): ChangeType | null {
    switch (type) {
      case 'ins': case 'insertion': return ChangeType.Insertion;
      case 'del': case 'deletion': return ChangeType.Deletion;
      case 'sub': case 'substitution': return ChangeType.Substitution;
      case 'highlight': case 'hi': case 'hig': return ChangeType.Highlight;
      case 'comment': case 'com': return ChangeType.Comment;
      default: return null;
    }
  }

  private resolveStatus(status: string): ChangeStatus {
    switch (status) {
      case 'accepted': return ChangeStatus.Accepted;
      case 'rejected': return ChangeStatus.Rejected;
      default: return ChangeStatus.Proposed;
    }
  }
}
