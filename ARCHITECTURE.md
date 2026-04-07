# ARCHITECTURE.md — ChangeDown

## Package Dependency Graph

    core (0 internal deps)
      ↑
    docx (imports core)
      ↑
    cli (imports core, docx)
      ↑
    lsp-server (imports core; imports cli for config parsing only)
      ↑
    vscode-extension (LSP protocol to lsp-server; imports core/docx/cli for types only)

Build order: core → docx → cli → lsp-server → vscode-extension
All packages use TypeScript with strict mode. Core emits both CJS (dist/) and ESM (dist-esm/).

## Core Data Flow

    Text input
      │
      ▼
    CriticMarkupParser.parse(text) → VirtualDocument { changes: ChangeNode[] }
      │
      ▼
    Operations (accept-reject, amend, supersede, navigation, tracking, comment)
      │
      ▼
    Renderers (settled-text, committed-text, sidecar views)

Key types:
- ChangeNode — parsed change with ChangeType, ChangeStatus, offsets, metadata
- ChangeType — Insertion | Deletion | Substitution | Highlight | Comment
- ChangeStatus — Proposed | Accepted | Rejected
- VirtualDocument — container for ChangeNode[], provides query methods

## CriticMarkup Syntax

| Type | Syntax | Example |
|------|--------|---------|
| Insertion | `{++text++}` | `{++added text++}` |
| Deletion | `{--text--}` | `{--removed text--}` |
| Substitution | `{~~old~>new~~}` | `{~~before~>after~~}` |
| Highlight | `{==text==}` | `{==highlighted==}` |
| Comment | `{>>text<<}` | `{>>note<<}` |

Highlights can attach comments with no whitespace: `{==text==}{>>comment<<}`

## L2 and L3 Formats

**L2 (on-disk format):** Inline CriticMarkup with footnote metadata. This is the
canonical, persisted format. All files on disk are L2. Footnotes (`[^cn-N]`)
carry author, timestamp, status, and discussion metadata.

**L3 (live editing projection):** L2 with deterministic line anchoring. L3 exists
for editors like VS Code that don't handle interleaved delimiter characters well.
Changes are moved to footnote definitions with `LINE:HASH {edit-op}` anchoring,
and the document body contains clean text.

Key properties of L3:
- Never persisted to disk — exists only during active editing sessions
- Round-trip compatible: L2 → L3 → L2 must be lossless
- Deterministic: same L2 input always produces same L3 output
- Line anchoring uses xxhash of the clean body line content

Conversion: `convertL2ToL3()` in `packages/core/src/operations/l2-to-l3.ts`
Reverse: `convertL3ToL2()` in `packages/core/src/operations/l3-to-l2.ts`

Format detection: `isL3Format()` checks for `FOOTNOTE_L3_EDIT_OP` regex matches
(both in `packages/core/src/footnote-patterns.ts`). This is an O(n) scan — use
`FormatService.getDetectedFormat()` to centralize detection. Do not call `isL3Format()`
directly in hot paths.

L3 advantages for editing:
- Clean body — no interleaved CriticMarkup delimiters to confuse cursor navigation
- Stable anchors — LINE:HASH coordinates survive body edits via matching cascade
- Ghost decorations — deletions rendered as `::before` pseudo-elements, not inline markup

## Projection Model

Projection is the organizing data-flow model for what content a port receives.
It replaces ViewMode as the semantic model inside BaseController and ProjectionService.

Three projections (`Projection` type in `packages/core/src/model/types.ts`):
- **`current`** — text as authored; accepted text in place, markup visible
- **`decided`** — accepted changes resolved, rejected changes removed
- **`original`** — strip all tracked changes, show original text

`ViewMode` (`review` / `changes` / `settled` / `raw`) is the display-layer vocabulary
that maps to Projection + DisplayOptions via `VIEW_MODE_PRESETS` in `types.ts`. ViewMode
remains the vocabulary for the LSP protocol and the VS Code command surface.

