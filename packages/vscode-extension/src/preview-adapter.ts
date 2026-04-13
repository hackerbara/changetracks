import * as vscode from 'vscode';
import { VIEW_PRESETS, type BuiltinView, type DocumentSnapshot, type PreviewPort, type View } from '@changedown/core/host';
import type { PluginConfig } from '@changedown/preview';

/**
 * VS Code adapter for the PreviewPort interface.
 *
 * Stores the latest DocumentSnapshot and exposes getPluginConfig() which
 * the changedownPlugin reads on every markdown-it render pass. Fires
 * markdown.preview.refresh ONLY when the PluginConfig actually changes
 * — diffing the raw display fields would cause spurious refreshes on
 * toggles that don't affect preview output (e.g. delimiters).
 */
export class VsCodePreviewAdapter implements PreviewPort {
    private currentSnapshot: DocumentSnapshot | null = null;
    private lastPluginConfigKey: string = '';

    private effectiveView(): View {
        return this.currentSnapshot?.view ?? VIEW_PRESETS.working;
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
            viewName: view.name as BuiltinView,
        };
    }

    /**
     * Stable serialization of PluginConfig for diffing. Excludes isDarkTheme
     * because theme changes are driven by VS Code events separately.
     */
    private pluginConfigKey(): string {
        const cfg = this.getPluginConfig();
        return JSON.stringify({
            showFootnotes: cfg.showFootnotes,
            authorColors: cfg.authorColors,
            viewName: cfg.viewName,
        });
    }

    update(snapshot: DocumentSnapshot): void {
        this.currentSnapshot = snapshot;
        const newKey = this.pluginConfigKey();
        if (newKey !== this.lastPluginConfigKey) {
            this.lastPluginConfigKey = newKey;
            vscode.commands.executeCommand('markdown.preview.refresh');
        }
    }

    clear(): void {
        this.currentSnapshot = null;
        this.lastPluginConfigKey = '';
    }

    dispose(): void {
        this.currentSnapshot = null;
        this.lastPluginConfigKey = '';
    }
}
