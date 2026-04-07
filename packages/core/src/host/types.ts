// packages/core/src/host/types.ts
import type { ChangeNode, PendingOverlay, ChangeStatus, Projection } from '../model/types.js';
import type { DecorationPlan } from './decorations/types.js';
import type { SupersedeResult } from '../operations/supersede.js';
export type { ChangeNode, PendingOverlay, SupersedeResult, Projection };
import type { ViewMode } from '../renderers/three-zone-types.js';

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
  /** Pre-computed offset. When present, skip range→offset conversion. */
  rangeOffset?: number;
}

/** Edit in line/character coordinates — SDK surface and LSP protocol. */
export interface RangeEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

/** Edit in byte-offset coordinates — core internal operations. */
export interface OffsetEdit {
  offset: number;
  length: number;
  newText: string;
}

/** Proof that an applyEdits call landed correctly. */
export interface ApplyEditResult {
  applied: boolean;
  text: string;
  version: number;
}

// ── View Mode ──────────────────────────────────────────────

export type { ViewMode } from '../renderers/three-zone-types.js';

// ── Document State ─────────────────────────────────────────
// Pure data bag. No behavior, no platform deps.

export interface DocumentState {
  uri: string;
  version: number;
  text: string;
  cachedChanges: ChangeNode[];
  cacheVersion: number;
  format: 'L2' | 'L3';

  // Cursor
  cursorOffset?: number;
}

// ── Document Snapshot ──────────────────────────────────────
// Pushed to DecorationPort and PreviewPort. Contains document data only.
// Host adds rendering context (showDelimiters, cursor, theme)
// when processing the snapshot.

export interface DocumentSnapshot {
  uri: string;
  sourceVersion: number;
  text: string;
  changes: ChangeNode[];
  format: 'L2' | 'L3';
  view: View;
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

// ── TypedLspConnection (extends base for typed methods) ───
// BaseController and services consume this interface.
// Each host adapter wraps its platform LSP client.

export interface TypedLspConnection extends LspConnection {
  // Document lifecycle
  sendDidOpen(uri: string, text: string, languageId?: string): void;
  sendDidClose(uri: string): void;
  sendDidChange(uri: string, changes: ContentChange[]): void;
  sendDidChangeFullDoc(uri: string, text: string): void;

  // Editor state
  sendCursorMove(uri: string, offset: number): void;
  sendViewMode(uri: string, viewMode: ViewMode): void;
  sendFlushPending(uri: string): void;

  // Tracking
  sendSetDocumentState(uri: string, state: { tracking: { enabled: boolean } }): void;

  // Move metadata
  sendMoveMetadata(uri: string, cutText: string): void;

  // Lifecycle requests
  reviewChange(uri: string, changeId: string, decision: 'approve' | 'reject' | 'request_changes', reason?: string): Promise<ReviewResult>;
  amendChange(uri: string, changeId: string, newText: string): Promise<ReviewResult>;
  supersedeChange(uri: string, changeId: string, newText: string, reason?: string): Promise<SupersedeResult>;
  compactChange(uri: string, changeId: string, fully?: boolean): Promise<ReviewResult>;
  reviewAll(uri: string, decision: string, changeIds?: string[]): Promise<ReviewResult>;

  // Format conversion
  /** Request format conversion from LSP server. */
  convertFormat(uri: string, text: string, targetFormat: 'L2' | 'L3'): Promise<{ convertedText: string; newFormat: 'L2' | 'L3' }>;

  // Inbound notifications
  onDecorationData(handler: (data: { uri: string; changes: ChangeNode[]; documentVersion: number; autoFoldLines?: number[] }) => void): Disposable;
  onPendingEditFlushed(handler: (data: { uri: string; edits: RangeEdit[] }) => void): Disposable;
  onDocumentState(handler: (data: { uri: string; tracking: { enabled: boolean; source: string }; viewMode: ViewMode }) => void): Disposable;
  onOverlayUpdate(handler: (data: { uri: string; overlay: PendingOverlay | null }) => void): Disposable;
}

// ── Review Result ─────────────────────────────────────────

export interface ReviewResult {
  uri: string;
  success: boolean;
  edits?: RangeEdit[];
  error?: string;
  refreshDecorations?: boolean;
}

// ── EditorHost (platform → controller) ─────────────────────
// All types are LSP-native. Host converts from editor format before firing events.

export interface EditorHost {
  // Document lifecycle
  readonly onDidOpenDocument: Event<{ uri: string; text: string }>;
  readonly onDidCloseDocument: Event<{ uri: string }>;
  readonly onDidSaveDocument: Event<{ uri: string }>;