`DisplayOptions` (`packages/core/src/host/types.ts`) controls rendering within a
projection: delimiter visibility (`delimiters: 'show' | 'hide'`), per-change-type
visibility, author colors, cursor reveal, author/status/id filters.

`ProjectionService` (`packages/core/src/host/projection-service.ts`) computes and
caches projection results. Cache key is `uri:version:projection:format:display`.
`ProjectionService.get(request)` returns `ProjectionResult` with `text`,
`visibleChanges`, and a pre-built `decorationPlan`. Cache is invalidated on
document close (`invalidate(uri)`).

## Matching Cascade

Six-level matching in `findUniqueMatch()` (`packages/core/src/file-ops.ts`):

1. **Exact** — `text.indexOf(target)` with uniqueness check
2. **Ref-transparent** — Strips `[^cn-N]` footnote refs from both haystack and needle
3. **Normalized** — NFKC unicode normalization
4. **Whitespace-collapsed** — All whitespace runs → single space
5. **Committed-text** — Strips pending proposals (accepted changes stay)
6. **Settled-text** — Strips all CriticMarkup, expands match to cover constructs

Each level is tried only if the previous fails. Returns `UniqueMatch` with index,
length, original text, and flags indicating which level matched.

Critical invariant: never silently normalize confusables (ADR-022/061). The cascade
is diagnostic — it tells you which level matched, it doesn't silently transform input.

## Hexagonal Port Architecture

The core uses a ports-and-adapters (hexagonal) pattern defined in `packages/core/src/host/`.

    ┌─────────────────────────────────────────────────────────┐
    │                    Platform Host                        │
    │  (VS Code extension, website-v2, future hosts)          │
    └──────┬──────────────────────────────────────┬───────────┘
           │ inbound                              │ outbound
    ┌──────▼──────────┐          ┌────────────────▼───────────┐
    │   EditorHost    │          │ DecorationPort             │
    │   (platform →   │          │ PreviewPort                │
    │    controller)  │          │ (controller → platform)    │
    └──────┬──────────┘          └────────────────────────────┘
           │
    ┌──────▼──────────────────────────────────────────────────┐
    │              Core Services                              │
    │  DocumentStateManager · DecorationScheduler             │
    │  TrackingService · ReviewService                        │
    │  NavigationService · CoherenceService                   │
    │  FormatService · ProjectionService                      │
    └──────┬──────────────────────────────────────────────────┘
           │ service dependency
    ┌──────▼──────────┐
    │  LspConnection   │
    │  (typed LSP I/O) │
    └─────────────────┘

**Inbound port — `EditorHost`:** Platform adapter that feeds editor events (text
changes, cursor moves, config changes) into the controller. VS Code implements this;
website-v2 implements `WebsiteEditorHost`.

**Outbound ports — `DecorationPort`, `PreviewPort`:** Controller pushes decoration
plans and preview HTML through these. Each platform provides its own adapter (e.g.,
`WebDecorationAdapter`, `WebPreviewAdapter` in website-v2).

**Core services** (`packages/core/src/host/services/`): `TrackingService`,
`ReviewService`, `NavigationService` — platform-agnostic business logic that any
host can compose.

**Host adapters in practice:**
- VS Code extension — `BaseController` + `VsCodeEditorHost` + `VsCodeDecorationAdapter`
- website-v2 — reference implementation; `WebsiteController` composes all ports and services
- Future hosts (Sublime, Neovim) — implement EditorHost + outbound port adapters

## BaseController SDK

`BaseController` (`packages/core/src/host/base-controller.ts`) is implemented and
in use by all current hosts.

Key design:
- **Composition, not inheritance** — hosts pass `ControllerConfig`, no subclassing required
- **LSP is optional** — `lsp?: TypedLspConnection`; omit for standalone mode (uses `NULL_LSP_CONNECTION`)
- **FormatAdapter is required** — `formatAdapter: FormatAdapter` is the only mandatory pluggable dep
- **`ControllerHooks`** — lifecycle callbacks (`onWillOpenDocument`, `onDidCrystallize`, etc.)

`setViewMode()` is a `@deprecated` facade on `BaseController`. Use `setProjection()` +
`setDisplay()` for new code.

