# ChangeDown SDK Integration Guide

Guide for integrating ChangeDown change-tracking into a new editor host.

[^cn-14][^cn-2.1][^cn-2.2]

## Integration Shapes

The single design question: **does your host own file/buffer state, or does the LSP?**

### Shape 1: Rich Host (BaseController)

For editors that own file buffers: VS Code, Obsidian, website.[^cn-3]

```typescript
import {
  BaseController, LspFormatAdapter,
  type EditorHost, type DecorationPort,
} from '@changedown/core/host';

const controller = new BaseController({
  host: myEditorHost,          // implements EditorHost
  decorationPort: myDecoPort,  // implements DecorationPort
  previewPort: myPreviewPort,  // implements PreviewPort (optional)
{~~  formatAdapter: new LspFormatAdapter(myLsp),~>  formatAdapter: new LspFormatAdapter(myLspConnection),~~}[^cn-4]
  lsp: myLspConnection,       // implements TypedLspConnection (optional)
  defaultFormat: 'L3',
  defaultDisplay: { delimiters: 'show', authorColors: 'auto' },
  hooks: {
    onDidCrystallize: (uri) => console.log('edit crystallized:', uri),
    onRevealChange: (offset) => editor.revealOffset(offset),
  },
});
```

The LSP connection is optional. Without it, `BaseController` still manages
document state, projections, and decoration scheduling. Without LSP, tracking
notifications and review operations silently no-op via a `NULL_LSP_CONNECTION`
stub — no errors are thrown. Pending-edit flush additionally requires
`host.applyEdits` to be implemented.[^cn-5] See "Standalone
Mode" at the bottom.

### Shape 2: Thin Viewer (LSP only)

For editors that defer state to the LSP: Neovim, Zed, Vienna-style clients.

No `BaseController` needed. Connect to the ChangeDown LSP server via stdio or
socket, then:

1. Send standard `textDocument/didOpen`, `textDocument/didChange` notifications.
2. Listen for `changedown/decorationData` to receive `ChangeNode[]` arrays.
3. Map `ChangeNode` offset ranges to your editor's decoration API.
4. Send `changedown/review`, `changedown/amend`, etc. for change operations.

The LSP owns all document state and projection logic in this shape.

### Shape 3: Hybrid (VS Code pattern)

`BaseController` + LSP. The SDK owns document state locally for fast decoration
scheduling, cursor tracking, and format management. The LSP runs in a child
process and provides parsing, tracking, and review operations.

This is the recommended shape for desktop editors. See
`packages/vscode-extension/src/extension.ts` (line ~139) for the reference
implementation:

```typescript
const controller = new BaseController({
  host: editorHost,                          // VscodeEditorHost
  lsp: lspAdapter,                           // TypedLspConnection wrapper
  decorationPort: decorationManager,         // VS Code decoration types
  formatAdapter: new LspFormatAdapter(lspAdapter),
  defaultFormat: 'L3',
  defaultDisplay: { delimiters: initialShowDelimiters ? 'show' : 'hide', authorColors },
  hooks: { onDidOpenDocument, onDidCrystallize },
});
```

## Port Reference

All port interfaces are exported from `@changedown/core/host`.

### EditorHost

Platform-to-controller bridge. Fire events when the editor state changes.

**Events you must fire:**
- `onDidOpenDocument` -- `{ uri, text }` when a document opens
- `onDidCloseDocument` -- `{ uri }` when a document closes
- `onDidSaveDocument` -- `{ uri }` on save (triggers pending-edit flush)
- `onDidChangeContent` -- `{ uri, text, version, changes, isEcho }` on edits
- `onDidChangeActiveDocument` -- `{ uri, text? }` or `null` on focus change[^cn-6]
- `onDidChangeCursorPosition` -- `{ uri, offset }` on cursor move

**Required method:**
- `getDocumentText(uri: string): string` -- return current buffer text

**Optional capabilities:**
- `applyEdits(uri, edits): Promise<ApplyEditResult>` -- apply workspace edits
  (needed for crystallization / pending-edit flush)
- `showOverlay(uri, overlay)` / `clearOverlay(uri)` -- ghost-text overlays

Content changes use LSP-native coordinates (`{ line, character }`, 0-indexed).
Your host adapter converts from editor-native format before firing events.
If your editor provides byte offsets natively, set `rangeOffset` on each
`ContentChange` to skip the range-to-offset conversion.

### DecorationPort

Controller-to-platform rendering surface.

```typescript
interface DecorationPort extends Disposable {
  update(snapshot: DocumentSnapshot): void;
  clear(uri?: string): void;
}
```

`update()` receives a `DocumentSnapshot` containing the document text, parsed
`ChangeNode[]` array, current `ProjectionSelector`, and `DisplayOptions`. Your
implementation maps these to platform-native decorations (colors, underlines,
strikethroughs, gutter icons).

### PreviewPort (optional)

Same interface as `DecorationPort`. Used for side-panel previews, split views,
or HTML renderings. Omit if your host has no preview surface.

### FormatAdapter

Pluggable format conversion between L2 (inline CriticMarkup) and L3 (footnote
references).

```typescript
interface FormatAdapter {
  convertL2ToL3(uri: string, l2Text: string): Promise<string>;
  convertL3ToL2(uri: string, l3Text: string): Promise<string>;
}
```

The SDK ships `LspFormatAdapter`, which proxies conversion to the LSP server via
`changedown/convertFormat`. Use it when you have an LSP connection.

### TypedLspConnection

Typed wrapper over the base `LspConnection` interface. Provides named methods
for all ChangeDown LSP protocol messages:

