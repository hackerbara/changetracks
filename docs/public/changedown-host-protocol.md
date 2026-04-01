
# ChangeDown Host Protocol Guide

A language-agnostic reference for building editor integrations against the ChangeDown LSP server.

**Audience**: Developers building ChangeDown support for editors or tools in any language.

**Scope**: This guide covers the protocol surface — message names, payloads, sequencing, and required host behavior. It does not duplicate the file format specification.

---

## Part A: Format Reference

### Where to find the spec

The complete file format is defined in `docs/public/changetracks-spec-v2.md`. This section summarizes what a host needs to understand; the spec is the authoritative source.

### CriticMarkup syntax (five change types)

| Type | Syntax | Notes |
|---|---|---|
| Insertion | `text` | Adds content |
| Deletion | `` | Removes content |
| Substitution | `new` | Replaces old with new |
| Highlight | `text` | Marks content for attention |
| Comment | `` | Annotation at anchor point |

### Footnote structure

Each change has a footnote reference in the body (`[^cn-N]`) and a definition:

```
[^cn-1]: @author | YYYY-MM-DD | type | status
    optional discussion and review lines
```

- **Author**: opaque string, conventionally `@name` or `@ai:model-id`
- **Date**: ISO 8601
- **Type**: `ins`, `del`, `sub`, `hig`, `com`
- **Status**: `proposed`, `accepted`, `rejected`

### L2 vs L3

**L2** is the default on-disk format. CriticMarkup delimiters appear inline in the body text. The footnote block carries metadata only.

**L3** is the editor working format. The body is clean prose; all edit operations live as anchored lines in the footnote block (format: `LINE:HASH surrounding-text op more-context`). When a host opens an L2 file with changes, the server automatically promotes it to L3 via a `workspace/applyEdit` request.

L2 and L3 are lossless. The server converts between them transparently.

### Tracking header

Files opt into tracking via a header comment:

```
<!-- changedown.com/v1: tracked -->
```

The absence of this header is not an error. Tracking state is resolved by the server (file header → project config → default: tracked) and reported via `changedown/documentState`.

### The ChangeNode model

The server parses documents into `ChangeNode` objects. A `ChangeNode` carries:

- `id` — string, e.g. `"cn-1"`
- `type` — `"Insertion"` | `"Deletion"` | `"Substitution"` | `"Highlight"` | `"Comment"`
- `status` — `"Proposed"` | `"Accepted"` | `"Rejected"`
- `range` — `{ start: number, end: number }` — byte offsets in the current document
- `contentRange` — byte offsets of the change content only (inside delimiters)
- `originalText` — the original text (deletions, substitutions)
- `modifiedText` — the replacement text (insertions, substitutions)
- `level` — `0` | `1` | `2` — compaction level (2 = full footnote, 1 = inline metadata only, 0 = plain text)
- `anchored` — `true` if a `[^cn-N]` ref exists in the document
- `metadata` — full footnote data: `author`, `date`, `approvals`, `rejections`, `discussion`, `resolution`, etc.

Hosts use `ChangeNode` arrays for decoration rendering. Ghost nodes (internal parser artifacts) are filtered out before delivery.

### The 6-level matching cascade

When the server resolves an anchor it tries these levels in order, stopping at the first unique match:

1. **Exact** — byte-for-byte
2. **Ref-transparent** — strips `[^cn-N]` refs from both sides
3. **NFKC** — Unicode normalization
4. **Whitespace-collapsed** — all whitespace runs → single space
5. **Committed-text** — strips proposed/rejected markup
6. **Decided-text** — strips all CriticMarkup

The cascade is diagnostic: `ChangeNode.resolutionPath` indicates which level succeeded. Unresolvable anchors produce Warning-level `textDocument/publishDiagnostics` entries.

---

## Part B: LSP Protocol Surface

The ChangeDown server communicates over a standard LSP JSON-RPC channel. All custom messages use the `changedown/` prefix.

