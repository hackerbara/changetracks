import * as vscode from 'vscode';
import { type ViewMode, VIEW_MODES } from '../view-mode';
import { toResolvedUri } from '../resolved-content-provider';
import { annotateFromGit } from '../annotate-command';
import { positionToOffset } from '../converters';
import { isSupported } from '../managers/shared';
import { toggleTracking } from '../features/tracking-toggle';
import type { BaseController, BuiltinView } from '@changedown/core/host';
import { LSP_METHOD, VIEW_PRESETS } from '@changedown/core/host';
import type { VsCodeLspAdapter } from '../adapters';
import type { ProjectedViewAdapter } from '../projected-view-adapter';
import type { DecorationManager } from '../managers/decoration-manager';
import type { NavigationCommands } from './navigation-commands';
import type { ReviewCommands } from './review-commands';
import type { MoveTracker } from '../features/move-tracker';

const VIEW_MODE_TO_BUILTIN: Record<ViewMode, BuiltinView> = {
    review: 'review',
    changes: 'simple',
    settled: 'final',
    raw: 'raw',
};

export interface ChangeCommandsContext {
    expandThreadForChangeId(changeId: string): void;
}

/**
 * Apply view-mode change: handle buffer swap transitions for projected modes
 * (settled/raw), update controller, force decoration recreate, re-render all
 * visible editors, and update context key. Plain helper — NOT a delegation
 * method on ctx.
 */
async function applyViewMode(
    controller: BaseController,
    lsp: VsCodeLspAdapter,
    projectedView: ProjectedViewAdapter,
    decorations: DecorationManager,
    mode: ViewMode,
): Promise<void> {
    const builtinView = VIEW_MODE_TO_BUILTIN[mode];
    const targetPreset = VIEW_PRESETS[builtinView];
    const editor = vscode.window.activeTextEditor;

    const wasProjected = controller.projection !== 'current';
    const willProject = targetPreset.projection !== 'current';

    // Handle buffer swap transitions for projected view
    if (editor && isSupported(editor.document)) {
        if (wasProjected && !willProject) {
            // Leaving projected view → restore original buffer
            await projectedView.exit(editor);
        } else if (!wasProjected && willProject) {
            // Entering projected view → clear stale decorations, swap buffer
            decorations.clearDecorations(editor);
            await projectedView.enter(editor, mode as 'settled' | 'raw');
        } else if (wasProjected && willProject && controller.projection !== targetPreset.projection) {
            // Switching between projected modes → exit then enter
            await projectedView.exit(editor);
            decorations.clearDecorations(editor);
            await projectedView.enter(editor, mode as 'settled' | 'raw');
        }
    }

    controller.setView(VIEW_MODE_TO_BUILTIN[mode]);

    // Send viewMode for other visible supported URIs — LSP filters semantic tokens per-URI.
    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    for (const visible of vscode.window.visibleTextEditors) {
        if (!isSupported(visible.document)) continue;
        const vUri = visible.document.uri.toString();
        if (vUri !== activeUri) {
            lsp.sendViewMode(vUri, mode);
        }
    }

    decorations.forceHiddenRecreate();
    // Invalidate non-active editors so they re-render with the correct View from getView()
    for (const visible of vscode.window.visibleTextEditors) {
        if (!isSupported(visible.document)) continue;
        if (visible.document.uri.toString() === activeUri) continue;
        controller.invalidateRendering(visible.document.uri.toString());
    }
    vscode.commands.executeCommand('setContext', 'changedown:viewMode', controller.getView()?.name ?? 'review');
}

