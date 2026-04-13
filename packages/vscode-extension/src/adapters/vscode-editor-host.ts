// packages/vscode-extension/src/adapters/vscode-editor-host.ts
import * as vscode from 'vscode';
import {
  EventEmitter,
  type EditorHost, type Disposable, type ContentChange,
  type RangeEdit, type ApplyEditResult,
  type PendingOverlay,
} from '@changedown/core/host';
import { isSupported, findSupportedEditor } from '../managers/shared';
import type { VsCodeLspAdapter } from './vscode-lsp-adapter';
import type { CommentThreadGuard } from '../features/comment-thread-guard';

/**
 * VS Code adapter implementing EditorHost.
 * Translates VS Code events into the EditorHost contract.
 */
export class VsCodeEditorHost implements EditorHost, Disposable {
  private _echoUris = new Set<string>();
  private _lastActiveUri: string | undefined;
  private _openedUris = new Set<string>();
  private _lastCursorLineByUri = new Map<string, number>();
  private _disposables: vscode.Disposable[] = [];

  // ── Event emitters ────────────────────────────────────────
  private readonly _onDidOpenDocument = new EventEmitter<{ uri: string; text: string }>();
  readonly onDidOpenDocument = this._onDidOpenDocument.event;

  private readonly _onDidCloseDocument = new EventEmitter<{ uri: string }>();
  readonly onDidCloseDocument = this._onDidCloseDocument.event;

  private readonly _onDidSaveDocument = new EventEmitter<{ uri: string }>();
  readonly onDidSaveDocument = this._onDidSaveDocument.event;

  private readonly _onDidChangeContent = new EventEmitter<{
    uri: string; text: string; version: number;
    changes: ContentChange[]; isEcho: boolean;
  }>();
  readonly onDidChangeContent = this._onDidChangeContent.event;

  private readonly _onDidChangeActiveDocument = new EventEmitter<{ uri: string; text: string } | null>();
  readonly onDidChangeActiveDocument = this._onDidChangeActiveDocument.event;

  private readonly _onDidChangeCursorPosition = new EventEmitter<{ uri: string; offset: number }>();
  readonly onDidChangeCursorPosition = this._onDidChangeCursorPosition.event;

  constructor(
    private lspAdapter: VsCodeLspAdapter,
    private commentGuard?: CommentThreadGuard,
  ) {
    // ── Document content changes ────────────────────────────
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId !== 'markdown' || event.document.uri.scheme !== 'file') return;

        const uri = event.document.uri.toString();
        const text = event.document.getText();
        const isEcho = this._echoUris.has(uri);
        if (isEcho) this._echoUris.delete(uri);

        // Detect undo/redo — tell server-side PEM to abandon pending buffer
        if (event.reason === vscode.TextDocumentChangeReason.Undo ||
            event.reason === vscode.TextDocumentChangeReason.Redo) {
          this.lspAdapter.sendUndoRedo(uri);
        }

        const changes: ContentChange[] = event.contentChanges.map(c => ({
          range: {
            start: { line: c.range.start.line, character: c.range.start.character },
            end: { line: c.range.end.line, character: c.range.end.character },
          },
          rangeLength: c.rangeLength,
          text: c.text,
          rangeOffset: c.rangeOffset,
        }));

        // Suppress content-change propagation while a comment thread is expanded —
        // edits typed in the comment widget must not be tracked on the source document.
        // Echo consumed above is still cleared. Undo/redo (sent above) is intentionally
        // NOT suppressed: it applies to the main document stack, independent of the
        // comment widget.
        if (this.commentGuard?.isActive()) return;

