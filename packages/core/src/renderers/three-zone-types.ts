// packages/core/src/renderers/three-zone-types.ts

import type { BuiltinView } from '../host/types.js';
import type { SessionHashes } from './view-builders/session-hashes.js';

export type LineFlag = 'P' | 'A';

export interface DeliberationHeader {
  filePath: string;
  trackingStatus: 'tracked' | 'untracked';
  protocolMode: string;                    // 'classic' | 'compact'
  defaultView: BuiltinView;
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
  type?: 'ins' | 'del' | 'sub' | 'hl' | 'com';
  status?: 'proposed' | 'accepted' | 'rejected';
  reason?: string;
  replyCount?: number;
  /** Latest reply turn in the discussion thread (when 2+ turns exist). */
  latestThreadTurn?: { author?: string; text: string };
}

export interface ThreeZoneLine {
  margin: {
    lineNumber: number;      // 1-indexed
    hash: string;            // 2-char xxHash32 hex
    flags: LineFlag[];       // P, A, or empty
  };
  content: ContentSpan[];
  metadata: LineMetadata[];
  /** Raw file line number (1-indexed). Equals margin.lineNumber for working/raw views. */
  rawLineNumber: number;
  /** True if this line continues a multi-line CriticMarkup block from a previous line. */
  continuesChange?: boolean;
  /** Additional hashes for session binding (not rendered). */
  sessionHashes: SessionHashes;
}

export interface ThreeZoneDocument {
  view: BuiltinView;
  header: DeliberationHeader;
  lines: ThreeZoneLine[];
  /** Only present in raw view — literal footnote definitions. */
  footnoteSection?: string;
}
