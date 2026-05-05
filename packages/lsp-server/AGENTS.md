# LSP Server — @changedown/lsp-server

Language Server Protocol server. Wraps core parser and operations into
LSP capabilities. The extension communicates with core through this server.

## Build & Test

    npm run build -w @changedown/lsp-server   # Build
    npm run test:lsp                             # Vitest (from root)
    cd packages/tests && npx vitest run lsp/     # Direct vitest

Standalone binary: `dist/bin/server.js` → `changedown-lsp`

## Source Layout

    src/
    ├── capabilities/     code-actions, code-lens, diagnostics, document-links, hover, semantic-tokens
    ├── notifications/    decoration-data, document-state, pending-edit, view-mode
    ├── server.ts         Main LSP server — request/notification handlers
    ├── converters.ts     LSP ↔ core type conversion
    ├── git.ts            Git integration utilities
    └── pending-edit-manager.ts  Legacy local copy (see note below)

## PendingEditManager

The LSP server imports `PendingEditManager` from `@changedown/core/host` — the
canonical location after the L3 SDK migration. `src/pending-edit-manager.ts` is a
legacy local copy that pre-dates the migration and will be removed in a future cleanup.

`PendingEditManager` is instantiated in `ChangedownServer` constructor:
```ts
import { PendingEditManager } from '@changedown/core/host';
this.pendingEditManager = new PendingEditManager(onCrystallize, onOverlayChange);
```

## Server State

The `ChangedownServer` class maintains per-document state in Maps:

| Field | Type | Purpose |
|-------|------|---------|
| `parseCache` | Map<uri, VirtualDocument> | Parsed ChangeNode[] per document |
| `textCache` | Map<uri, string> | Document text fallback |
| `overlayStorage` | Map<uri, PendingOverlay> | In-flight insertion preview |
| `viewModeStorage` | Map<uri, ViewMode> | Current view mode (default 'review') |
| `cursorStateStorage` | Map<uri, CursorState> | Cursor line + changeId for CodeLens |
| `promotingUris` | Set<uri> | L2→L3 promotion in flight; suppress echo re-parse |
| `batchEditUris` | Set<uri> | Batch edit active; skip re-promotion |
| `suppressRepromotionAfterDiskRevert` | Set<uri> | Don't Save revert guard |
| `decorationNotifyTimeouts` | Map<uri, timeout> | 60ms debounce for decoration notifications |

All per-URI state cleared on `onDidClose`.

## Document Lifecycle

    OPEN → parse, detect L2 with changes → auto-promote to L3
         → cache parse result, send decorationData + documentState

    CHANGE → if promotingUris: suppress (echo guard)
           → if batchEditUris: parse only, no re-promotion
           → if L2 with changes: re-promote (unless disk revert)
           → else: parse, cache, debounced decoration notify

    CLOSE → clear all per-URI caches and guards

**Sync mode:** `TextDocumentSyncKind.Full` — server receives complete text on every change.

## Parse & Cache

- `parseAndCacheDocument(uri, text, languageId)` → `workspace.parse()` → cache in `parseCache`
- No lazy invalidation — re-parse on every change
- `getMergedChanges(uri)` merges parseCache + overlayStorage (synthetic ChangeNode for in-flight insertion)
- Diagnostics computed on every parse, sent via `connection.sendDiagnostics()`

## Format Detection

The server uses `FormatService` (from `@changedown/core/host`) for per-URI format
detection and caching. `isL3Format()` is O(n); `FormatService.getDetectedFormat()`
centralizes detection. All format detection in the server goes through FormatService.

## L2/L3 Promotion

LSP owns promotion (L2→L3). See ARCHITECTURE.md § L2 ↔ L3 Lifecycle for the
complete flow diagram. Key server-side steps:

1. Detect L2 with changes on `didOpen`
2. `convertL2ToL3(text)` → L3 text
3. Parse L3, send `decorationData` (pre-cache for instant render)
4. Send `promotionStarting` → `workspace.applyEdit()` → send `promotionComplete`
5. `promotingUris` guard suppresses echo re-parse

## convertFormat Request

`handleConvertFormat(params)` handles `changedown/convertFormat` LSP requests:
- Accepts `{ uri, text, targetFormat: 'L2' | 'L3' }`
- Delegates to `FormatService.promoteToL3()` or `demoteToL2()`
- Parses converted text and returns `{ convertedText, newFormat, edits }`
- Used by `TypedLspConnection.convertFormat()` in the extension

## CodeLens Generation

Cursor-gated by default (`codeLensMode: 'cursor'`).

- **cursor mode:** Single row on cursor line. If cursor inside change → Accept/Reject
  for that change. If cursor on line outside changes → Accept All (N) / Reject All (N).
- **always mode:** One row per change with content snippet + lifecycle indicators
  (discussion count, request-changes warning, revision marker).
- **off:** No CodeLens.
- Suppressed in settled/raw view modes.

## Pending Edit Manager

Server-side `PendingEditManager` (imported from `@changedown/core/host`) handles edit
crystallization when tracking events arrive via `changedown/trackingEvent` notification.
Uses core `processEvent()` state machine. Effects: crystallize (wrap in CriticMarkup,
emit `pendingEditFlushed`), mergeAdjacent, updatePendingOverlay. Safety-net timer
auto-flushes at configurable threshold.

## Custom Protocol

See ARCHITECTURE.md § State Synchronization Protocol for the complete
request/notification tables. Key handlers:

**Requests** (return edits): `reviewChange`, `reviewAll`, `amendChange`,
`supersedeChange`, `replyToThread`, `resolveThread`, `unresolveThread`,
`compactChange`, `annotate`, `getChanges`, `getProjectConfig`, `convertFormat`

**Server → Client notifications:** `decorationData` (60ms debounce), `changeCount`,
`allChangesResolved`, `documentState`, `viewModeChanged`, `pendingEditFlushed`,
`promotionStarting`, `promotionComplete`

**Client → Server notifications:** `trackingEvent`, `batchEditStart/End`,
`flushPending`, `updateSettings`, `pendingOverlay`, `setViewMode`,
`cursorPosition`, `setCodeLensMode`

## Dependencies

Imports `@changedown/core` directly. Imports `PendingEditManager` from
`@changedown/core/host`. Uses `vscode-languageserver` (^9.0.1).
Narrow import from CLI: only `parseConfigToml` and `DEFAULT_CONFIG` from `@changedown/cli/config`.

`promotionPolicy` no longer exists — promotion behavior is determined by document
format detection via `FormatService`, not a separate policy object.
