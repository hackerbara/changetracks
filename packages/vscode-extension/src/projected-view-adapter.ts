// packages/vscode-extension/src/projected-view-adapter.ts
import * as vscode from 'vscode';
import { ProjectedView } from './projected-view';
import type { Disposable } from '@changedown/core/host';
import type { VsCodeLspAdapter } from './adapters/vscode-lsp-adapter';
import type { VsCodeEditorHost } from './adapters/vscode-editor-host';

/**
 * Thin adapter for L2 buffer swap (projected view).
 * VS Code-specific — not part of BaseController.
 * Owns the isConverting suppression state for projected view transitions.
 */
export class ProjectedViewAdapter implements Disposable {
  private readonly projectedView = new ProjectedView();
  private _isConverting = false;

  constructor(
    private lspAdapter: VsCodeLspAdapter,
    private editorHost: VsCodeEditorHost,
  ) {}

  get isActive(): boolean { return this.projectedView.active; }
  get originalUri(): vscode.Uri | null { return this.projectedView.originalUri; }
  get isConverting(): boolean { return this._isConverting; }

  /**
   * Enter projected view (settled or raw).
   * Brackets the buffer swap with batch edit notifications and isConverting guard.
   */
  async enter(editor: vscode.TextEditor, mode: 'settled' | 'raw'): Promise<void> {
    const uri = editor.document.uri.toString();
    this.lspAdapter.sendBatchEditStart(uri);
    this._isConverting = true;
    try {
      this.editorHost.registerEcho(uri);
      await this.projectedView.enter(editor, mode);
    } finally {
      this._isConverting = false;
      this.lspAdapter.sendBatchEditEnd(uri);
    }
  }

  /**
   * Exit projected view (restore original text).
   */
  async exit(editor: vscode.TextEditor): Promise<void> {
    if (!this.projectedView.active || !this.projectedView.originalUri) return;
    const uri = this.projectedView.originalUri.toString();
    this.lspAdapter.sendBatchEditStart(uri);
    this._isConverting = true;
    try {
      this.editorHost.registerEcho(uri);
      await this.projectedView.exit(editor);
    } finally {
      this._isConverting = false;
      this.lspAdapter.sendBatchEditEnd(uri);
    }
  }

  static recoverCrashBackups(): Promise<void> {
    return ProjectedView.recoverCrashBackups();
  }

  dispose(): void {
    this.projectedView.dispose();
  }
}
