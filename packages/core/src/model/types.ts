import type { Timestamp } from '../timestamp.js';

export enum ChangeType {
  Insertion = 'Insertion',
  Deletion = 'Deletion',
  Substitution = 'Substitution',
  Highlight = 'Highlight',
  Comment = 'Comment',
  Move = 'Move',
}

/**
 * Maps a ChangeType enum value to the abbreviated string used in footnotes.
 * Single source of truth — callers should not maintain their own switch.
 */
export function changeTypeToAbbrev(type: ChangeType): string {
  switch (type) {
    case ChangeType.Insertion: return 'ins';
    case ChangeType.Deletion: return 'del';
    case ChangeType.Substitution: return 'sub';
    case ChangeType.Highlight: return 'hig';
    case ChangeType.Comment: return 'com';
    case ChangeType.Move: return 'mov';
  }
}

/**
 * Maps a ChangeType enum value to the 2/3-char IR short code used in
 * LineMetadata.type. Single source of truth — callers should not maintain
 * their own switch.
 *
 * Note: this differs from {@link changeTypeToAbbrev} only for `Highlight`
 * (`'hl'` here vs `'hig'` there); the footnote abbreviation format is
 * distinct from the IR short code.
 */
export function changeTypeToShortCode(
  type: ChangeType,
): 'ins' | 'del' | 'sub' | 'hl' | 'com' | 'mov' {
  switch (type) {
    case ChangeType.Insertion: return 'ins';
    case ChangeType.Deletion: return 'del';
    case ChangeType.Substitution: return 'sub';
    case ChangeType.Highlight: return 'hl';
    case ChangeType.Comment: return 'com';
    case ChangeType.Move: return 'mov';
  }
}

/** Three canonical projections per ADR-B. */
export type Projection = 'current' | 'decided' | 'original' | 'none';

export enum ChangeStatus {
  Proposed = 'Proposed',
  Accepted = 'Accepted',
  Rejected = 'Rejected',
}

export interface OffsetRange {
  start: number;
  end: number;
}

export interface Approval {
  author: string;
  /** @deprecated Use timestamp.date */
  date: string;
  timestamp: Timestamp;
  reason?: string;
  blocking?: boolean; // true = blocks merge until withdrawn
}

export interface Revision {
  label: string;
  author: string;
  /** @deprecated Use timestamp.date */
  date: string;
  timestamp: Timestamp;
  text: string;
}

export interface DiscussionComment {
  author: string;
  /** @deprecated Use timestamp.date */
  date: string;
  timestamp: Timestamp;
  label?: string;
  text: string;
  depth: number;
}

export type Resolution =
  | { type: 'resolved'; author: string; /** @deprecated Use timestamp.date */ date: string; timestamp: Timestamp; reason?: string }
  | { type: 'open'; reason?: string };

export interface InlineMetadata {
  raw: string;
  author?: string;
  date?: string;
  type?: string;
  status?: string;
  freeText?: string;
}

