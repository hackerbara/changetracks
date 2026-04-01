// packages/core/src/host/types.ts
import type { ChangeNode } from '../model/types.js';

// ── Event System ───────────────────────────────────────────

export interface Disposable {
  dispose(): void;
}

export interface Event<T> {
  (listener: (e: T) => void): Disposable;
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  readonly event: Event<T> = (listener) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
      },
    };
  };

  fire(value: T): void {
    // Iterate a snapshot so self-disposing listeners don't skip subsequent ones
    for (const listener of [...this.listeners]) listener(value);
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ── LSP-Native Content Change ──────────────────────────────
// 0-indexed lines and characters, matching LSP protocol.
// NOTE: ContentChange intentionally mirrors TextDocumentContentChangeEvent from
// vscode-languageserver-protocol without importing it, to keep @changedown/core/host
// free of LSP protocol dependencies. Do not "fix" this by importing the LSP type.
// Each host converts from its editor's format BEFORE firing events.

export interface ContentChange {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  rangeLength: number;
  text: string;
}

// ── View Mode ──────────────────────────────────────────────

export type ViewMode = 'review' | 'changes' | 'settled' | 'raw';

// ── Document State ─────────────────────────────────────────
// Pure data bag. No behavior, no platform deps.

export interface DocumentState {
  uri: string;
  version: number;
  text: string;
  cachedChanges: ChangeNode[];
  cacheVersion: number;

  // Per-URI LSP state (mirrors what the server reports)
  lspViewMode?: ViewMode;
  trackingState?: { enabled: boolean; source: string };

  // L3 phase stubs
  shadow?: string;
  nextScId?: number;
}

// ── Document Snapshot ──────────────────────────────────────
// Pushed to RenderPort. Contains document data only.
// Host adds rendering context (showDelimiters, cursor, theme)
// when processing the snapshot.

export interface DocumentSnapshot {
  uri: string;
  text: string;
  viewMode: ViewMode;
  changes: ChangeNode[];
  showDelimiters?: boolean;
  cursorOffset?: number;
}

// ── Status Info ────────────────────────────────────────────

export interface StatusInfo {
  changeCount?: number;
  coherenceRate?: number;
  unresolvedCount?: number;
}

// ── LspConnection (service dependency) ────────────────────
// Services depend on this, not on ProtocolConnection directly.
// Each platform provides its own implementation.

export interface LspConnection {
  sendRequest<R>(method: string, params: unknown): Promise<R>;
  sendNotification(method: string, params: unknown): void;
  onNotification(method: string, handler: (params: unknown) => void): Disposable;
}

// ── Review Result ─────────────────────────────────────────

export interface ReviewResult {
  uri: string;
  success: boolean;
  edits?: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>;
  error?: string;
  refreshDecorations?: boolean;
}

// ── EditorHost (platform → controller) ─────────────────────
// NOTE: EditorHost has no onDidOpenDocument event. The website controller uses
// onDidChangeActiveDocument to trigger openDocument(). This conflates "active document
// changed" with "document opened", which works for single-document hosts like the
// website. Multi-document hosts (e.g., VS Code with split editors) would need a
// separate onDidOpenDocument event — add it when extracting BaseController in Phase 3.
//
// All types are LSP-native. Host converts from editor format before firing events.

export interface EditorHost {
  onDidCloseDocument: Event<{ uri: string }>;
  onDidChangeContent: Event<{
    uri: string;
    text: string;
    version: number;
    changes: ContentChange[];
    isEcho: boolean;
  }>;
  onDidChangeActiveDocument: Event<{ uri: string; text?: string } | null>;
  onDidChangeCursorPosition: Event<{ uri: string; offset: number }>;
  onDidChangeViewMode: Event<{ viewMode: ViewMode }>;

  getDocumentText(uri: string): string;
  applyEdits(uri: string, edits: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>): void;

  // L3 stubs
  enterProjectedView?(uri: string, computedText: string): void;
  exitProjectedView?(uri: string, originalText: string): void;
}

// ── RenderPort (controller → platform) ─────────────────────
// Minimal interface. Host decides which surfaces to update
// and adds rendering context when processing snapshots.

export interface RenderPort {
  updateDocument(snapshot: DocumentSnapshot): void;
  clearDocument(uri: string): void;
}
