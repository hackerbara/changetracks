# Core Package — @changedown/core

CriticMarkup parser, operations engine, data structures, and matching cascade.
Zero internal dependencies. Foundation consumed by all other packages.

## Build & Test

    npm run build -w @changedown/core       # Build CJS + ESM
    npm run test:core                          # Vitest (from root)
    cd packages/tests && npx vitest run core/  # Direct vitest

Output: `dist/` (CommonJS), `dist-esm/` (ESM)

## Source Layout

    src/
    ├── parser/           CriticMarkupParser, FootnoteNativeParser, code-zones
    ├── operations/       accept-reject, amend, supersede, L2↔L3, navigation, tracking
    ├── model/            ChangeNode, VirtualDocument, ChangeType, ChangeStatus, Projection
    ├── edit-boundary/    State machine for grouping keystrokes into tracked edits
    ├── annotators/       Markdown and sidecar annotation
    ├── renderers/        Settled-text, committed-text rendering
    ├── providers/        Change provider interface
    ├── config/           Configuration types
    ├── host/             Platform-agnostic host services (BaseController SDK)
    ├── file-ops.ts       findUniqueMatch() — 6-level matching cascade
    ├── footnote-*.ts     Footnote parsing, patterns, utilities
    ├── hashline.ts       LINE:HASH anchoring for L3 format
    └── index.ts          Main exports

## Key Entry Points

- `CriticMarkupParser.parse(text)` → `VirtualDocument` — L2 format (inline markup)
- `FootnoteNativeParser` — L3 format (footnote-native with LINE:HASH)
- `findUniqueMatch(text, target)` → `UniqueMatch` (6-level cascade)
- `convertL2ToL3()` / `convertL3ToL2()` — format conversion
- `applyReview()` — accept/reject with footnote metadata
- `computeAccept()` / `computeReject()` — low-level text edit primitives

## Host Services (L3 SDK)

`packages/core/src/host/` contains the platform-agnostic host integration layer.
Exported from `@changedown/core/host`.

### BaseController

`base-controller.ts` — composition-based host integration. Hosts instantiate with
`ControllerConfig`; no subclassing. LSP is optional (`lsp?: TypedLspConnection`);
omit to use `NULL_LSP_CONNECTION` for standalone mode. `FormatAdapter` is required.

Key public methods:
- `setProjection(projection)` / `setDisplay(display)` — new API
- `setViewMode(mode)` — deprecated facade, maps to setProjection+setDisplay
- `getChangesForUri(uri)` / `getAuthoredChanges(uri)` — curated change accessors
- `formatService`, `projectionService` — exposed as public fields for host use

### FormatService

`format-service.ts` — per-URI format state (L2/L3) with caching.

- `getDetectedFormat(uri, text)` — calls `isL3Format(text)` (O(n) regex scan) and
  centralizes detection. Use this instead of calling `isL3Format()` directly.
- `getPreferredFormat(uri)` / `setPreferredFormat(uri, format)` — user override
- `promoteToL3(uri, text)` / `demoteToL2(uri, text)` — via `FormatAdapter`
- Events: `onDidChangePreferredFormat`, `onDidCompleteTransition`

### ProjectionService

`projection-service.ts` — projection computation and caching.

- `get(request: ProjectionRequest)` — returns `ProjectionResult` with `text`,
  `visibleChanges`, `decorationPlan`; cached by `uri:version:projection:format:display`
- `getPreset(source, preset)` — convenience for `current` / `decided` / `original`
- `invalidate(uri)` — evict all cached results for a URI (call on document close)

Projection types (`Projection` in `model/types.ts`): `current` | `decided` | `original`

### PendingEditManager

`pending-edit-manager.ts` — owns one `EditBoundaryState` per URI, allocates scId,
manages safety-net timer, guards against feedback-loop echoes.

**This is the canonical location.** `@changedown/lsp-server` imports from
`@changedown/core/host`. The lsp-server's own `src/pending-edit-manager.ts` is a
legacy copy that will be removed in a future cleanup.

Key methods:
- `handleChange(uri, type, offset, text, deletedText, documentText)` — process edit event
- `handleCursorMove(uri, offset, documentText)` — may flush pending edit
- `flush(uri)` / `flushAll()` — force crystallize
- `abandon(uri)` — drop pending buffer without crystallizing (undo/redo guard)
- `expectEcho(uri)` / `consumeEcho(uri)` — feedback-loop guards

### L3 Operations (SDK surface)

- **Format conversion** — `FormatService.promoteToL3()` / `demoteToL2()` (via FormatAdapter)
- **Anchor inspection** — `isGhostNode(change)` identifies unresolved L3 anchors
- **Anchor repair** — round-trip L3→L2→L3 via `FormatService.demoteToL2` + `promoteToL3`

## L2 ↔ L3 Conversion

**L2→L3** (`operations/l2-to-l3.ts`): Parse L2 with CriticMarkupParser →
strip all CriticMarkup from body (reverse order) → compute line:hash anchors
→ inject `    LINE:HASH {edit-op}` as first body line of each footnote.

**L3→L2** (`operations/l3-to-l2.ts`): Parse L3 with FootnoteNativeParser →
extract LINE:HASH from footnotes → `findUniqueMatch()` to locate body position
→ re-insert CriticMarkup inline (reverse order) → strip edit-op lines.

**Format detection:** `isL3Format(text)` in `footnote-patterns.ts` auto-detects.
**Use `FormatService.getDetectedFormat()` in hot paths** — `isL3Format()` is O(n).

**L3 edit-op regex:** `FOOTNOTE_L3_EDIT_OP = /^ {4}(\d+):([0-9a-fA-F]{2,}) (.*)/`

## Accept/Reject Operations

Two distinct paths:

**`applyReview()`** (`operations/apply-review.ts`) — used by LSP accept/reject flow:
- Finds footnote block for changeId
- Inserts review line (approved/rejected + author + timestamp + reason)
- Updates footnote header status (proposed → accepted/rejected)
- Cascades to children if grouped change
- Returns updated file content

**`computeAccept/Reject()`** (`operations/accept-reject.ts`) — low-level primitives:
- Returns TextEdit for inline markup transformation
- Used by settled-text rendering and some test scenarios
- NOT used by the main accept/reject user flow

## Matching Cascade

`findUniqueMatch()` in `file-ops.ts` — 6 levels, each tried only if previous fails:
1. Exact → 2. Ref-transparent → 3. NFKC normalized → 4. Whitespace-collapsed
→ 5. Committed-text → 6. Settled-text

Critical for L3→L2 conversion: re-locates changes even after body edits.

## Edit Boundary State Machine

`edit-boundary/` — groups keystrokes into tracked changes. Exported separately
as `@changedown/core/edit-boundary`. Key function: `processEvent(state, event)`
returns effects (crystallize, mergeAdjacent, updatePendingOverlay). Used by both
the extension's PendingEditManager and the LSP server's PendingEditManager.

## Exports

Four export paths:
- `.` — public API (parser, operations, types)
- `./internals` — internal utilities for LSP/extension
- `./edit-boundary` — edit boundary state machine
- `./host` — BaseController, FormatService, ProjectionService, PendingEditManager,
  TypedLspConnection, EditorHost, DecorationPort, Projection, DisplayOptions,
  DocumentUri, UriMap, NULL_LSP_CONNECTION, and all host service types