`TypedLspConnection` (`packages/core/src/host/types.ts`) is the typed interface that
BaseController and services consume. Platform adapters wrap their native LSP client
to implement it. Includes `convertFormat(uri, text, targetFormat)` for LSP-mediated
format conversion.

`DocumentUri` (`packages/core/src/host/uri.ts`) is a branded `string` type. All
per-document Maps in BaseController use `UriMap<T>` (keyed by `DocumentUri`) to
prevent raw string/URI confusion.

## Extension Architecture

**Controller** (`packages/vscode-extension/src/controller.ts`, ~1,130 lines):
State machine managing tracking mode, view mode, edit boundary detection, and
cursor position. Decomposed from ~2,750 lines via extraction of 8 managers into
core services and the hexagonal port layer. See `packages/vscode-extension/AGENTS.md`
for the full state field inventory and event handler chain.

Key files by role:
- `extension.ts` — entry point, registers commands and activates controller
- `controller.ts` — state machine: tracking, view mode, events, pending edits
- `lsp-client.ts` — LSP connection, notification handlers, decoration cache
- `decorator.ts` — 17 `TextEditorDecorationType` instances, applies decoration plans
- `review-panel.ts` — webview panel with accept/reject controls and discussion threads

Key state groups:
- **Tracking & view** — `_trackingMode`, `_viewMode`, `_showDelimiters`
- **Document shadow** — `documentShadow` (Map<uri, string>) for deletion detection
- **Edit boundary** — `pendingEditManager` wraps core `EditBoundaryState`
- **Projected view** — `projectedView` manages buffer swap for settled/raw modes
- **Per-document** — `convertingUris`, `nextScIdMap`, `userTrackingOverrides`, `documentStates`
- **Cursor** — `lastCursorOffsets`, `cursorPositionSender` (for CodeLens)

Core services consumed by the controller: `DocumentStateManager`, `DecorationScheduler`,
`TrackingService`, `ReviewService`, `NavigationService` — all from `packages/core/src/host/`.

## L2 ↔ L3 Lifecycle

L3 is an in-memory projection that exists only during active editing. The LSP
server owns promotion (L2→L3) and the extension/application owns demotion
(L3→L2 on save).

### Promotion (L2 → L3)

Automatic on file open if the document has tracked changes.

    File opens in VS Code
        ↓
    LSP onDidOpen → parse L2, find changes
        ↓
    convertL2ToL3(text) → L3 text with LINE:HASH anchors
        ↓
    Parse L3 → cache, send decorationData (pre-cache for instant render)
        ↓
    Send promotionStarting notification → extension sets convertingUris guard
        ↓
    workspace.applyEdit() → replace buffer with L3
        ↓
    promotingUris guard suppresses echo re-parse
        ↓
    Send promotionComplete → extension clears guard, refreshes decorations

**Guards:**
- `promotingUris` (LSP) — suppresses re-parse of the echo didChange
- `batchEditUris` (LSP) — suppresses re-promotion during multi-file batch ops
- `suppressRepromotionAfterDiskRevert` (LSP) — prevents re-promoting after "Don't Save" close
- `convertingUris` (extension) — suppresses tracking during promotion/demotion

### Demotion (L3 → L2)

Not automatic — the application is responsible for calling `convertL3ToL2()` before
writing to disk. In the extension, this happens in `onWillSaveTextDocument`.

    User saves (Ctrl+S)
        ↓
    Extension flushes pending edits
        ↓
    convertL3ToL2(L3text) → L2 with inline CriticMarkup restored
        ↓
    WorkspaceEdit replaces buffer with L2 (convertingUris guard active)
        ↓
    File written to disk as L2

### L3 Format Example

L2 on disk:
```
The team {++new ++}[^cn-1]prototype last week.

[^cn-1]: @alice | 2026-03-16 | ins | proposed
```

L3 in memory:
```
The team new prototype last week.

[^cn-1]: @alice | 2026-03-16 | ins | proposed
    1:a3f {++new ++}
```

