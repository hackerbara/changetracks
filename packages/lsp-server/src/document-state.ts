import type { VirtualDocument, ViewMode } from '@changedown/core';
import type { CursorState } from './capabilities/code-lens';

/**
 * Pending overlay from VS Code extension (Phase 1).
 * In-flight insertion before flush; LSP merges with parse for decorationData.
 */
export interface PendingOverlay {
  range: { start: number; end: number };
  text: string;
  type: 'insertion';
  scId?: string;
}

/** Cut context for server-side move correlation. */
export interface PendingMoveContext {
  cutText: string;
  cutOffset: number;
  timestamp: number;
}

export interface LspDocumentState {
  version: number;
  parseResult: VirtualDocument;
  text: string;
  languageId: string;
  overlay: PendingOverlay | null;
  viewMode: ViewMode;
  cursorState: CursorState | null;
  decorationTimeout: ReturnType<typeof setTimeout> | null;
  isBatchEditing: boolean;
  /** True after autoFoldLines has been sent for this document. Reset on view mode leave from review/changes. */
  autoFoldSent: boolean;
  /** Pending move correlation — set by moveMetadata notification, consumed by next didChange. */
  pendingMove?: PendingMoveContext;
}

export function createLspDocumentState(
  version: number,
  text: string,
  languageId: string,
  parseResult: VirtualDocument,
): LspDocumentState {
  return {
    version, text, languageId, parseResult,
    overlay: null,
    viewMode: 'review',
    cursorState: null,
    decorationTimeout: null,
    isBatchEditing: false,
    autoFoldSent: false,
  };
}
