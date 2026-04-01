// packages/core/src/host/decorations/types.ts

/** Canonical decoration type identifiers — matches SpyEditor indices 0-18. */
export type DecorationTypeId =
  | 'insertion' | 'deletion'
  | 'substitutionOriginal' | 'substitutionModified'
  | 'highlight' | 'comment'
  | 'hidden' | 'unfoldedDelimiter'
  | 'commentIcon' | 'activeHighlight'
  | 'moveFrom' | 'moveTo'
  | 'settledRef' | 'settledDim'
  | 'ghostDeletion'
  | 'consumed' | 'consumingAnnotation'
  | 'ghostDelimiter' | 'ghostRef';

/** UTF-16 offset range ([start, end] — inclusive end per isOffsetInRange). */
export interface OffsetRange {
  start: number;
  end: number;
}

/** A single offset-based decoration with optional hover text and pseudo-elements. */
export interface OffsetDecoration {
  range: OffsetRange;
  hoverText?: string;
  renderBefore?: { contentText: string };
  renderAfter?: { contentText: string; fontStyle?: string };
}

/** Per-author decoration entry keyed by "author:role". */
export type AuthorDecorationRole =
  | 'insertion' | 'deletion'
  | 'substitution-original' | 'substitution-modified'
  | 'move-from' | 'move-to';

export interface AuthorDecorationEntry {
  role: AuthorDecorationRole;
  ranges: OffsetDecoration[];
}

/** Platform-agnostic decoration plan — output of buildDecorationPlan(). */
export interface DecorationPlan {
  insertions: OffsetDecoration[];
  deletions: OffsetDecoration[];
  substitutionOriginals: OffsetDecoration[];
  substitutionModifieds: OffsetDecoration[];
  highlights: OffsetDecoration[];
  comments: OffsetDecoration[];
  hiddens: OffsetDecoration[];
  unfoldedDelimiters: OffsetDecoration[];
  commentIcons: OffsetDecoration[];
  activeHighlights: OffsetDecoration[];
  moveFroms: OffsetDecoration[];
  moveTos: OffsetDecoration[];
  settledRefs: OffsetDecoration[];
  settledDims: OffsetDecoration[];
  ghostDeletions: OffsetDecoration[];
  consumedRanges: OffsetDecoration[];
  consumingOpAnnotations: OffsetDecoration[];
  ghostDelimiters: OffsetDecoration[];
  ghostRefs: OffsetDecoration[];
  hiddenOffsets: OffsetRange[];
  authorDecorations: Map<string, AuthorDecorationEntry>;
}

/** Overview ruler plan — ranges grouped by change type. */
export interface OverviewRulerPlan {
  insertions: OffsetRange[];
  deletions: OffsetRange[];
  substitutions: OffsetRange[];
  highlights: OffsetRange[];
  comments: OffsetRange[];
}

/** Platform-agnostic style definition for one decoration type. */
export interface DecorationStyleDef {
  light: {
    color?: string;
    textDecoration?: string;
    backgroundColor?: string;
    opacity?: string;
    fontStyle?: string;
    border?: string;
  };
  dark: {
    color?: string;
    textDecoration?: string;
    backgroundColor?: string;
    opacity?: string;
    fontStyle?: string;
    border?: string;
  };
  before?: {
    color?: { light: string; dark: string };
    fontStyle?: string;
    textDecoration?: string;
  };
  after?: {
    contentText?: string;
    color?: { light: string; dark: string };
    fontStyle?: string;
    margin?: string;
  };
  overviewRuler?: {
    color: string;
    lane: 'left' | 'right';
  };
}

/**
 * Platform adapter interface for decoration application.
 *
 * Two execution models:
 * - Per-call (VS Code): setDecorations() applies immediately. beginPass/endPass are no-ops.
 * - Batched (Monaco): setDecorations() accumulates. endPass() commits the batch.
 */
export interface DecorationTarget {
  beginPass(): void;
  setDecorations(typeId: string, decorations: OffsetDecoration[], text: string): void;
  setOverviewRuler(typeId: string, ranges: OffsetRange[], text: string): void;
  endPass(): void;
  clear(): void;
  dispose(): void;
}
