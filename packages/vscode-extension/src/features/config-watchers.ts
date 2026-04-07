import * as vscode from 'vscode';
import type { BaseController } from '@changedown/core/host';
import type { DecorationManager } from '../managers/decoration-manager';
import { isSupported } from '../managers/shared';

export function registerConfigWatchers(
    context: vscode.ExtensionContext,
    controller: BaseController,
    decorationManager: DecorationManager,
    outputChannel: vscode.OutputChannel,
): void {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            try {
                if (event.affectsConfiguration('changedown.decorationStyle') ||
                    event.affectsConfiguration('changedown.authorColors')) {
                    const cfg = vscode.workspace.getConfiguration('changedown');
                    const style = cfg.get<string>('decorationStyle', 'foreground') === 'background'
                        ? 'background' as const
                        : 'foreground' as const;
                    const colors = cfg.get<string>('authorColors', 'auto');
                    const authorColors = (colors === 'always' || colors === 'never') ? colors : 'auto' as const;
                    decorationManager.handleConfigChange(style, authorColors);
                    if (event.affectsConfiguration('changedown.authorColors')) {
                        controller.setDisplay({ authorColors });
                    }
                    // setDisplay() pushes snapshot for the active editor.
                    // For non-active visible editors, invalidate rendering so they re-render.
                    for (const editor of vscode.window.visibleTextEditors) {
                        if (isSupported(editor.document)) {
                            controller.invalidateRendering(editor.document.uri.toString());
                        }
                    }
                }
                if (event.affectsConfiguration('changedown.showDelimiters')) {
                    const showDelimiters = vscode.workspace.getConfiguration('changedown').get<boolean>('showDelimiters', false);
                    controller.setDisplay({ delimiters: showDelimiters ? 'show' : 'hide' });
                    // setDisplay() pushes snapshot for the active editor.
                    // For non-active visible editors, invalidate rendering so they re-render.
                    for (const editor of vscode.window.visibleTextEditors) {
                        if (isSupported(editor.document)) {
                            controller.invalidateRendering(editor.document.uri.toString());
                        }
                    }
                }
                if (event.affectsConfiguration('changedown.localParseHotPath')) {
                    decorationManager.setLocalParseHotPath(
                        vscode.workspace.getConfiguration('changedown').get('localParseHotPath', false),
                    );
                }
            } catch (err: any) {
                outputChannel.appendLine(`[config-watchers] Error handling config change: ${err?.message ?? err}`);
            }
        }),
    );
}