Body is clean (no delimiters, no refs). Each footnote's first body line is
`    LINE:HASH {edit-op}` where LINE is 1-indexed and HASH is xxhash of the
clean body line. The matching cascade (`findUniqueMatch()`) re-locates changes
during L3→L2 conversion even if the body has been edited.

### Round-Trip Invariant

L2 → L3 → L2 must be lossless. This is enforced by:
- All metadata lives in footnote headers (preserved verbatim)
- Discussion lines preserved as continuation lines
- `findUniqueMatch()` 6-level cascade re-locates changes in the body
- Status determines body text state (accepted insertions stay, rejected removed)

## Accept/Reject Flow

End-to-end trace from user action to rendered result.

    User: Command palette / CodeLens / Review Panel → Accept or Reject
        ↓
    Extension: acceptChangeAtCursor() → optional QuickPick for reason
        ↓
    Extension: sendLifecycleRequest('changedown/reviewChange', {
        uri, changeId, decision, reason
    })
        ↓
    LSP: handleReviewChange() → getDocumentText(uri)
        ↓
    Core: applyReview(text, changeId, decision, reason, author)
        ├─ Find footnote block for changeId
        ├─ Insert review line: "    approved: @author date "reason""
        ├─ Update footnote header status (proposed → accepted/rejected)
        ├─ Cascade to children if grouped change
        └─ Return updatedContent
        ↓
    LSP: optional auto-settle (applyAcceptedChanges / applyRejectedChanges)
        ↓
    LSP: return fullDocumentEdit → extension applies via workspace.applyEdit()
        ↓
    LSP: re-parse on didChange → sendDecorationData → extension refreshes decorations

**Bulk operations** (`reviewAll`): sorted in reverse document order (highest offset
first) to prevent offset invalidation. Single auto-settle pass at the end.

**Key detail**: The primary accept/reject path uses `applyReview()` (footnote-level
metadata manipulation), NOT `computeAccept/Reject()` (low-level text edit primitives
used by settled-text rendering).

## OperationResult Structured Edits

Operations return `OperationResult` (`packages/core/src/host/types.ts`):

```ts
interface OperationResult {
  requiredEdits: readonly StructuredEdit[];   // ALL must be applied atomically
  resultingProjection: ProjectionResult;
  affectedChangeIds: readonly string[];
  sourceVersion: number;
}

interface StructuredEdit {
  edit: RangeEdit;
  region: 'body' | 'footnote' | 'footnote-definition';
  role?: 'insertion' | 'deletion' | 'anchor' | 'metadata';
  changeId?: string;
}
```

All edits in `requiredEdits` must be applied atomically for document coherence.
Partial application leaves the document in an inconsistent state.

## Edit Boundary State Machine

The edit boundary groups rapid keystrokes into single tracked changes.

    User types character
        ↓
    onDidChangeTextDocument fires
        ↓
    Selection-confirmation gate:
        Deletions auto-confirm
        Insertions/substitutions → queue unconfirmedTrackedEdit, 50ms timeout
        ↓
    onDidChangeTextEditorSelection fires (1-5ms later)
        Confirms pending edit → handleTrackedEdits()
        ↓
    PendingEditManager.handleEdit() → core processEvent()
        Returns effects: updatePendingOverlay | crystallize | mergeAdjacent
        ↓
    crystallize: wrap text in {++...++}, {--...--}, or {~~...~~}
        Apply edit to document, emit footnote (L3)

**Crystallization flow:** `PendingEditManager` (`packages/core/src/host/pending-edit-manager.ts`)
wraps the core state machine. `processEvent(state, event)` returns effects: `crystallize`
(wrap in CriticMarkup + emit footnote), `mergeAdjacent` (extend existing change), or
`updatePendingOverlay` (send preview to extension). On crystallization, the server
sends a `pendingEditFlushed` notification and the extension applies the edit.

**Flush triggers:**
- Cursor moves outside pending range (`shouldFlushOnCursorMove`)
- Safety-net timer exceeds `pauseThresholdMs` (default 30s, 0 = disabled)
- Document save
- Tracking mode toggled off (abandons pending, does not crystallize)
- Manual flush via `changedown/flushPending` notification
- Explicit request from user or agent

