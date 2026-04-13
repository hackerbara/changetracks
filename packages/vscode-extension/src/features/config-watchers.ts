import * as vscode from 'vscode';
import type { BaseController } from '@changedown/core/host';
import type { DecorationManager } from '../managers/decoration-manager';

/**
 * Config watchers wire workspace configuration to BaseController state.
 *
 * Wired fields: decorationStyle, authorColors, showDelimiters.
 * Not wired (preset-only by design, see spec §2 non-goals): deletions,
 * highlights, comments, footnoteRefs, footnotes, cursorReveal.
 *
 * Per-URI fan-out is BaseController's responsibility (see spec §3 Shift 2).
 * Previously each watcher manually looped visible editors calling
 * invalidateRendering; that loop is now inside pushSnapshotForAllUris().
 */
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
                    const colorsValue = cfg.get<string | undefined>('authorColors');
                    const authorColors = colorsValue === undefined
                        ? undefined
                        : (colorsValue === 'always' || colorsValue === 'never')
                            ? colorsValue
                            : 'auto' as const;
                    decorationManager.handleConfigChange(style, authorColors ?? 'auto');
                    if (event.affectsConfiguration('changedown.authorColors')) {
                        controller.setDisplay({ authorColors });
                    } else {
                        // decorationStyle changed but authorColors didn't — still need fan-out
                        // so visible editors re-render with the new painter style.
                        controller.setDisplay({});
                    }
                }
                if (event.affectsConfiguration('changedown.showDelimiters')) {
                    const cfg = vscode.workspace.getConfiguration('changedown');
                    const delimiters = cfg.get<boolean | undefined>('showDelimiters');
                    const value = delimiters === undefined
                        ? undefined
                        : delimiters ? 'show' as const : 'hide' as const;
                    controller.setDisplay({ delimiters: value });
                }
            } catch (err: any) {
                outputChannel.appendLine(`[config-watchers] Error handling config change: ${err?.message ?? err}`);
            }
        }),
    );
}
