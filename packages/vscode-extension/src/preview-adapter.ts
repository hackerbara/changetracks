import * as vscode from 'vscode';
import { VIEW_PRESETS, type DocumentSnapshot, type PreviewPort, type View } from '@changedown/core/host';
import type { PluginConfig } from '@changedown/preview';

/**
 * VS Code adapter for the PreviewPort interface.
 *
 * Stores the latest DocumentSnapshot and exposes a getPluginConfig()
 * callback that the changedownPlugin reads on every markdown-it render pass.
 * Triggers markdown.preview.refresh when the active view changes.
 */
export class VsCodePreviewAdapter implements PreviewPort {
    private currentSnapshot: DocumentSnapshot | null = null;

    private effectiveView(): View {
        return this.currentSnapshot?.view ?? VIEW_PRESETS.review;
    }

    getPluginConfig(): PluginConfig {
        const view = this.effectiveView();
        return {
            enabled: true,
            showFootnotes: (view.display.footnotes ?? 'show') !== 'hide',
            showComments: true,
            renderInCodeFences: true,
            metadataDetail: 'badge',
            authorColors: view.display.authorColors ?? 'auto',
            isDarkTheme: vscode.window.activeColorTheme?.kind === 2
                || vscode.window.activeColorTheme?.kind === 3,
            viewMode: view.name as any,
        };
    }

    update(snapshot: DocumentSnapshot): void {
        const prevView = this.effectiveView();
        this.currentSnapshot = snapshot;
        const newView = this.effectiveView();

        if (prevView.name !== newView.name || prevView.display.footnotes !== newView.display.footnotes) {
            vscode.commands.executeCommand('markdown.preview.refresh');
        }
    }

    clear(): void {
        this.currentSnapshot = null;
    }

    dispose(): void {
        this.currentSnapshot = null;
    }
}