export function registerChangeCommands(
    context: vscode.ExtensionContext,
    controller: BaseController,
    lsp: VsCodeLspAdapter,
    projectedView: ProjectedViewAdapter,
    decorations: DecorationManager,
    navigationCommands: NavigationCommands,
    reviewCommands: ReviewCommands,
    changeComments: ChangeCommandsContext,
    moveTracker: MoveTracker,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('changedown.toggleTracking', () => toggleTracking(controller)),
        vscode.commands.registerCommand('changedown.acceptChange', async (changeId?: string, decision?: 'approve' | 'request_changes', reason?: string) => {
            await reviewCommands.acceptChangeAtCursor(changeId, decision, reason);
        }),
        vscode.commands.registerCommand('changedown.rejectChange', async (changeId?: string, decision?: 'reject', reason?: string) => {
            await reviewCommands.rejectChangeAtCursor(changeId, decision, reason);
        }),
        vscode.commands.registerCommand('changedown.acceptAll', async () => {
            await reviewCommands.acceptAllChanges();
        }),
        vscode.commands.registerCommand('changedown.rejectAll', async () => {
            await reviewCommands.rejectAllChanges();
        }),
        vscode.commands.registerCommand('changedown.acceptAllOnLine', async () => {
            await reviewCommands.acceptAllOnLine();
        }),
        vscode.commands.registerCommand('changedown.rejectAllOnLine', async () => {
            await reviewCommands.rejectAllOnLine();
        }),
        vscode.commands.registerCommand('changedown.nextChange', async () => {
            await navigationCommands.nextChange();
        }),
        vscode.commands.registerCommand('changedown.previousChange', async () => {
            await navigationCommands.previousChange();
        }),
        vscode.commands.registerCommand('changedown.addComment', async () => {
            await reviewCommands.addComment();
        }),
        vscode.commands.registerCommand('changedown.toggleView', async () => {
            const order: ViewMode[] = ['review', 'changes', 'settled', 'raw'];
            const idx = order.indexOf(controller.viewMode);
            await applyViewMode(controller, lsp, projectedView, decorations, order[(idx + 1) % order.length]);
        }),
        vscode.commands.registerCommand('changedown.setViewMode', async (mode: string) => {
            if ((VIEW_MODES as readonly string[]).includes(mode)) {
                await applyViewMode(controller, lsp, projectedView, decorations, mode as ViewMode);
            }
        }),
        vscode.commands.registerCommand('changedown.annotateFromGit', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) await annotateFromGit(editor);
        }),
        vscode.commands.registerCommand('changedown.revealPanel', () => {
            vscode.commands.executeCommand('changedownReview.focus');
        }),
        vscode.commands.registerCommand('changedown.showMenu', () => {
            vscode.commands.executeCommand('changedown.revealPanel');
        }),
        vscode.commands.registerCommand('changedown.clipboardCutAction', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (editor && !editor.selection.isEmpty) {
                    const text = editor.document.getText(editor.selection);
                    moveTracker.prepareCut(text);
                }
            } catch { /* tracker errors must not suppress native cut */ }
            await vscode.commands.executeCommand('editor.action.clipboardCutAction');
        }),
        vscode.commands.registerCommand('changedown.clipboardPasteAction', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    moveTracker.preparePaste(editor.document.uri.toString());
                }
            } catch { /* tracker errors must not suppress native paste */ }
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        }),
        vscode.commands.registerCommand('changedown.goToLinkedChange', async () => {
            await navigationCommands.goToLinkedChange();
        }),
        vscode.commands.registerCommand('changedown.revealChange', (changeId: string) => {
            navigationCommands.revealChangeById(changeId);
            changeComments.expandThreadForChangeId(changeId);
        }),
        vscode.commands.registerCommand('changedown.goToPosition', async (targetUri: string, line: number, character?: number) => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(targetUri));
            const editor = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(line, character ?? 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }),
        vscode.commands.registerCommand('changedown.requestChanges', async (changeId?: string) => {
            await reviewCommands.requestChangesAtCursor(changeId);
        }),
        vscode.commands.registerCommand('changedown.withdrawRequest', async (changeId?: string) => {
            await reviewCommands.withdrawRequestAtCursor(changeId);
        }),
        vscode.commands.registerCommand('changedown.amendChange', async (changeId?: string) => {
            await reviewCommands.amendChangeAtCursor(changeId);
        }),
        vscode.commands.registerCommand('changedown.supersedeChange', async (changeId?: string) => {
            await reviewCommands.supersedeChangeAtCursor(changeId);
        }),
        vscode.commands.registerCommand('changedown.compactChange', async (changeId?: string) => {
            await reviewCommands.compactChange(changeId);
        }),
        vscode.commands.registerCommand('changedown.compactChangeFully', async (changeId?: string) => {
            await reviewCommands.compactChangeFully(changeId);
        }),
        vscode.commands.registerCommand('changedown.showDiff', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const docUri = editor.document.uri;
            const resolvedUri = toResolvedUri(docUri);
            const title = `${editor.document.fileName.split('/').pop()}: Settled ↔ Current`;
            await vscode.commands.executeCommand('vscode.diff', resolvedUri, docUri, title);
        }),
        // Lifecycle commands that take a changeId string (called from review panel webview)
        vscode.commands.registerCommand('changedown.resolveByChangeId', async (changeId?: string) => {
            if (!changeId) return;
            await reviewCommands.sendLifecycleRequest(LSP_METHOD.RESOLVE_THREAD, { changeId });
        }),
        vscode.commands.registerCommand('changedown.unresolveByChangeId', async (changeId?: string) => {
            if (!changeId) return;
            await reviewCommands.sendLifecycleRequest(LSP_METHOD.UNRESOLVE_THREAD, { changeId });
        }),
        vscode.commands.registerCommand('changedown.viewDeliberation', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const text = editor.document.getText();
            const cursorOffset = positionToOffset(text, editor.selection.active);
            const changes = controller.getAuthoredChanges(editor.document.uri.toString());
            const change = changes.find(c => c.range.start <= cursorOffset && cursorOffset <= c.range.end);
            if (!change?.id) {
                vscode.window.showInformationMessage('No tracked change at cursor');
                return;
            }
            navigationCommands.revealChangeById(change.id);
            changeComments.expandThreadForChangeId(change.id);
        }),
    );
}
