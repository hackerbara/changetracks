import * as vscode from 'vscode';

/**
 * Minimal interface for the editor operations VSCodeDecorationTarget needs.
 * Allows injecting a spy/mock in tests.
 */
export interface EditorPort {
    readonly selection: vscode.Selection;
    setDecorations(decorationType: vscode.TextEditorDecorationType, rangesOrOptions: vscode.DecorationOptions[] | vscode.Range[]): void;
}
