import * as vscode from 'vscode';
import { isGhostNode } from '@changedown/core';
import {
  buildDecorationPlan, buildOverviewRulerPlan, applyPlan,
  type DecorationPort, type DocumentSnapshot,
} from '@changedown/core/host';
import { VSCodeDecorationTarget } from '../decoration-target';
import { isSupported, logError } from './shared';
import { positionToOffset } from '../converters';
import { getOutputChannel } from '../output-channel';

/** Unique key for a visible editor pane. */
function editorKey(editor: vscode.TextEditor): string {
    return `${editor.document.uri.toString()}:${editor.viewColumn ?? 'none'}`;
}

/**
 * DecorationManager owns per-editor decoration targets and all decoration
 * orchestration. It implements DecorationPort so BaseController's scheduler
 * can push snapshots into it directly.
 *
 * Each visible editor gets its own VSCodeDecorationTarget with independent
 * hiddenType, hadHiddenRanges, and author type cache.
 */
export class DecorationManager implements DecorationPort, vscode.Disposable {
    private targets = new Map<string, VSCodeDecorationTarget>();
    private style: 'foreground' | 'background';
    private authorColors: 'auto' | 'always' | 'never';
    private afterUpdate: ((editor: vscode.TextEditor) => void) | undefined;

    constructor(
        style: 'foreground' | 'background',
        authorColors: 'auto' | 'always' | 'never',
    ) {
        this.style = style;
        this.authorColors = authorColors;
    }

    /** Hook invoked after a decoration update (for status bar + cursor context refresh). */
    public setAfterUpdate(fn: (editor: vscode.TextEditor) => void): void {
        this.afterUpdate = fn;
    }

    // ── DecorationPort implementation ────────────────────────────────────

    /** Called by BaseController's scheduler with a snapshot to render. */
    public update(snapshot: DocumentSnapshot): void {
        // Render for each visible editor showing this URI
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() !== snapshot.uri) continue;
            if (!isSupported(editor.document)) continue;
            this.renderSnapshot(editor, snapshot);
        }
    }

    /** Clear decorations for a URI (or all URIs if uri is undefined). */
    public clear(uri?: string): void {
        if (uri === undefined) {
            for (const target of this.targets.values()) target.dispose();
            this.targets.clear();
            return;
        }
        this.disposeTargetsForUri(uri);
    }

    private disposeTargetsForUri(uri: string): void {
        for (const [key, target] of this.targets) {
            if (key.startsWith(uri + ':')) {
                target.dispose();
                this.targets.delete(key);
            }
        }
    }

    // ── Per-editor target lifecycle ──────────────────────────────────────

    private getOrCreateTarget(editor: vscode.TextEditor): VSCodeDecorationTarget {
        const key = editorKey(editor);
        let target = this.targets.get(key);
        if (!target) {
            target = new VSCodeDecorationTarget(editor, this.style);
            this.targets.set(key, target);
        }
        return target;
    }

    /**
     * Subscribe to visible editor changes to dispose targets for editors
     * that are no longer visible. Call once during extension activation.
     */
    public subscribeVisibilityCleanup(subscriptions: vscode.Disposable[]): void {
        subscriptions.push(
            vscode.window.onDidChangeVisibleTextEditors(editors => {
                const visibleKeys = new Set(
                    editors.filter(e => isSupported(e.document)).map(e => editorKey(e))
                );
                for (const [key, target] of this.targets) {
                    if (!visibleKeys.has(key)) {
                        target.dispose();
                        this.targets.delete(key);
                    }
                }
            })
        );
    }

    // ── Decoration pipeline ─────────────────────────────────────────────

    /**
     * Render a snapshot (text + changes + view + cursor) into an editor.
     * Core entry — used by both DecorationPort.update and direct calls.
     */
    public renderSnapshot(editor: vscode.TextEditor, snapshot: DocumentSnapshot): void {
        if (!isSupported(editor.document)) return;
        if (editor.document.uri.toString().includes('commentinput-')) return;

        try {
            const text = snapshot.text;
            const target = this.getOrCreateTarget(editor);
            if (!text) {
                target.setEditor(editor);
                target.clear();
                return;
            }

            const changes = snapshot.changes;

            // Log unresolved ghost nodes
            const ch = getOutputChannel();
            if (ch) {
                for (const change of changes) {
                    if (isGhostNode(change)) {
                        ch.appendLine(`[decorator] skipping unresolved L3 node id=${change.id} type=${change.type}`);
                    }
                }
            }

            const cursorOffset = snapshot.cursorOffset ?? positionToOffset(text, editor.selection.active);
            const plan = buildDecorationPlan(
                changes, text, snapshot.view,
                cursorOffset,
            );
            const rulerPlan = buildOverviewRulerPlan(changes, snapshot.view);

            target.setEditor(editor);
            applyPlan(target, plan, rulerPlan, text, changes);

            this.afterUpdate?.(editor);
        } catch (err: any) {
            logError(`[updateDecorations] Error for ${editor.document.uri.fsPath}`, err);
        }
    }

    // ── Bulk operations ─────────────────────────────────────────────────

    /** Clear decorations on a specific editor (no-op if no target exists). */
    public clearDecorations(editor: vscode.TextEditor): void {
        const key = editorKey(editor);
        const target = this.targets.get(key);
        if (!target) return;
        target.setEditor(editor);
        target.clear();
    }

    // ── Hidden offsets (for NavigationCommands cursor snapping) ───────────

    /** Get hidden offset ranges for a specific editor. */
    public getHiddenOffsetsForEditor(editor: vscode.TextEditor): ReadonlyArray<{ start: number; end: number }> {
        const key = editorKey(editor);
        const target = this.targets.get(key);
        return target?.getHiddenOffsets() ?? [];
    }

    // ── Config change ───────────────────────────────────────────────────

    public handleConfigChange(newStyle: 'foreground' | 'background', newAuthorColors: 'auto' | 'always' | 'never'): void {
        this.style = newStyle;
        this.authorColors = newAuthorColors;

        // Dispose all existing targets and clear the map.
        // New targets will be lazily created on next update call.
        for (const target of this.targets.values()) {
            target.dispose();
        }
        this.targets.clear();
    }

    // ── File rename ─────────────────────────────────────────────────────

    public handleFileRename(oldUri: string, _newUri: string): void {
        // Dispose targets keyed to the old URI. New targets will be
        // lazily created when updateDecorations runs for the new URI.
        this.disposeTargetsForUri(oldUri);
    }

    public dispose(): void {
        for (const target of this.targets.values()) {
            target.dispose();
        }
        this.targets.clear();
    }
}