### Server → Client notifications

These are sent by the server without a client request.

#### `changedown/decorationData`

Sent after every parse (debounced 60 ms). Carries the full `ChangeNode[]` so the host can render decorations without re-parsing.

```json
{
  "uri": "file:///path/to/doc.md",
  "changes": [ /* ChangeNode[] */ ],
  "documentVersion": 5,
  "autoFoldLines": [42, 67]
}
```

- `autoFoldLines` — present only once per document open (when the host should auto-collapse footnote regions). Only sent in `review` or `changes` view mode for L3 documents.

**Host obligation**: cache by `{uri, documentVersion}`. Discard stale notifications where `documentVersion < cached version`.

#### `changedown/changeCount`

Sent alongside `decorationData`. Aggregated counts for status bar or UI badges.

```json
{
  "uri": "file:///path/to/doc.md",
  "counts": {
    "insertions": 3,
    "deletions": 1,
    "substitutions": 2,
    "highlights": 0,
    "comments": 1,
    "total": 7
  }
}
```

#### `changedown/allChangesResolved`

Sent when `counts.total === 0`.

```json
{ "uri": "file:///path/to/doc.md" }
```

Use this to clear review-complete UI state.

#### `changedown/coherenceStatus`

Sent after parse when the coherence rate or unresolved count changes. Coherence rate = fraction of changes with resolved anchors (0–100).

```json
{
  "uri": "file:///path/to/doc.md",
  "coherenceRate": 87,
  "unresolvedCount": 2,
  "threshold": 70
}
```

The server suppresses duplicate notifications (same rate + count as previous send).

#### `changedown/pendingEditFlushed`

Sent when a pending edit crystallizes into CriticMarkup. The host **must** apply both edits atomically as a single workspace edit.

```json
{
  "uri": "file:///path/to/doc.md",
  "edits": [
    {
      "range": { "start": { "line": 4, "character": 12 }, "end": { "line": 4, "character": 18 } },
      "newText": "added text"
    },
    {
      "range": { "start": { "line": 99, "character": 0 }, "end": { "line": 99, "character": 0 } },
      "newText": "\n[^cn-3]: @alice | 2026-03-28 | ins | proposed\n"
    }
  ]
}
```

- For **L2** documents: both edits are non-empty (inline markup + footnote definition).
- For **L3** documents: the first edit is an empty no-op (range is line 0, char 0→0, newText is empty); only the footnote edit is applied.

**Host obligation**: set an echo guard before applying, clear it in a `finally` block. The echo `didChange` this produces must be synced back to the server as a full-document replacement (no-range `contentChange`) to avoid re-triggering crystallization.

#### `changedown/documentState`

Sent on `didOpen`, after header changes, after config changes, and after view mode changes.

```json
{
  "textDocument": { "uri": "file:///path/to/doc.md" },
  "tracking": {
    "enabled": true,
    "source": "file"
  },
  "viewMode": "review"
}
```

- `tracking.source`: `"file"` | `"project"` | `"default"`

#### `changedown/viewModeChanged`

Sent as confirmation after the server processes a `changedown/setViewMode` notification.

```json
{
  "textDocument": { "uri": "file:///path/to/doc.md" },
  "viewMode": "changes"
}
```

#### `changedown/promotionStarting`

Sent before the server issues a `workspace/applyEdit` to promote an L2 document to L3.

```json
{ "uri": "file:///path/to/doc.md" }
```

The host should use this to set a guard that suppresses any decoration or change processing until `promotionComplete` arrives.

#### `changedown/promotionComplete`

Sent after the L2→L3 promotion attempt (success or failure).

```json
{ "uri": "file:///path/to/doc.md" }
```

Clear the promotion guard here.

#### `textDocument/publishDiagnostics`

Standard LSP diagnostics. ChangeDown emits:

- **Error**: malformed footnote headers, syntax errors
- **Warning**: unresolved anchors (anchor matched at a fuzzy level; original location lost)