## State Hygiene Invariants

Six rules that must hold at all times for format-aware document processing:

1. **Format detection on open** — call `FormatService.getDetectedFormat()` on every `onDidOpenDocument`
2. **Format-aware parsing** — use `parseForFormat()` which selects L2 vs L3 parser; never hardcode parser
3. **Projection reflects current format** — `ProjectionSelector.format` must match `DocumentState.format`
4. **No stale format cache** — `FormatService.remove(uri)` on document close; detect on reopen
5. **PEM uses format-aware crystallization** — `PendingEditManager` context must carry correct `documentFormat`
6. **Format re-detect on large changes** — if `totalChangeLength > text.length * 0.5`, re-run format detection (BaseController enforces this in `handleContentChange`)

## State Synchronization Protocol

The LSP server and extension maintain synchronized state via notifications.

### Server → Client

| Notification | Payload | Trigger |
|---|---|---|
| `decorationData` | `ChangeNode[]` | parse complete (debounced 60ms) |
| `changeCount` | counts by type | same as decorationData |
| `allChangesResolved` | uri | when total changes = 0 |
| `documentState` | tracking + viewMode | doc open, header change, config change |
| `viewModeChanged` | uri + viewMode | view mode confirmation |
| `pendingEditFlushed` | uri + range + newText | pending edit crystallizes |
| `promotionStarting` | uri | before L2→L3 buffer replace |
| `promotionComplete` | uri | after L2→L3 success or failure |

### Client → Server

| Notification | Payload | Purpose |
|---|---|---|
| `trackingEvent` | type + offset + text | route to pending edit manager |
| `batchEditStart` / `batchEditEnd` | uri | suppress re-promotion during batch |
| `flushPending` | uri | hard break: crystallize pending |
| `updateSettings` | reviewerIdentity | update attribution |
| `pendingOverlay` | uri + overlay | in-flight insertion preview |
| `setViewMode` | uri + viewMode | view mode change |
| `cursorPosition` | uri + line + changeId | cursor-gated CodeLens |
| `setCodeLensMode` | mode | user preference (cursor/always/off) |

### Custom Requests (client → server, expects response)

| Request | Purpose | Core function |
|---|---|---|
| `getChanges` | fetch parsed ChangeNode[] | `getMergedChanges` |
| `reviewChange` | accept/reject one change | `applyReview` |
| `reviewAll` | bulk accept/reject | `applyReview` (loop) |
| `amendChange` | modify change text | `computeAmendEdits` |
| `supersedeChange` | replace change | `computeSupersedeResult` |
| `replyToThread` | add discussion comment | `computeReplyEdit` |
| `resolveThread` / `unresolveThread` | thread resolution | `computeResolutionEdit` |
| `compactChange` | compact change level | `compactToLevel1/0` |
| `annotate` | git-based annotation | `annotateMarkdown` |
| `getProjectConfig` | read config | project config state |
| `convertFormat` | L2↔L3 conversion | `FormatService.promoteToL3/demoteToL2` |

## Decoration Pipeline

Core (`packages/core/src/host/decorations/`) owns plan building; platforms own rendering.

    LSP server: parse → ChangeNode[] → sendDecorationData notification
        ↓
    Extension lsp-client: cache in decorationCache Map
        ↓
    Controller: scheduleDecorationUpdate (50ms debounce)
        ↓
    Core: buildDecorationPlan(changes, viewMode, text, showDelimiters)
        → DecorationPlan with offset ranges for each decoration kind
        ↓
    Core: applyPlan(target: DecorationTarget, plan)
        DecorationTarget is per-editor — VS Code wraps TextEditor, website wraps DOM
        ↓
    Platform adapter: editor.setDecorations() or DOM class updates

`VIEW_MODE_VISIBILITY` constant (`packages/core/src/host/decorations/styles.ts`)
drives which decoration kinds are visible in each view mode.