  // Content
  readonly onDidChangeContent: Event<{
    uri: string;
    text: string;
    version: number;
    changes: ContentChange[];
    isEcho: boolean;
  }>;

  // Editor state
  readonly onDidChangeActiveDocument: Event<{ uri: string; text?: string } | null>;
  readonly onDidChangeCursorPosition: Event<{ uri: string; offset: number }>;

  // Required methods
  getDocumentText(uri: string): string;

  // Optional capabilities
  applyEdits?(uri: string, edits: RangeEdit[]): Promise<ApplyEditResult>;
  showOverlay?(uri: string, overlay: PendingOverlay): void;
  clearOverlay?(uri: string): void;
}

// ── Rendering Ports (controller → platform) ──────────────────
// Each port represents a rendering surface. Hosts implement only
// the ports they have. Platform-specific lifecycle methods
// (attachEditor, setContainer, etc.) live on the adapter class.

export interface DecorationPort extends Disposable {
  update(snapshot: DocumentSnapshot): void;
  clear(uri?: string): void;
}

export interface PreviewPort extends Disposable {
  update(snapshot: DocumentSnapshot): void;
  clear(uri?: string): void;
}

// ─── Projection Model (L3 SDK) ────────────────────────────────────

/** Selects which projection to compute. */
export interface ProjectionSelector {
  readonly format: 'L2' | 'L3';
  readonly projection: Projection;
  readonly compacted?: boolean;
}

/** Controls how changes are rendered within a projection. */
export interface DisplayOptions {
  readonly insertions?: 'inline' | 'ghost' | 'hide';
  readonly deletions?: 'inline' | 'ghost' | 'strikethrough' | 'hide';
  readonly substitutions?: 'inline' | 'ghost' | 'hide';
  readonly highlights?: 'inline' | 'ghost' | 'hide';
  readonly comments?: 'inline-marker' | 'badges-only' | 'hide';
  readonly delimiters?: 'show' | 'hide';
  readonly footnoteRefs?: 'show' | 'hide';
  readonly footnotes?: 'show' | 'dimmed' | 'hide';
  readonly authorColors?: 'auto' | 'always' | 'never';
  readonly cursorReveal?: boolean;
  readonly authorFilter?: readonly string[];
  readonly statusFilter?: readonly ChangeStatus[];
  readonly changeIdFilter?: readonly string[];
}

/** A named viewing configuration combining projection and display. */
export interface View {
  /** Identity for UI labels, theming hooks, CSS scoping (data-view-name). */
  readonly name: string;
  /** Which changes are in play. */
  readonly projection: Projection;
  /** How changes render — composable options. */
  readonly display: DisplayOptions;
}

/** The five canonical view preset names. */
export type BuiltinView = 'review' | 'simple' | 'final' | 'original' | 'raw';

/** Input to a projection computation. */
export interface ProjectionSource {
  readonly uri: string;
  readonly text: string;
  readonly changes: readonly ChangeNode[];
  readonly sourceVersion: number;
  readonly sourceFormat: 'L2' | 'L3';
}

/** Output of a projection computation. */
export interface ProjectionResult {
  readonly request: ProjectionRequest;
  readonly sourceVersion: number;
  readonly text: string;
  readonly visibleChanges: readonly ChangeNode[];
  readonly decorationPlan: DecorationPlan;
}

/** Full projection request (source + selector + display). */
export interface ProjectionRequest {
  readonly source: ProjectionSource;
  readonly selector: ProjectionSelector;
  readonly display: DisplayOptions;
}

/** Canonical view presets. Hosts can construct arbitrary View objects beyond these. */
export const VIEW_PRESETS: Record<BuiltinView, View> = {
  review: {
    name: 'review',
    projection: 'current',
    display: {
      insertions: 'inline',
      deletions: 'inline',
      substitutions: 'inline',
      highlights: 'inline',
      comments: 'inline-marker',
      delimiters: 'show',
      footnoteRefs: 'show',
      footnotes: 'show',
      authorColors: 'auto',
      cursorReveal: false,
    },
  },
  simple: {
    name: 'simple',
    projection: 'current',
    display: {
      insertions: 'inline',
      deletions: 'hide',
      substitutions: 'inline',
      highlights: 'inline',
      comments: 'hide',
      delimiters: 'hide',
      footnoteRefs: 'hide',
      footnotes: 'hide',
      authorColors: 'auto',
      cursorReveal: false,
    },
  },
  final: {
    name: 'final',
    projection: 'decided',
    display: {
      insertions: 'inline',
      deletions: 'hide',
      substitutions: 'inline',
      highlights: 'hide',
      comments: 'hide',
      delimiters: 'hide',
      footnoteRefs: 'hide',
      footnotes: 'hide',
      authorColors: 'never',
      cursorReveal: false,
    },
  },
  original: {
    name: 'original',
    projection: 'original',
    display: {
      insertions: 'hide',
      deletions: 'inline',
      substitutions: 'inline',
      highlights: 'hide',
      comments: 'hide',
      delimiters: 'hide',
      footnoteRefs: 'hide',
      footnotes: 'hide',
      authorColors: 'never',
      cursorReveal: false,
    },
  },
  raw: {
    name: 'raw',
    projection: 'none',
    display: {
      insertions: 'inline',
      deletions: 'inline',
      substitutions: 'inline',
      highlights: 'inline',
      comments: 'inline-marker',
      delimiters: 'show',
      footnoteRefs: 'show',
      footnotes: 'show',
      authorColors: 'never',
      cursorReveal: false,
    },
  },
};

/** @deprecated Use VIEW_PRESETS instead. */
export const VIEW_MODE_PRESETS: Record<ViewMode, { projection: Projection; display: Partial<DisplayOptions> }> = {
  review: { projection: 'current', display: { insertions: 'inline', deletions: 'inline', substitutions: 'inline', delimiters: 'show' } },
  changes: { projection: 'current', display: { insertions: 'inline', deletions: 'inline', substitutions: 'inline', delimiters: 'hide' } },
  settled: { projection: 'decided', display: {} },
  raw: { projection: 'original', display: {} },
};

/** @deprecated No longer needed — pass View directly. */
export function projectionToViewMode(projection: Projection): ViewMode {
  switch (projection) {
    case 'decided': return 'settled';
    case 'original': return 'raw';
    default: return 'review';
  }
}

/** No-op LspConnection stub for standalone mode. */
export const NULL_LSP_CONNECTION: LspConnection = {
  sendRequest: () => Promise.resolve({} as never),
  sendNotification: () => {},
  onNotification: () => ({ dispose: () => {} }),
};

// ─── Operation Results ────────────────────────────────────────────

/** Structured edit with region and role metadata. */
export interface StructuredEdit {
  readonly edit: RangeEdit;
  /** body = document text, footnote = within existing [^cn-N]: block, footnote-definition = new definition */
  readonly region: 'body' | 'footnote' | 'footnote-definition';
  readonly role?: 'insertion' | 'deletion' | 'anchor' | 'metadata';
  readonly changeId?: string;
}

/** Result of any mutation operation (accept, reject, amend, etc.). */
export interface OperationResult {
  /** ALL edits must be applied for document coherence. */
  readonly requiredEdits: readonly StructuredEdit[];
  readonly resultingProjection: ProjectionResult;
  readonly affectedChangeIds: readonly string[];
  readonly sourceVersion: number;
}

// ─── Port Interfaces ──────────────────────────────────────────────

/** Pluggable format conversion. LspFormatAdapter (v1) proxies to LSP. */
export interface FormatAdapter {
  convertL2ToL3(uri: string, l2Text: string): Promise<string>;
  convertL3ToL2(uri: string, l3Text: string): Promise<string>;
}

/** Pluggable parse delegation. Default: call core parseForFormat directly. */
export interface ParseAdapter {
  parse(uri: string, text: string, format: 'L2' | 'L3'): ChangeNode[];
}

export interface SettlementConfig {
  readonly autoOnApprove?: boolean;
  readonly autoOnReject?: boolean;
}
