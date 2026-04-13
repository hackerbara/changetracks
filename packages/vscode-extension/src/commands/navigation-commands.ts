import * as vscode from 'vscode';
import { findFootnoteBlock } from '@changedown/core';
import type { ChangeNode } from '@changedown/core';
import type { BaseController } from '@changedown/core/host';
import { positionToOffset } from '../converters';
import { isChangeVisibleInView } from '@changedown/core/host';
import { findContainingHiddenRange } from '../hidden-range-search';
import { findSupportedEditor, isSupported, setContextKey } from '../managers/shared';

/**
 * NavigationCommands owns change navigation (next/prev/linked), cursor context
 * tracking, cursor snapping past hidden ranges, and the changeAtCursor context key.
 *
 * Consumes BaseController directly — reads View from controller via getView(),
 * no callbacks. Replaces NavigationManager.
 */
export class NavigationCommands implements vscode.Disposable {
    private lastCursorLine: number = -1;
    private lastCursorChangeId: string | undefined = undefined;
    private lastCursorOffsetByUri = new Map<string, number>();
    private isSnappingCursor = false;
    private disposables: vscode.Disposable[] = [];

    private readonly _onDidChangeCursorChange = new vscode.EventEmitter<string | null>();
    /** Fires when the cursor enters or leaves a change. Payload: change id, or null when cursor is outside all changes. */
    public readonly onDidChangeCursorChange = this._onDidChangeCursorChange.event;