View modes:
- **review** — full CriticMarkup visible with type coloring
- **changes** (simple) — delimiters hidden, cursor-reveal on hover
- **settled** — projected view, accepted text only, read-only buffer
- **raw** — projected view, original text only, read-only buffer

Ghost decorations (L3 only): deletions rendered as `::before` pseudo-elements with
strikethrough styling. The editor body shows clean text; deleted content appears as
translucent ghost text at the deletion point.

## CLI and Engine Layer

**Two bin entries** from `packages/cli` (`changedown` npm package):
- `cdown` — main agent + user CLI; routes to git diff driver / user commands / agent commands
- `changedown` — init wizard only (`changedown init`)

**Three-path routing in `cdown`:** git diff driver (7-arg detection) → user commands (Commander, `status|list|diff|…`) → agent commands (`runAgentCommands()` → `runCommand()`).

**Engine layer** (`packages/cli/src/engine/`, exported as `changedown/engine`) is the shared contract consumed by both `cdown` and the MCP server. Key components:

- **Handler signature contract:** All 16 engine handlers share:
  `(args: Record<string, unknown>, resolver: ConfigResolver, state: SessionState) => Promise<{ content: [...]; isError?: boolean }>`
  This is the MCP tool result format. The CLI wraps it via `handlerToCliResult()`. Adding a new operation: write handler → export from `engine/index.ts` → add to `agent-command-registry.ts` → add to MCP server's `CallToolRequestSchema`.

- **`ConfigResolver`** — Session-scoped, lazy per-file config loader. Walks up to `.changedown/config.toml`, caches by project root, file-watches for live reload. One instance per MCP stdio session; one per `cdown` invocation (disposed after via `resolver.dispose()`).

- **`SessionState`** — Per-session ID counter and hash registry. Tracks `ct-N` allocation per file, manages change groups, records per-line hashes for staleness detection.

- **Protocol mode** (`classic` vs `compact`) is read from `.changedown/config.toml` via `resolveProtocolMode()`. `getListedToolsWithConfig()` selects between `classicProposeChangeSchema` (old_text/new_text) and `compactProposeChangeSchema` (LINE:HASH + CriticMarkup op) at tool-list time. The MCP client sees a different `propose_change` schema depending on the project's config.

**The 6-tool MCP surface** (`engine/listed-tools.ts`): `read_tracked_file`, `propose_change`, `review_changes`, `amend_change`, `list_changes`, `supersede_change`. Additional backward-compat handlers exist (`raw_edit`, `propose_batch`, `respond_to_thread`, etc.) but are not in the listed surface.

**LSP server CLI import** is narrow: only `parseConfigToml` and `DEFAULT_CONFIG` from `changedown/config`. The LSP server does not use engine handlers — all change operations go through `@changedown/core` directly.

## Edit Operations: RangeEdit vs OffsetEdit

Two coordinate systems coexist:

- **RangeEdit** — LSP native, 0-indexed line/character pairs. Used by the LSP
  protocol, VS Code APIs, and editor-facing code. Carried in `TextEdit` objects.
- **OffsetEdit / OffsetContentChange** — Byte offsets into the document string.
  Used by the core parser, operations, and the matching cascade.

Conversion: `transformRange()` in `packages/core/src/host/range-transform.ts`
converts between the two.

## Key Invariants

These must remain true across all changes:

1. Parser is single-pass O(n). No multiple passes.
2. Status fallback: `node.metadata?.status ?? node.inlineMetadata?.status ?? node.status`
3. No silent confusable normalization. Diagnostic detection only.
4. L2 → L3 → L2 round-trip is lossless.
5. `hiddenObj` decorator uses `textDecoration: 'none; display: none;'` — load-bearing CSS.
6. Edit boundary: `pauseThresholdMs=0` means "disable timer" (core guard checks `> 0`).
7. Extension communicates with core through LSP, not direct import, for change operations.
8. `isL3Format()` is O(n). Use `FormatService.getDetectedFormat()` to centralize detection.
9. All `OperationResult.requiredEdits` must be applied atomically.