Source field is `"changedown"`.

---

### Client → Server notifications

These are sent by the host; no response is expected.

#### Standard document sync

```
textDocument/didOpen      — when a file is opened
textDocument/didChange    — on every content change (incremental preferred)
textDocument/didClose     — when a file is closed
```

The server requires incremental sync (`textDocumentSync: Incremental`). Incremental changes allow the server to derive edit type (insertion/deletion/substitution) for the PendingEditManager.

#### `changedown/cursorMove`

Send on every cursor position change. The server uses this for flush-on-move logic (crystallizes a pending edit when the cursor leaves the edit region).

```json
{
  "textDocument": { "uri": "file:///path/to/doc.md" },
  "offset": 1423
}
```

`offset` is the byte offset of the cursor in the current document text.

#### `changedown/setViewMode`

Request a view mode change for a document. The server confirms with `changedown/viewModeChanged`.

```json
{
  "textDocument": { "uri": "file:///path/to/doc.md" },
  "viewMode": "review"
}
```

Valid `viewMode` values: `"review"` | `"changes"` | `"settled"` | `"raw"`

| Mode | Description |
|---|---|
| `review` | Full CriticMarkup visible; default |
| `changes` | Changed regions highlighted, context visible |
| `settled` | Only decided/accepted changes shown |
| `raw` | No semantic tokens, plain text |

#### `changedown/flushPending`

Force crystallization of any in-progress pending edit (e.g., when the user saves or switches files).

```json
{
  "textDocument": { "uri": "file:///path/to/doc.md" }
}
```

#### `changedown/pendingOverlay`

Optional. Sends the current in-flight insertion to the server so it can be merged into `decorationData` as a synthetic `ChangeNode`, enabling decoration during typing before flush.

```json
{
  "uri": "file:///path/to/doc.md",
  "overlay": {
    "range": { "start": 1410, "end": 1415 },
    "text": "added",
    "type": "insertion",
    "scId": "cn-overlay-0"
  }
}
```

Send `null` for `overlay` to clear it.

#### `changedown/updateSettings`

Push config changes to the server. Currently carries reviewer identity.

```json
{
  "reviewerIdentity": "@alice"
}
```

Non-VS Code clients may pass this via `initializationOptions.changedown.reviewerIdentity` during the LSP handshake instead.

#### `changedown/setCodeLensMode`

Control CodeLens display mode. The server refreshes CodeLens immediately.

```json
{ "mode": "cursor" }
```

Valid modes: `"cursor"` (show only for change under cursor) | `"always"` | `"off"`

#### `changedown/batchEditStart` and `changedown/batchEditEnd`

Bracket programmatic multi-step edits that should not trigger re-promotion or per-edit decoration updates. Decoration data is sent once on `batchEditEnd`.

```json
{ "uri": "file:///path/to/doc.md" }
```

#### `changedown/cursorPosition`

Used for CodeLens line-level cursor tracking (distinct from `cursorMove` which tracks byte offset for flush-on-move). Send when the cursor line changes.

```json
{
  "textDocument": { "uri": "file:///path/to/doc.md" },
  "line": 14,
  "changeId": "cn-3"
}
```

`changeId` is optional; include it when the cursor is on a known change's line.

---

### Client → Server requests

These expect a response. All use JSON-RPC request/response semantics.

#### `changedown/getChanges`

On-demand bootstrap. Returns the current `ChangeNode[]` for a document. Use this when the extension cache is empty (e.g., after a restart) rather than waiting for the next `decorationData` notification.

```json
// Request
{ "textDocument": { "uri": "file:///path/to/doc.md" } }

// Response
{ "changes": [ /* ChangeNode[] */ ] }
```

#### `changedown/reviewChange`

Accept or reject a single change. Returns a `TextEdit` that replaces the entire document with the updated content.

