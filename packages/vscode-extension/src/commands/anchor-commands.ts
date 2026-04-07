import * as vscode from 'vscode';
import { isGhostNode } from '@changedown/core';
import type { ChangeNode } from '@changedown/core';
import type { BaseController } from '@changedown/core/host';

interface AnchorQuickPickItem extends vscode.QuickPickItem {
  change: ChangeNode;
}

export class AnchorCommands implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly controller: BaseController) {
    this.disposables.push(
      vscode.commands.registerCommand('changedown.inspectAnchors', () => this.inspectAnchors()),
      vscode.commands.registerCommand('changedown.inspectUnresolved', () => this.inspectAnchors()),
      vscode.commands.registerCommand('changedown.repairAnchors', () => this.repairAnchors()),
    );
  }

  private async inspectAnchors(): Promise<void> {
    const uri = this.controller.getActiveUri();
    if (!uri) return;

    const state = this.controller.getState(uri);
    if (!state) return;

    const unresolved = state.cachedChanges.filter(isGhostNode);

    if (unresolved.length === 0) {
      vscode.window.showInformationMessage('All anchors resolved.');
      return;
    }

    const items: AnchorQuickPickItem[] = unresolved.map(c => ({
      label: `${c.id}: ${c.type}`,
      description: 'unresolved',
      detail: `Line range: ${c.range.start}-${c.range.end}`,
      change: c,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Unresolved Anchors',
      placeHolder: `${unresolved.length} unresolved anchor(s)`,
    });

    if (picked) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const pos = editor.document.positionAt(picked.change.range.start);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos));
      }
    }
  }

  private async repairAnchors(): Promise<void> {
    const uri = this.controller.getActiveUri();
    if (!uri) {
      vscode.window.showWarningMessage('No active document.');
      return;
    }

    const state = this.controller.getState(uri);
    if (!state || state.format !== 'L3') {
      vscode.window.showInformationMessage('Anchor repair requires L3 format.');
      return;
    }

    // Trigger format round-trip: L3 → L2 → L3 forces re-anchoring
    const result = await this.controller.formatService.demoteToL2(uri, state.text);
    const repaired = await this.controller.formatService.promoteToL3(uri, result.convertedText);

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length)
      );
      await editor.edit(b => b.replace(fullRange, repaired.convertedText));
    }

    vscode.window.showInformationMessage('Anchors re-resolved via format round-trip.');
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
