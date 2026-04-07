import * as vscode from 'vscode';
import type { BaseController } from '@changedown/core/host';
import type { VsCodeLspAdapter } from '../adapters/vscode-lsp-adapter';
import { isSupported } from '../managers/shared';

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
                controller.formatService.demoteToL2(uri, text).then(result => {
                    if (result.convertedText === text) return [];
                    lsp.sendBatchEditStart(uri);
                    return [vscode.TextEdit.replace(new vscode.Range(0, 0, event.document.lineCount, 0), result.convertedText)];
                })
            );
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (!isSupported(doc)) return;
            lsp.sendBatchEditEnd(doc.uri.toString());
        }),
    );
}