```json
// Request
{
  "uri": "file:///path/to/doc.md",
  "changeId": "cn-3",
  "decision": "approve",
  "reason": "Looks good",
  "author": "@bob"
}

// Response (success)
{ "edit": { "range": { ... }, "newText": "..." } }

// Response (failure)
{ "error": "Document not found" }
```

`decision` values: `"approve"` | `"reject"` | `"request_changes"`

#### `changedown/reviewAll`

Bulk accept or reject all proposed changes.

```json
// Request
{
  "uri": "file:///path/to/doc.md",
  "decision": "approve",
  "reason": "LGTM",
  "author": "@bob"
}

// Response
{ "edit": { ... } }
```

#### `changedown/amendChange`

Modify the text of a proposed change. Only the original author may amend; others must use `supersedeChange`.

```json
// Request
{
  "uri": "file:///path/to/doc.md",
  "changeId": "cn-2",
  "newText": "revised text",
  "reason": "Addressed feedback",
  "author": "@alice"
}
```

#### `changedown/supersedeChange`

Reject a proposed change and propose a replacement, with cross-references between the two.

```json
// Request
{
  "uri": "file:///path/to/doc.md",
  "changeId": "cn-2",
  "newText": "alternative text",
  "reason": "Different approach",
  "author": "@bob",
  "oldText": "original text",
  "insertAfter": "context before"
}

// Response (success)
{ "edit": { ... }, "newChangeId": "cn-5" }
```

#### `changedown/replyToThread`

Add a discussion comment to a change's footnote thread.

```json
// Request
{
  "uri": "file:///path/to/doc.md",
  "changeId": "cn-3",
  "text": "This needs a benchmark citation.",
  "author": "@carol",
  "label": "issue"
}
```

#### `changedown/resolveThread` and `changedown/unresolveThread`

Mark a change's discussion thread as resolved or reopen it.

```json
// Request (resolve)
{
  "uri": "file:///path/to/doc.md",
  "changeId": "cn-3",
  "author": "@carol"
}

// Request (unresolve)
{
  "uri": "file:///path/to/doc.md",
  "changeId": "cn-3"
}
```

#### `changedown/compactChange`

Descend the metadata level of a single decided (accepted or rejected) change. Cannot compact proposed changes.

```json
// Request
{
  "uri": "file:///path/to/doc.md",
  "changeId": "cn-1",
  "fully": false
}
```

- `fully: false` (default) — L2 → L1 (removes footnote block, keeps inline metadata)
- `fully: true` — L2 → L0 (removes all annotation, plain text only)

#### `changedown/compactChanges`

Compact multiple decided footnotes in a single operation. Inserts a compaction-boundary footnote.

```json
// Request
{
  "uri": "file:///path/to/doc.md",
  "targets": ["cn-1", "cn-2"],
  "undecidedPolicy": "accept",
  "boundaryMeta": { "note": "Sprint 4 cleanup" }
}

// Response (success)
{
  "edit": { ... },
  "compactedIds": ["cn-1", "cn-2"],
  "verification": { ... }
}
```

`targets` accepts an array of change IDs or the string `"all-decided"`.

#### `changedown/annotate`

Run git-based annotation on a file. Computes the diff between the current file and its previous git commit, and returns a `WorkspaceEdit` that rewrites the buffer with the diff expressed as CriticMarkup.

Returns `null` when annotation cannot proceed (file not in git, no previous commit, already annotated, no changes, unsupported language).

```json
// Request
{ "textDocument": { "uri": "file:///path/to/doc.md" } }

// Response (success)
{ "changes": { "file:///path/to/doc.md": [ /* TextEdit[] */ ] } }

// Response (no-op)
null
```

#### `changedown/getProjectConfig`

Read project-level configuration. Used by the host to determine whether review reasons are required for human or agent reviewers.

```json
// Request (no params)
{}

// Response
{
  "reasonRequired": {
    "human": false,
    "agent": true
  },
  "reviewerIdentity": "@alice"
}
```

---

## Part C: Minimal Host — L2

