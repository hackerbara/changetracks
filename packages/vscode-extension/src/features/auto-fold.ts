import * as vscode from 'vscode';

/**
 * Fold lines when LSP decoration data includes autoFoldLines hints.
 * Called from the decoration data handler in extension.ts.
 */
export function autoFold(lines: number[]): void {
    if (lines.length === 0) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const editOpLines = lines.slice(0, -1);
    const sectionLine = lines[lines.length - 1];

    const foldSection = () =>
        vscode.commands.executeCommand('editor.fold', { selectionLines: [sectionLine], levels: 1 }).then(undefined, () => {});

    if (editOpLines.length > 0) {
        vscode.commands.executeCommand('editor.fold', { selectionLines: editOpLines, levels: 1 })
            .then(foldSection, foldSection);
    } else {
        foldSection();
    }
}