export interface ChangeNode {
  id: string;
  type: ChangeType;
  status: ChangeStatus;
  range: OffsetRange;
  contentRange: OffsetRange;
  originalRange?: OffsetRange;
  modifiedRange?: OffsetRange;
  originalText?: string;
  modifiedText?: string;
  inlineMetadata?: InlineMetadata;
  level: 0 | 1 | 2;
  metadata?: {
    comment?: string;
    author?: string;
    date?: string;
    type?: string;
    status?: string;
    context?: string;
    approvals?: Approval[];
    rejections?: Approval[];
    requestChanges?: Approval[];
    revisions?: Revision[];
    discussion?: DiscussionComment[];
    resolution?: Resolution;
    imageDimensions?: { widthIn: number; heightIn: number };
    imageMetadata?: Record<string, string>;
    equationMetadata?: Record<string, string>;
  };
  moveRole?: 'from' | 'to';
  groupId?: string;
  decided?: boolean;
  /**
   * True if a footnote ref [^cn-N] is present following the inline markup.
   * - L3 footnote-native nodes always have anchored=true (a ref exists by
   *   construction in the footnote block).
   * - L2 settled refs always have anchored=true.
   * - L0/L1 bare inline markup that has not yet been promoted to L2 has
   *   anchored=false (no ref attached yet).
   *
   * Independent of position validity — see `resolved`.
   */
  anchored: boolean;
  /**
   * True if the parser successfully resolved this change to a byte range in the
   * body. False only for L3 parser failures where the footnote's edit-op text
   * could not be located on the target line. L3 parser failure paths emit
   * coordinate_failed and set resolved:false
   * (footnote-native-parser.ts:535, 670, 740).
   *
   * Every ChangeNode carries an explicit resolved value — there is no
   * undefined/absent state after Tranche 4.5.
   *
   * Invariants:
   * - When resolved=true, range.start/end point to valid bytes in body.
   * - When resolved=false, range is the sentinel {0,0}; do not splice or render.
   * - L0/L1 inline-only nodes always have resolved=true (parsed from inline delimiters).
   *
   * Replaces the dual semantics of `anchored` documented in
   * docs/findings/2026-03-17-anchored-dual-semantics.md.
   */
  resolved: boolean;
  footnoteRefStart?: number;  // byte offset where [^cn-N] starts (set by parser for L2 anchored changes)
  /** Line range of the footnote definition block in the raw text (0-based, inclusive). */
  footnoteLineRange?: { startLine: number; endLine: number };
  /** Number of discussion thread reply lines in the footnote body. */
  replyCount?: number;
  /** How this change's anchor was resolved by the parser. */
  resolutionPath?: 'hash' | 'context' | 'replay' | 'rejected';
  /** If another operation consumed this one (supersede chain detection from scrub). */
  consumedBy?: string;
  /** Whether the consumption was full (entire op superseded) or partial (subset consumed). */
  consumptionType?: 'full' | 'partial';
  /** Updated LINE:HASH edit-op line computed by the scrub replay. */
  freshAnchor?: string;
  /**
   * For deletions whose contextual resolution succeeded at sub-line precision:
   * the byte offset within `range` where the deleted text used to live
   * (equals `contextBefore.length`). The plan builder reads this to inject
   * ghost deleted text at the exact seam within the contextual anchor span.
   *
   * ANCHOR SEMANTICS: after the bug 5 fix, `range` covers the full
   * contextual embedding (contextBefore + deletedText + contextAfter).
   * The `range` is NOT a removal span — the deleted bytes are absent from
   * the body. The seam is the only point that matters for accept-change
   * and for ghost-text injection.
   *
   * Not set on non-deletions. Not set when deletion resolution fell back to
   * line granularity (the range is `{lineStart, lineEnd}` in that case).
   * Not set when deletion resolution failed entirely (range is the `{0, 0}`
   * sentinel with `anchored: false`).
   *
   * TODO(Plan 4): update operations/accept-change.ts to use
   * `range.start + (deletionSeamOffset ?? 0)` as the zero-width insertion
   * point for the removal, instead of using `range` as a byte-span.
   */
  deletionSeamOffset?: number;
  // ── L3 SDK projection fields (all optional, backward compatible) ──
  projection?: Projection;
  anchor?: { kind: 'offset'; offset: number; length: number }
         | { kind: 'line-hash'; line: number; hash: string; embedding?: string }
         | { kind: 'contextual'; context: string };
  supersedes?: string;        // a change has one predecessor
  supersededBy?: string[];    // a change can be replaced by multiple competing successors
  parent?: string;
  children?: string[];
  activeSpan?: { start: number; end: number };
  targetRegion?: { start: number; end: number };
  intermediateBody?: string;
}

/**
 * Diagnostic emitted when a footnote's edit-op could not be resolved against the body.
 * Carried on VirtualDocument.unresolvedDiagnostics for display in hover / status bar.
 */
export interface UnresolvedDiagnostic {
  /** The footnote ID (e.g., "cn-5") */
  changeId: string;
  /** What text was expected in the body */
  expectedText: string;
  /** What was found on the target line */
  actualLineContent: string;
  /** Which resolution tiers were attempted and failed */
  attemptedPaths: ('hash' | 'relocation' | 'context' | 'replay')[];
}

/**
 * A ghost node has unresolved position (range is the sentinel {0,0}) and
 * is not consumed by another change. Per spec §3.1, after the resolved-field
 * migration: ghost ⟺ resolved=false ∧ !consumedBy. The previous level≥2
 * gate became unnecessary because L0/L1 inline-only nodes always have
 * resolved=true.
 *
 */
export function isGhostNode(node: ChangeNode): boolean {
  return node.resolved === false && !node.consumedBy;
}

/**
 * Extract the effective status string from a ChangeNode, normalized to lowercase.
 * Uses the 3-tier fallback: metadata.status → inlineMetadata.status → node.status enum.
 */
/** User-facing label for a consumption type: "Consumed" or "Partially consumed". */
export function consumptionLabel(type?: 'full' | 'partial'): string {
  return type === 'partial' ? 'Partially consumed' : 'Consumed';
}

export function nodeStatus(node: ChangeNode): string {
  return (node.metadata?.status ?? node.inlineMetadata?.status ?? node.status).toString().toLowerCase();
}

export interface TextEdit {
  offset: number;
  length: number;
  newText: string;
}

/**
 * In-flight representation of a pending insertion before it's committed as markup.
 * Used for LSP overlay merge and extension fallback when LSP is disconnected.
 */
export interface PendingOverlay {
  range: { start: number; end: number };
  text: string;
  type: 'insertion';
  scId?: string;
}
