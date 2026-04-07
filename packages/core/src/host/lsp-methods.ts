/**
 * LSP method-name constants shared between client adapters and server.
 * Prevents typo drift across the `changedown/*` and `textDocument/*` string
 * literals that appear in vscode-lsp-adapter.ts, extension.ts, and server.ts.
 */
export const LSP_METHOD = {
  // ── Standard LSP (textDocument/*) ─────────────────────────
  DID_OPEN: 'textDocument/didOpen',
  DID_CLOSE: 'textDocument/didClose',
  DID_CHANGE: 'textDocument/didChange',

  // ── Client → Server: editor state ─────────────────────────
  /** Cursor move — offset-based; used by all clients (VS Code + website). Drives server-side PEM flush-on-move. */
  CURSOR_MOVE: 'changedown/cursorMove',
  SET_VIEW_MODE: 'changedown/setViewMode',
  FLUSH_PENDING: 'changedown/flushPending',
  SET_DOCUMENT_STATE: 'changedown/setDocumentState',
  UNDO_REDO: 'changedown/undoRedo',
  BATCH_EDIT_START: 'changedown/batchEditStart',
  BATCH_EDIT_END: 'changedown/batchEditEnd',
  UPDATE_SETTINGS: 'changedown/updateSettings',
  SET_CODELENS_MODE: 'changedown/setCodeLensMode',
  PENDING_OVERLAY: 'changedown/pendingOverlay',
  /** Cut+paste correlation metadata — client sends before paste to hint server-side PEM. */
  MOVE_METADATA: 'changedown/moveMetadata',

  // ── Server → Client: notifications ────────────────────────
  DECORATION_DATA: 'changedown/decorationData',
  PENDING_EDIT_FLUSHED: 'changedown/pendingEditFlushed',
  DOCUMENT_STATE: 'changedown/documentState',
  COHERENCE_STATUS: 'changedown/coherenceStatus',
  VIEW_MODE_CHANGED: 'changedown/viewModeChanged',
  CHANGE_COUNT: 'changedown/changeCount',
  ALL_CHANGES_RESOLVED: 'changedown/allChangesResolved',

  // ── Requests (client → server) ─────────────────────────────
  ANNOTATE: 'changedown/annotate',
  GET_CHANGES: 'changedown/getChanges',
  GET_PROJECT_CONFIG: 'changedown/getProjectConfig',
  REVIEW_CHANGE: 'changedown/reviewChange',
  REPLY_TO_THREAD: 'changedown/replyToThread',
  AMEND_CHANGE: 'changedown/amendChange',
  SUPERSEDE_CHANGE: 'changedown/supersedeChange',
  RESOLVE_THREAD: 'changedown/resolveThread',
  UNRESOLVE_THREAD: 'changedown/unresolveThread',
  COMPACT_CHANGE: 'changedown/compactChange',
  COMPACT_CHANGES: 'changedown/compactChanges',
  REVIEW_ALL: 'changedown/reviewAll',
  CONVERT_FORMAT: 'changedown/convertFormat',
} as const;

export type LspMethod = typeof LSP_METHOD[keyof typeof LSP_METHOD];