This section describes the minimum viable host implementation. It handles L2 documents, receives parse notifications, and renders decorations.

### Required state per-document

```
activeUri:          string | null
text:               Map<uri, string>
viewMode:           Map<uri, "review" | "changes" | "settled" | "raw">
decorationCache:    Map<uri, { changes: ChangeNode[], version: number }>
echoGuard:          Map<uri, boolean>
```

Global state:
```
reviewerIdentity:   string | null
```

### Initialization

During LSP handshake, pass reviewer identity in `initializationOptions` (non-VS Code clients) or send `changedown/updateSettings` after the connection is established (VS Code extension pattern):

```json
// initializationOptions
{
  "changedown": {
    "reviewerIdentity": "@alice"
  }
}
```

The server advertises these capabilities in `InitializeResult`:

```json
{
  "capabilities": {
    "textDocumentSync": 2,
    "hoverProvider": true,
    "semanticTokensProvider": { "legend": { ... }, "full": true },
    "codeLensProvider": { "resolveProvider": false },
    "codeActionProvider": true,
    "documentLinkProvider": { "resolveProvider": false },
    "foldingRangeProvider": true
  }
}
```

### Event sequences

#### File open

1. Store text in `text[uri]`
2. Send `textDocument/didOpen` with `languageId: "markdown"`
3. Initialize `decorationCache[uri] = { changes: [], version: -1 }`
4. Wait for `changedown/decorationData` — the server sends it after parse

If the file is L2 with changes, the server will promote it to L3 before sending `decorationData`:
- Server sends `changedown/promotionStarting`
- Server sends `workspace/applyEdit` (buffer replace with L3 text)
- Server sends `changedown/promotionComplete`
- Host applies the edit, sends `textDocument/didChange`, then receives `decorationData`

#### File switch

1. Send `changedown/flushPending` for the previous URI
2. Send `textDocument/didClose` for the previous URI
3. Clear decoration surfaces for the previous URI
4. Remove `decorationCache[prevUri]`
5. Open the new URI (follow the "File open" sequence above)

#### Content change

1. Update `text[uri]`
2. Send `textDocument/didChange` with incremental `contentChanges`
3. Schedule a debounced surface redecoration (the server debounces `decorationData` at 60 ms, so host debouncing is optional but avoids UI flicker)
4. Send `changedown/cursorMove` with current byte offset

#### `changedown/decorationData` received

```
if notification.documentVersion >= decorationCache[uri].version:
    decorationCache[uri] = { changes: notification.changes, version: notification.documentVersion }
    schedule surface update (debounced)
```

Surface update = render decorations from `decorationCache[uri].changes`.

#### `changedown/pendingEditFlushed` received

This requires precise sequencing to avoid a feedback loop:

```
echoGuard[uri] = true
try:
    apply notification.edits atomically as a single workspace edit
    // The edit produces a buffer change — sync it back to the server
    newText = applyEditsToBuffer(text[uri], notification.edits)
    text[uri] = newText
    send textDocument/didChange with:
        contentChanges: [{ text: newText }]   // no range = full doc replacement
    // Do NOT schedule a decoration update here
finally:
    echoGuard[uri] = false
```

When `echoGuard[uri]` is true and a `textDocument/didChange` is sent, skip the decoration schedule for that change. The server consumes the echo internally.

#### View mode change

1. Update `viewMode[uri]`
2. Re-render decorations from `decorationCache[uri]` immediately (view mode affects rendering, not data)
3. Send `changedown/setViewMode` to inform the server
4. Wait for `changedown/viewModeChanged` confirmation before requesting semantic token refresh

#### Rendering parameter change

When anything changes how decorations are rendered (theme, font size, user settings) but the underlying data has not changed:

Re-render from `decorationCache[uri]` — no server roundtrip needed.

#### Cursor move

Send `changedown/cursorMove` on every cursor position change (throttle to ~16 ms if needed):