    constructor(
        private readonly controller: BaseController,
        private readonly getHiddenOffsets: (editor: vscode.TextEditor) => ReadonlyArray<{ start: number; end: number }>,
    ) {
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.lastCursorOffsetByUri.delete(doc.uri.toString());
            })
        );
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private changeAtOffset(changes: ChangeNode[], offset: number): ChangeNode | null {
        for (const c of changes) {
            if (c.range.start === c.range.end) {
                if (offset === c.range.start) return c;
            } else if (offset >= c.range.start && offset < c.range.end) {
                return c;
            }
            if (c.range.start > offset) break;
        }
        return null;
    }

    // ── Cursor context ────────────────────────────────────────────────────

    /**
     * Update changedown:changeAtCursor context key when cursor moves or document changes.
     * Used for Keep/Undo keybinding (cmd+y / cmd+n) so they only apply when cursor is inside a change.
     */
    public updateChangeAtCursorContext(editor: vscode.TextEditor): void {
        if (!isSupported(editor.document) || editor.document.languageId !== 'markdown') {
            setContextKey('changedown:changeAtCursor', false);
            return;
        }
        const text = editor.document.getText();
        const uri = editor.document.uri.toString();
        const changes = this.controller.getChangesForUri(uri);
        const cursorOffset = positionToOffset(text, editor.selection.active);
        const change = this.changeAtOffset(changes, cursorOffset);
        setContextKey('changedown:changeAtCursor', change !== null);

        // BaseController handles sendCursorMove via editorHost's cursor event.
        // NavigationCommands only fires its own UI-facing cursor change event.
        const cursorLine = editor.selection.active.line;
        const changeId = change?.id;
        if (cursorLine !== this.lastCursorLine || changeId !== this.lastCursorChangeId) {
            this.lastCursorLine = cursorLine;
            this.lastCursorChangeId = changeId;
            this._onDidChangeCursorChange.fire(change?.id ?? null);
        }
    }

    // ── Change navigation ─────────────────────────────────────────────────

    /**
     * Navigate to the next change from current cursor position.
     */
    public async nextChange(): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor) return;

        const uri = editor.document.uri.toString();
        const view = this.controller.getView();
        const visibleChanges = this.controller.getChangesForUri(uri)
            .filter(c => isChangeVisibleInView(c, view));

        if (visibleChanges.length === 0) {
            vscode.window.showInformationMessage('No visible changes in this view');
            return;
        }

        const cursorOffset = editor.document.offsetAt(editor.selection.active);
        const filter = (c: ChangeNode) => isChangeVisibleInView(c, view);

        const target = this.controller.navigationService.nextChange(uri, cursorOffset, filter);
        if (target) {
            this.revealChange(editor, target);
            return;
        }
        // Wrap to first visible
        this.revealChange(editor, visibleChanges[0]);
        vscode.window.showInformationMessage('Wrapped to first change');
    }

    /**
     * Navigate to the previous change from current cursor position.
     */
    public async previousChange(): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor) return;

        const uri = editor.document.uri.toString();
        const view = this.controller.getView();
        const visibleChanges = this.controller.getChangesForUri(uri)
            .filter(c => isChangeVisibleInView(c, view));

        if (visibleChanges.length === 0) {
            vscode.window.showInformationMessage('No visible changes in this view');
            return;
        }

        const cursorOffset = editor.document.offsetAt(editor.selection.active);
        const filter = (c: ChangeNode) => isChangeVisibleInView(c, view);

        const target = this.controller.navigationService.previousChange(uri, cursorOffset, filter);
        if (target) {
            this.revealChange(editor, target);
            return;
        }
        // Wrap to last visible
        this.revealChange(editor, visibleChanges[visibleChanges.length - 1]);
        vscode.window.showInformationMessage('Wrapped to last change');
    }

    /**
     * Navigate to the linked change in a move group.
     * If cursor is on a move-from, jump to move-to, and vice versa.
     */
    public async goToLinkedChange(): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor) {
            return;
        }

        const text = editor.document.getText();
        const uri = editor.document.uri.toString();
        const cursorOffset = positionToOffset(text, editor.selection.active);

        const changes = this.controller.getChangesForUri(uri);
        const change = this.changeAtOffset(changes, cursorOffset);

        if (!change || !change.groupId || !change.moveRole) {
            vscode.window.showInformationMessage('No linked change found at cursor');
            return;
        }

        // Find the other member with opposite moveRole — getGroupMembers is just a filter
        const members = changes.filter(c => c.groupId === change.groupId);
        const targetRole = change.moveRole === 'from' ? 'to' : 'from';
        const linked = members.find((m: ChangeNode) => m.moveRole === targetRole);

        if (!linked) {
            vscode.window.showInformationMessage('Linked change not found in document');
            return;
        }

        this.revealChange(editor, linked);
    }

    /**
     * Reveal a change by ID in the active editor (e.g. from Change Explorer tree click).
     */
    public revealChangeById(changeId: string): void {
        const editor = findSupportedEditor();
        if (!editor) {
            return;
        }
        const uri = editor.document.uri.toString();
        const changes = this.controller.getChangesForUri(uri);
        const change = changes.find(c => c.id === changeId);
        if (!change) {
            return;
        }
        this.revealChange(editor, change);
    }

    private revealChange(editor: vscode.TextEditor, change: ChangeNode): void {
        const start = change.contentRange?.start ?? change.range.start;
        const pos = editor.document.positionAt(start);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    /**
     * Jump to a footnote definition in the editor by change ID.
     */
    public jumpToFootnoteInEditor(editor: vscode.TextEditor, changeId: string): void {
        const text = editor.document.getText();
        const lines = text.split('\n');
        const block = findFootnoteBlock(lines, changeId);
        if (block) {
            const pos = new vscode.Position(block.headerLine, 0);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(pos, pos);
        } else {
            vscode.window.showInformationMessage(`Footnote [^${changeId}] not found.`);
        }
    }

    // ── Cursor snapping ───────────────────────────────────────────────────

    /**
     * Snap cursor out of hidden ranges using the decorator's own hidden offset data.
     * Handles all event types (mouse, keyboard, command), all hidden region shapes,
     * direction-aware snapping, multi-cursor, and adjacent hidden range chains.
     */
    public snapCursorPastHiddenRanges(
        editor: vscode.TextEditor,
        event: vscode.TextEditorSelectionChangeEvent
    ): void {
        if (this.isSnappingCursor) return;

        const hiddenRanges = this.getHiddenOffsets(editor);
        if (hiddenRanges.length === 0) return;

        const docUri = editor.document.uri.toString();
        const prevOffset = this.lastCursorOffsetByUri.get(docUri) ?? 0;

        let anySnapped = false;
        const newSelections: vscode.Selection[] = [];

        for (const sel of event.selections) {
            if (!sel.isEmpty) {
                newSelections.push(sel);
                continue;
            }

            const cursorOffset = editor.document.offsetAt(sel.active);
            const forward = cursorOffset >= prevOffset;

            let target = cursorOffset;
            for (let i = 0; i < 10; i++) {
                const range = findContainingHiddenRange(hiddenRanges, target);
                if (!range) break;
                target = forward || range.start === 0 ? range.end : range.start - 1;
            }

            if (target !== cursorOffset) {
                anySnapped = true;
                const snapPos = editor.document.positionAt(target);
                newSelections.push(new vscode.Selection(snapPos, snapPos));
            } else {
                newSelections.push(sel);
            }
        }

        // Track direction from primary cursor, per document
        this.lastCursorOffsetByUri.set(
            docUri,
            anySnapped
                ? editor.document.offsetAt(newSelections[0].active)
                : editor.document.offsetAt(event.selections[0].active)
        );

        if (anySnapped) {
            this.isSnappingCursor = true;
            editor.selections = newSelections;
            setTimeout(() => { this.isSnappingCursor = false; }, 0);
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    public dispose(): void {
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        this._onDidChangeCursorChange.dispose();
    }
}
