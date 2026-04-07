// packages/core/src/renderers/three-zone-types.ts

/** @deprecated Use BuiltinView and View from @changedown/core/host instead. */
export type ViewMode = 'review' | 'changes' | 'settled' | 'raw';
export type LineFlag = 'P' | 'A';

// ── View Mode Aliases ──────────────────────────────────────────────────
// Maps extension display names (and canonical names) to canonical ViewMode.

export const VIEW_MODE_ALIASES: Record<string, ViewMode> = {
  'all-markup': 'review',
  'simple': 'changes',
  'final': 'settled',
  'original': 'raw',
  // Canonical names map to themselves
  'review': 'review',
  'changes': 'changes',
  'settled': 'settled',
  'raw': 'raw',
};

/** Human-readable display names for each canonical view mode. */
export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  review: 'All Markup',
  changes: 'Simple Markup',
  settled: 'Final',
  raw: 'Original',
};

/** Ordered list of canonical view modes for cycling. */
export const VIEW_MODES: ViewMode[] = ['review', 'changes', 'settled', 'raw'];

/** Resolve any alias (or canonical name) to a ViewMode. Returns undefined for unknown strings. */
export function resolveViewMode(name: string): ViewMode | undefined {
  return VIEW_MODE_ALIASES[name];
}

/** Cycle to the next view mode. */
export function nextViewMode(current: ViewMode): ViewMode {
  const idx = VIEW_MODES.indexOf(current);
  return VIEW_MODES[(idx + 1) % VIEW_MODES.length];
}

export interface DeliberationHeader {
  filePath: string;
  trackingStatus: 'tracked' | 'untracked';
  protocolMode: string;                    // 'classic' | 'compact'
  defaultView: ViewMode;
  viewPolicy: string;                      // 'suggest' | 'require'
  counts: { proposed: number; accepted: number; rejected: number };
  authors: string[];
  threadCount: number;
  lineRange?: { start: number; end: number; total: number };
}

export interface ContentSpan {
  type: 'plain' | 'insertion' | 'deletion' | 'sub_old' | 'sub_new'
      | 'sub_arrow' | 'highlight' | 'comment' | 'anchor' | 'delimiter';
  text: string;
  /** Raw file byte offsets — used by LSP for editor range mapping. */
  sourceRange?: { start: number; end: number };
}

export interface LineMetadata {
  changeId: string;
  author?: string;
  reason?: string;
  replyCount?: number;
  status?: 'proposed' | 'accepted' | 'rejected';
}

export interface ThreeZoneLine {
  margin: {
    lineNumber: number;      // 1-indexed
    hash: string;            // 2-char xxHash32 hex
    flags: LineFlag[];       // P, A, or empty
  };
  content: ContentSpan[];
  metadata: LineMetadata[];
  /** Raw file line number (1-indexed). Equals margin.lineNumber for review/raw views. */
  rawLineNumber: number;
  /** True if this line continues a multi-line CriticMarkup block from a previous line. */
  continuesChange?: boolean;
  /** Additional hashes for session binding (not rendered). */
  sessionHashes?: {
    raw: string;
    current: string;
    committed?: string;
    currentView?: string;
    rawLineNum?: number;    // Redundant with rawLineNumber, kept for compat
  };
}

export interface ThreeZoneDocument {
  view: ViewMode;
  header: DeliberationHeader;
  lines: ThreeZoneLine[];
  /** Only present in raw view — literal footnote definitions. */
  footnoteSection?: string;
}