```json
{
  "textDocument": { "uri": "file:///path/to/doc.md" },
  "offset": 1423
}
```

Also send `changedown/cursorPosition` when the cursor line changes, for CodeLens targeting:

```json
{
  "textDocument": { "uri": "file:///path/to/doc.md" },
  "line": 14
}
```

#### File close

1. Send `changedown/flushPending`
2. Send `textDocument/didClose`
3. Remove `text[uri]`, `decorationCache[uri]`, `viewMode[uri]`, `echoGuard[uri]`

### Surface update model

The host maintains a render pipeline:

```
DocumentSnapshot {
    uri:        string
    text:       string
    viewMode:   ViewName
    changes:    ChangeNode[]
}
```

Whenever `decorationCache` or `viewMode` changes, push a new `DocumentSnapshot` to the render port. The renderer uses `changes` to place decorations and `viewMode` to decide which decorations to suppress.

For `review` and `changes` modes: show all proposed changes with their full visual treatment.
For `settled` mode: show only accepted changes (filter by `status === "Accepted"`).
For `raw` mode: no decorations.

---

## Part D: Full Host — L3

This section extends the minimal host with L3-specific behaviors. An L3-aware host participates in the promotion lifecycle, handles demotion on save, and can render projected views.

### Promotion lifecycle

When the server opens an L2 file with changes, it automatically promotes to L3:

```
Server → Client: changedown/promotionStarting { uri }
Server → Client: workspace/applyEdit { L3 text }
Client → Server: textDocument/didChange (echo of the L3 text)
Server → Client: changedown/decorationData (parsed from L3)
Server → Client: changedown/promotionComplete { uri }
```

Host obligations during promotion:
- On `promotionStarting`: set a `convertingUris` guard for this URI
- On `workspace/applyEdit`: apply the edit to the buffer; do NOT schedule decoration updates
- The resulting `didChange` echo is handled internally by the server (it tracks `state.isPromoting`)
- On `promotionComplete`: clear the guard

If `workspace/applyEdit` is rejected, the server falls back to L2 decoration data and still sends `promotionComplete`.

### Demotion on save

L3 is a working format. On file save, convert back to L2 using the `convertL3ToL2` core function (or equivalent API). This keeps the on-disk representation in the standard interchange format.

```
User triggers save
→ Host calls convertL3ToL2(bufferText)
→ Write L2 text to disk
→ Buffer stays as L3 (or reload from disk, depending on host behavior)
```

If the host reloads from disk after save, wrap the reload in `batchEditStart`/`batchEditEnd` to suppress re-promotion:

```json
{ "uri": "file:///path/to/doc.md" }   // batchEditStart
// ... apply L2 text to buffer ...
// ... send textDocument/didChange ...
{ "uri": "file:///path/to/doc.md" }   // batchEditEnd
```

### Batch edit coordination

Use `batchEditStart`/`batchEditEnd` whenever performing programmatic multi-step edits that should not each trigger a full parse cycle:

- Save/demotion (as above)
- Applying a `reviewChange` or `compactChanges` workspace edit
- Any sequence of view transitions where intermediate states are not meaningful

During batch mode, the server parses and caches each `didChange` but does not send `decorationData`. Fresh data is sent on `batchEditEnd`.

### Projected views

L3 supports rendering projected views — alternative body materializations:

