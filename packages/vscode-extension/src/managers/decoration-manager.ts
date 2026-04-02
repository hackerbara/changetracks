import * as vscode from 'vscode';
import type { ChangeNode } from '@changedown/core';
import { isGhostNode } from '@changedown/core';
import { buildDecorationPlan, buildOverviewRulerPlan, applyPlan } from '@changedown/core/dist/host/index';
import { VSCodeDecorationTarget } from '../decoration-target';
import { DecorationScheduler } from './decoration-scheduler';
import { DocumentStateManager } from './document-state-manager';
import { isSupported, logError } from './shared';
import { positionToOffset } from '../converters';
import { getOutputChannel } from '../output-channel';

/**
 * Read-only accessor for view mode state. Avoids circular dependency
 * with ViewModeManager (which holds a DecorationManager reference).
 */
export interface ViewModeAccessor {
    readonly viewMode: import('../view-mode').ViewMode;
    readonly showDelimiters: boolean;
    readonly isProjectedViewActive: boolean;
}

/** Unique key for a visible editor pane. */
function editorKey(editor: vscode.TextEditor): string {
    return `${editor.document.uri.toString()}:${editor.viewColumn ?? 'none'}`;
}

/**
 * DecorationManager owns per-editor decoration targets and all decoration
 * orchestration. Each visible editor gets its own VSCodeDecorationTarget
 * with independent hiddenType, hadHiddenRanges, and author type cache.
 *
 * Extracted from controller.ts to isolate decoration concerns.
 */
export class DecorationManager implements vscode.Disposable {
    private targets = new Map<string, VSCodeDecorationTarget>();
    private style: 'foreground' | 'background';
    private authorColors: 'auto' | 'always' | 'never';
    private localParseHotPath: boolean;
    private viewModeAccessor: ViewModeAccessor | null = null;

    private readonly docStateManager: DocumentStateManager;
    private readonly scheduler: DecorationScheduler;

    constructor(
        docStateManager: DocumentStateManager,
        style: 'foreground' | 'background',
        authorColors: 'auto' | 'always' | 'never',
        localParseHotPath: boolean,
    ) {
        this.docStateManager = docStateManager;
        this.style = style;
        this.authorColors = authorColors;
        this.localParseHotPath = localParseHotPath;

        this.scheduler = new DecorationScheduler({
            performUpdate: (editor) => this.updateDecorations(editor),
            afterUpdate: undefined, // wired by controller after construction
        });
    }

    /** Late-bind view mode accessor to break circular dependency. */
    public setViewModeAccessor(accessor: ViewModeAccessor): void {
        this.viewModeAccessor = accessor;
    }

    /** Update localParseHotPath at runtime (called from onDidChangeConfiguration). */
    public setLocalParseHotPath(value: boolean): void {
        this.localParseHotPath = value;
    }

    /** Set the afterUpdate callback on the scheduler (for cursor context + status bar). */
    public setSchedulerAfterUpdate(fn: (editor: vscode.TextEditor) => void): void {
        this.scheduler.setAfterUpdate(fn);
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

    public updateDecorations(editor: vscode.TextEditor): void {
        if (!isSupported(editor.document)) return;
        if (editor.document.uri.toString().includes('commentinput-')) return;
        if (this.viewModeAccessor?.isProjectedViewActive) return;

        try {
            const text = editor.document.getText();
            const target = this.getOrCreateTarget(editor);
            if (!text) {
                target.setEditor(editor);
                target.clear();
                return;
            }

            const languageId = editor.document.languageId;
            const uri = editor.document.uri.toString();

            let changes: ChangeNode[];
            if (this.localParseHotPath) {
                const virtualDoc = this.docStateManager.workspace.parse(text, languageId);
                changes = virtualDoc.getChanges();
            } else {
                const virtualDoc = this.docStateManager.getVirtualDocumentFor(uri, text, languageId, true);
                changes = virtualDoc.getChanges();
                getOutputChannel()?.appendLine(
                    `[updateDecorations] uri=${uri.split('/').pop()}, changes=${changes.length}, mode=${this.viewModeAccessor?.viewMode}`
                );
            }

            // Log unresolved ghost nodes
            const ch = getOutputChannel();
            if (ch) {
                for (const change of changes) {
                    if (isGhostNode(change)) {
                        ch.appendLine(`[decorator] skipping unresolved L3 node id=${change.id} type=${change.type}`);
                    }
                }
            }

            const viewMode = this.viewModeAccessor?.viewMode ?? 'review';
            const showDelimiters = this.viewModeAccessor?.showDelimiters ?? false;
            const cursorOffset = positionToOffset(text, editor.selection.active);
            const plan = buildDecorationPlan(
                changes, text, viewMode,
                cursorOffset, showDelimiters, this.authorColors,
            );
            const rulerPlan = buildOverviewRulerPlan(changes, viewMode);

            target.setEditor(editor);
            applyPlan(target, plan, rulerPlan, text, changes);
        } catch (err: any) {
            logError(`[updateDecorations] Error for ${editor.document.uri.fsPath}`, err);
        }
    }

    // ── Bulk operations ─────────────────────────────────────────────────

    /** Update decorations for all currently visible supported editors. */
    public updateAllVisible(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (isSupported(editor.document)) {
                this.updateDecorations(editor);
            }
        }
    }

    /** Clear decorations on a specific editor (no-op if no target exists). */
    public clearDecorations(editor: vscode.TextEditor): void {
        const key = editorKey(editor);
        const target = this.targets.get(key);
        if (!target) return;
        target.setEditor(editor);
        target.clear();
    }

    /** Flush hidden type CSS cache on all targets (call before re-decorating after mode switch). */
    public forceHiddenRecreate(): void {
        for (const target of this.targets.values()) {
            target.forceHiddenRecreate();
        }
    }

    /** Schedule a debounced decoration update for an editor. */
    public scheduleUpdate(editor: vscode.TextEditor): void {
        this.scheduler.scheduleUpdate(editor);
    }

    // ── Hidden offsets (for NavigationManager cursor snapping) ───────────

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
        // New targets will be lazily created on next updateDecorations call.
        for (const target of this.targets.values()) {
            target.dispose();
        }
        this.targets.clear();

        // Re-apply decorations to all visible editors (creates fresh targets)
        this.updateAllVisible();
    }

    // ── File rename ─────────────────────────────────────────────────────

    public handleFileRename(oldUri: string, _newUri: string): void {
        // Dispose targets keyed to the old URI. New targets will be
        // lazily created when updateDecorations runs for the new URI.
        for (const [key, target] of this.targets) {
            if (key.startsWith(oldUri + ':')) {
                target.dispose();
                this.targets.delete(key);
            }
        }
    }

    public dispose(): void {
        this.scheduler.dispose();
        for (const target of this.targets.values()) {
            target.dispose();
        }
        this.targets.clear();
    }
}