- **Document lifecycle:** `sendDidOpen`, `sendDidClose`, `sendDidChange`,
  `sendDidChangeFullDoc`
- **Editor state:** `sendCursorMove`, `sendViewMode`, `sendFlushPending`, `sendMoveMetadata`[^cn-7]
- **Tracking:** `sendSetDocumentState`
- **Review operations:** `reviewChange`, `amendChange`, `supersedeChange`,
  `compactChange`, `reviewAll`
- **Format:** `convertFormat`
- **Inbound notifications:** `onDecorationData`, `onPendingEditFlushed`,
  `onDocumentState`, `onOverlayUpdate`

Your host wraps its platform LSP client to implement this interface. The
controller wires all inbound notification handlers automatically in its
constructor.

## Projection Model

Three named projections replace the old four-mode enum:

| Projection | Description | Old ViewMode |
|------------|-------------|--------------|
| `current` | Tracked document text with all proposed changes applied as if accepted[^cn-8] | `review` / `changes` |
| `decided` | Only finalized (accepted) changes applied | `settled` |
| `original` | Base text before any tracking | `raw` |

The difference between old `review` and `changes` is now a display option
(`delimiters: 'show'` vs `'hide'`), not a separate projection.

### DisplayOptions

Composable rendering controls applied on top of any projection:

```typescript
{~~interface DisplayOptions {~>interface DisplayOptions {~~}[^cn-9]
  insertions?: 'inline' | 'ghost' | 'hide';
  deletions?: 'inline' | 'ghost' | 'strikethrough' | 'hide';
  substitutions?: 'inline' | 'ghost' | 'hide';
  highlights?: 'inline' | 'ghost' | 'hide';
  comments?: 'inline-marker' | 'badges-only' | 'hide';
  delimiters?: 'show' | 'hide';
  footnoteRefs?: 'show' | 'hide';
  authorColors?: 'auto' | 'always' | 'never';
  cursorReveal?: boolean;
  authorFilter?: readonly string[];
  statusFilter?: readonly ChangeStatus[];
  changeIdFilter?: readonly string[];
}
```

### VIEW_MODE_PRESETS

Legacy mapping for hosts migrating from the old API:

```typescript
import { VIEW_MODE_PRESETS } from '@changedown/core/host';
// VIEW_MODE_PRESETS.review  -> { projection: 'current', display: { delimiters: 'show', ... } }
// VIEW_MODE_PRESETS.changes -> { projection: 'current', display: { delimiters: 'hide', ... } }
// VIEW_MODE_PRESETS.settled -> { projection: 'decided', display: {} }
// VIEW_MODE_PRESETS.raw     -> { projection: 'original', display: {} }
```

`setViewMode()` still works but is deprecated. New integrations should use
`setProjection()` + `setDisplay()`.

## Quick Reference: Key Methods

```typescript
// Switch projection
controller.setProjection('decided');

// Change rendering options (merges with current display)
controller.setDisplay({ deletions: 'hide', authorColors: 'always' });

// Set format preference for a URI (triggers conversion if needed)
controller.setFormatPreference(uri, 'L3');

// Document lifecycle
controller.openDocument(uri, text);
controller.closeDocument(uri);

// Query state
controller.getState(uri);           // DocumentState | undefined
controller.getActiveUri();          // DocumentUri | undefined
controller.getChangesForUri(uri);   // ChangeNode[]
{==controller.getAuthoredChanges(uri); // ChangeNode[] (filters ghost nodes)==}[^cn-12]
controller.isTrackingEnabled(uri);  // boolean
controller.getCoherence(uri);       // CoherenceState | undefined

// Force re-render
controller.invalidateRendering(uri);

// Direct service access
controller.formatService;           // FormatService
controller.projectionService;       // ProjectionService
controller.trackingService;         // TrackingService
controller.reviewService;           // ReviewService
controller.navigationService;       // NavigationService
controller.coherenceService;        // CoherenceService
controller.stateManager;            // DocumentStateManager
controller.scheduler;               // DecorationScheduler

// Cleanup
controller.dispose();
```

## Reference Integrations

- **Website:** `website-v2/src/host/website-controller.ts` -- minimal Shape 3
  integration (~68 lines)[^cn-11]. Uses `LspFormatAdapter`, signals for UI state sync.
- **VS Code:** `packages/vscode-extension/src/extension.ts` -- full Shape 3 with
  config watchers, save-conversion, comment threads, and tracking toggle.
- **VS Code EditorHost:** `packages/vscode-extension/src/adapters/vscode-editor-host.ts`
  -- reference `EditorHost` implementation wrapping VS Code's editor API.

## Standalone Mode

`BaseController` accepts an optional `lsp` parameter. When omitted, TypedLspConnection method calls are skipped via optional chaining (`this.lsp?.method()`). A `NULL_LSP_CONNECTION` stub is injected only into `TrackingService` and `ReviewService`, which require a `LspConnection` instance at construction time.[^cn-10]
This allows the controller to manage document state, projections, and decoration
scheduling without a running LSP server.

However, standalone mode requires a `FormatAdapter` that can convert locally.
**`LocalFormatAdapter` does not exist yet.** The only shipped adapter is
`LspFormatAdapter`, which proxies to the LSP. A standalone integration today
would need to either:

1. Provide a custom `FormatAdapter` implementation using core's parser directly.
2. Run with `defaultFormat` matching the document's existing format (no
   conversion needed).
3. Start the LSP server in-process and use `LspFormatAdapter`.

A `LocalFormatAdapter` that calls core's conversion functions directly is a
planned future addition.