- **Settled view**: the body with all accepted changes applied and all rejected changes removed
- **Raw view**: the body without any CriticMarkup (plain author's text)

These require the `computeSettledView` and `computeRawView` core functions. The LSP server's semantic tokens endpoint already respects `viewMode` for highlighting suppression, but if the host wants to present a visually distinct buffer (e.g., a separate editor tab), it must materialize the projection from the core library directly.

---

## Part E: Rich Client Optimizations

These optimizations are optional but significantly improve perceived latency for interactive editing.

### Local PendingEditManager for zero-latency crystallization

The PendingEditManager (PEM) is the server component that decides when a pending keystroke sequence should crystallize into CriticMarkup. The boundary condition is: the user pauses typing for longer than `pauseThresholdMs` (default 2000 ms) while the cursor remains inside the edit region, or moves the cursor outside the region.

A rich client can run a mirrored PEM locally to achieve zero-latency crystallization: when the local PEM fires, the client immediately applies the CriticMarkup transformation to the buffer without waiting for a server roundtrip. The server's PEM serves as the authoritative source; in case of divergence, the server's `pendingEditFlushed` takes precedence.

Implementation requires porting the `processEvent` state machine from `@changedown/core/edit-boundary`. The API:

```typescript
processEvent(state: EditBoundaryState, event: EditEvent, ctx: ProcessEventContext)
  → { newState: EditBoundaryState, effects: EditBoundaryEffect[] }
```

Events: `insertion`, `deletion`, `substitution`, `cursorMove`, `flush`, `timerFired`

Effects: `CrystallizeEffect` (carry the resulting `TextEdit[]`)

### Pending overlay protocol for decoration during typing

Before a pending edit crystallizes, the host can send an overlay to the server so the server merges it into `decorationData` as a synthetic `ChangeNode`. This lets the decoration rendering show the in-progress change visually before it is committed to the file.

```
User types "added text"
→ Host captures current insertion range and text
→ Host sends changedown/pendingOverlay { uri, overlay: { range, text, type: "insertion" } }
→ Server merges overlay into next decorationData
→ Host renders overlay ChangeNode with "pending" visual style
```

When the pending edit crystallizes (via `pendingEditFlushed`), send `null` overlay to clear it:

```json
{ "uri": "...", "overlay": null }
```

### Selection-confirmation gate (VS Code-specific)

In VS Code, a selection event can follow a cursor event by several milliseconds. If a tracked deletion is proposed while a selection is active, the pending edit represents the selected text — but confirming this immediately would capture accidental selections.

The VS Code extension implements a selection-confirmation gate: when a deletion begins while text is selected, the pending edit is held as `unconfirmedTrackedEdit` until the user makes a subsequent keystroke (confirming intent) or clears the selection (canceling). This is a runtime-layer concern and is VS Code-specific; other editors may not need it.

The relevant server-side configuration is `pauseThresholdMs: 0` which disables the timer-based flush entirely (guard in core: `if (config.pauseThresholdMs > 0)`), leaving only cursor-move and explicit flush signals.

### Optimistic and authoritative decoration merging

A rich client can improve perceived performance by using optimistic decorations:

1. On content change, immediately re-render decorations from the cached `ChangeNode[]` (optimistic — may be slightly stale)
2. When `changedown/decorationData` arrives with the parsed result, replace the optimistic render with the authoritative one

For small edits (character insertions that do not touch existing CriticMarkup), the optimistic render will usually be correct. For edits near change boundaries or footnote blocks, the server result may differ.

To implement this cleanly, track the document version at which each `ChangeNode` was computed. When applying an incremental edit, shift `ChangeNode.range` offsets for changes that come after the edit point. This shift-based approximation works for insertions and deletions outside existing change ranges.

---

## Appendix: Error handling

All request handlers return either a success response or `{ "error": "..." }`. Hosts should treat an error response as a no-op for the pending operation and surface the message via a status bar notification or log.

The server does not close the connection on handler errors. Individual handler failures are isolated.

## Appendix: Config file

Project-level configuration lives in `.changedown/config.toml` at the workspace root. The server watches this file and reloads automatically. Changes trigger `changedown/documentState` re-broadcast for all open documents.

The `changedown/getProjectConfig` request returns the subset of config the host needs at runtime (`reasonRequired`, `reviewerIdentity`). Hosts do not need to parse the TOML directly.

## Appendix: Protocol version

The ChangeDown LSP protocol does not currently version its custom messages. The server negotiates standard LSP capabilities via `initialize`/`initialized`. Custom notification and request names are stable and backward-compatible within a major version of the server.