        this._onDidChangeContent.fire({ uri, text, version: event.document.version, changes, isEcho });
      }),
    );

    // ── Active editor changes ───────────────────────────────
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor) {
          this._lastActiveUri = undefined;
          this._onDidChangeActiveDocument.fire(null);
          return;
        }
        if (!isSupported(editor.document)) {
          // Active editor switched to an unsupported doc — clear active state
          // so BaseController doesn't keep pushing snapshots to a stale URI.
          this._lastActiveUri = undefined;
          this._onDidChangeActiveDocument.fire(null);
          return;
        }

        const uri = editor.document.uri.toString();
        // Dedup: sidebar toggles re-fire the event for the same editor
        if (uri === this._lastActiveUri) return;
        // Skip comment input pseudo-documents
        if (uri.startsWith('comment://')) return;

        this._lastActiveUri = uri;
        const text = editor.document.getText();

        // Detect new documents not yet tracked
        if (!this._openedUris.has(uri)) {
          this._openedUris.add(uri);
          this._onDidOpenDocument.fire({ uri, text });
        }

        this._onDidChangeActiveDocument.fire({ uri, text });
      }),
    );

    // ── Cursor position changes ─────────────────────────────
    this._disposables.push(
      vscode.window.onDidChangeTextEditorSelection(event => {
        const editor = event.textEditor;
        if (!isSupported(editor.document)) return;
        const uri = editor.document.uri.toString();
        // Line-level dedup: skip if cursor hasn't crossed a line boundary.
        // Typing within a line fires per-keystroke — server de-dupes internally
        // but we avoid the IPC traffic entirely.
        const line = event.selections[0].active.line;
        const lastLine = this._lastCursorLineByUri.get(uri);
        if (lastLine === line) return;
        this._lastCursorLineByUri.set(uri, line);
        const offset = editor.document.offsetAt(event.selections[0].active);
        this._onDidChangeCursorPosition.fire({ uri, offset });
      }),
    );

    // ── Save ────────────────────────────────────────────────
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (!isSupported(doc)) return;
        this._onDidSaveDocument.fire({ uri: doc.uri.toString() });
      }),
    );

    // ── Close ───────────────────────────────────────────────
    this._disposables.push(
      vscode.workspace.onDidCloseTextDocument(doc => {
        const uri = doc.uri.toString();
        // Only fire for URIs we actually tracked — avoids LSP protocol violation
        // (sending didClose for a URI that never received didOpen).
        if (this._openedUris.delete(uri)) {
          if (this._lastActiveUri === uri) this._lastActiveUri = undefined;
          this._lastCursorLineByUri.delete(uri);
          this._echoUris.delete(uri);
          this._onDidCloseDocument.fire({ uri });
        }
      }),
    );

    // ── Fire onDidOpenDocument for initially visible editors ──
    for (const editor of vscode.window.visibleTextEditors) {
      if (isSupported(editor.document)) {
        const uri = editor.document.uri.toString();
        this._openedUris.add(uri);
        // Defer to avoid firing during construction
        queueMicrotask(() => {
          this._onDidOpenDocument.fire({ uri, text: editor.document.getText() });
        });
      }
    }
    // Set initial active
    const active = vscode.window.activeTextEditor;
    if (active && isSupported(active.document)) {
      this._lastActiveUri = active.document.uri.toString();
    }

    // ── Comment thread guard ────────────────────────────────
    if (this.commentGuard) {
      this._disposables.push(
        this.commentGuard.onDidDeactivate(() => {
          this.resyncActiveDocument();
        }),
      );
    }
  }

  // ── EditorHost methods ────────────────────────────────────
  getDocumentText(uri: string): string {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
    return doc?.getText() ?? '';
  }

  async applyEdits(uri: string, edits: RangeEdit[]): Promise<ApplyEditResult> {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
    const textBefore = doc?.getText() ?? '';

    const wsEdit = new vscode.WorkspaceEdit();
    const docUri = vscode.Uri.parse(uri);
    for (const edit of edits) {
      wsEdit.replace(
        docUri,
        new vscode.Range(
          edit.range.start.line, edit.range.start.character,
          edit.range.end.line, edit.range.end.character,
        ),
        edit.newText,
      );
    }

    this._echoUris.add(uri);
    const applied = await vscode.workspace.applyEdit(wsEdit);

    if (!applied) {
      this._echoUris.delete(uri);
      return { applied: false, text: '', version: 0 };
    }

    const textAfter = doc?.getText() ?? '';

    // If the edit was a no-op (server returned identical text), VS Code does NOT
    // fire onDidChangeTextDocument — drop the echo flag so the next real keystroke
    // isn't misclassified as an echo.
    if (textBefore === textAfter) {
      this._echoUris.delete(uri);
    }

    return {
      applied: true,
      text: textAfter,
      version: doc?.version ?? 0,
    };
  }

  async replaceDocument(
    uri: string,
    newText: string,
    _metadata:
      | { reason: 'format-conversion'; from: 'L2' | 'L3'; to: 'L2' | 'L3' }
      | { reason: 'external' },
  ): Promise<ApplyEditResult> {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
    if (!doc) {
      return { applied: false, text: '', version: 0 };
    }

    const textBefore = doc.getText();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(textBefore.length),
    );

    const wsEdit = new vscode.WorkspaceEdit();
    const docUri = vscode.Uri.parse(uri);
    wsEdit.replace(docUri, fullRange, newText);

    // Register the echo BEFORE applyEdit so the incoming didChange is
    // marked isEcho=true by handleContentChange's guard.
    this._echoUris.add(uri);
    const applied = await vscode.workspace.applyEdit(wsEdit);

    if (!applied) {
      this._echoUris.delete(uri);
      return { applied: false, text: '', version: 0 };
    }

    const textAfter = doc.getText();

    // No-op detection: if the replace resulted in the same bytes (e.g., a
    // format conversion that happened to produce identical text), VS Code
    // does NOT fire onDidChangeTextDocument. Drop the echo flag so the
    // next real keystroke isn't misclassified as an echo.
    if (textBefore === textAfter) {
      this._echoUris.delete(uri);
    }

    return {
      applied: true,
      text: textAfter,
      version: doc.version,
    };
  }

  showOverlay(uri: string, overlay: PendingOverlay): void {
    // Server-side PEM pushes overlay via onOverlayUpdate → BaseController → here.
    // TODO: Implement overlay decoration rendering
  }

  clearOverlay(uri: string): void {
    // Clear overlay decoration for the given URI.
    // TODO: Implement overlay decoration clearing
  }

  /** Register an incoming echo for the given URI. Called by edit paths that
   *  bypass applyEdits. */
  public registerEcho(uri: string): void {
    this._echoUris.add(uri);
  }

  /** Full-document resync after comment thread deactivation.
   *  Sends the current document text to the LSP server so server coordinate
   *  space is consistent after any edits typed in the comment widget. */
  private resyncActiveDocument(): void {
    const editor = findSupportedEditor();
    if (!editor) return;
    const uri = editor.document.uri.toString();
    if (!this._openedUris.has(uri)) return; // server doesn't know this URI yet
    this.lspAdapter.sendDidChangeFullDoc(uri, editor.document.getText());
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    this._onDidOpenDocument.dispose();
    this._onDidCloseDocument.dispose();
    this._onDidSaveDocument.dispose();
    this._onDidChangeContent.dispose();
    this._onDidChangeActiveDocument.dispose();
    this._onDidChangeCursorPosition.dispose();
  }
}
