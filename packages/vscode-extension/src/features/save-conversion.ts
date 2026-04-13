import * as vscode from 'vscode';
import type { BaseController } from '@changedown/core/host';
import type { VsCodeLspAdapter } from '../adapters/vscode-lsp-adapter';
import { isSupported } from '../managers/shared';

/**
 * save-conversion: L3 → L2 on save.
 *
 * Called from onWillSaveTextDocument. Uses formatService.demoteText (text
 * convenience) to produce the L2 text that VS Code then writes to disk via
 * the TextEdit[] returned from waitUntil().
 *
 * After save, VS Code fires onDidChangeContent with the L2 text as the new
 * buffer content. BaseController's handleContentChange does NOT re-promote
 * on every content change (that would be too aggressive). Re-promotion
 * happens on the next onDidOpenDocument for the URI, which fires when the
 * user reopens the file. For a continuously-open file, the buffer stays
 * at L2 after save until explicit re-promotion (e.g., via
 * controller.convertFormat(uri, 'L3') or via a re-open).
 *
 * Re-promotion deliberately does not happen on post-save content changes.
 * That would create a save-convert-save-convert loop for any consumer
 * that saves frequently. A future enhancement could add explicit
 * re-promotion on save completion if UX demands it.
 */
export function registerSaveConversion(
    context: vscode.ExtensionContext,
    controller: BaseController,
    lsp: VsCodeLspAdapter,
): void {
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(event => {
            if (!isSupported(event.document)) return;
            const uri = event.document.uri.toString();
            const state = controller.stateManager.getState(uri);
            if (!state || state.format !== 'L3') return;
            lsp.sendFlushPending(uri);
            const text = event.document.getText();
            event.waitUntil(
                controller.formatService.demoteText(text, { uri }).then(converted => {
                    if (converted === text) return [];
                    lsp.sendBatchEditStart(uri);
                    return [vscode.TextEdit.replace(new vscode.Range(0, 0, event.document.lineCount, 0), converted)];
                })
            );
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (!isSupported(doc)) return;
            lsp.sendBatchEditEnd(doc.uri.toString());
        }),
    );
}
