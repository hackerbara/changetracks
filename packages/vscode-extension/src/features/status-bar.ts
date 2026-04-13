import * as vscode from 'vscode';
import type { BaseController, BuiltinView } from '@changedown/core/host';
import { VIEW_LABELS } from '@changedown/core/host';

export class StatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(private readonly controller: BaseController) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'changedown.toggleView';
        this.item.tooltip = 'ChangeDown: Click to cycle view mode';

        this.subscriptions.push(
            controller.stateManager.onDidChangeChanges(() => this.update()),
            controller.coherenceService.onDidChangeCoherence(() => this.update()),
            vscode.window.onDidChangeActiveTextEditor(() => this.update()),
            controller.onDidChangeView(() => this.update()),
        );
        this.update();
    }

    update(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            this.item.hide();
            return;
        }
        const uri = editor.document.uri.toString();
        const count = this.controller.getChangesForUri(uri).length;
        const label = VIEW_LABELS[this.controller.getView().name as BuiltinView];
        const cs = this.controller.getCoherence(uri);

        if (cs && cs.unresolvedCount > 0) {
            if (cs.rate < cs.threshold) {
                this.item.text = `$(error) DEGRADED: ${cs.unresolvedCount} unresolved · ${label}`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else {
                this.item.text = `$(warning) ${cs.unresolvedCount} unresolved · ${count - cs.unresolvedCount} resolved · ${label}`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
        } else {
            this.item.text = `$(diff) ${count} change${count === 1 ? '' : 's'} · ${label}`;
            this.item.backgroundColor = undefined;
        }
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
        this.subscriptions.forEach(s => s.dispose());
    }
}
