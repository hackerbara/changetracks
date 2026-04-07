import * as vscode from 'vscode';
import type { BaseController } from '@changedown/core/host';

export function registerFileRenameHandler(
    context: vscode.ExtensionContext,
    controller: BaseController,
    onRenameCleanup?: (oldUri: string, newUri: string) => void,
): void {
    context.subscriptions.push(
        vscode.workspace.onDidRenameFiles(event => {
            for (const { oldUri, newUri } of event.files) {
                controller.stateManager.migrateState(oldUri.toString(), newUri.toString());
                onRenameCleanup?.(oldUri.toString(), newUri.toString());
            }
        }),
    );
}
