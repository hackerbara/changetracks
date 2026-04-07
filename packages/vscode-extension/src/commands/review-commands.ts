import * as vscode from 'vscode';
import { ChangeNode, ChangeStatus, nodeStatus, scanMaxCnId, generateFootnoteDefinition, appendFootnote, insertComment } from '@changedown/core';
import type { BaseController, RangeEdit } from '@changedown/core/host';
import { LSP_METHOD, type LspMethod } from '@changedown/core/host';
import { positionToOffset, coreEditToVscode, lspEditToRangeEdit } from '../converters';
import { formatReply } from '../footnote-writer';
import { resolveAuthorIdentity } from '../author-identity';
import type { VsCodeLspAdapter } from '../adapters/vscode-lsp-adapter';
import type { VsCodeEditorHost } from '../adapters/vscode-editor-host';
import { findSupportedEditor, isSupported } from '../managers/shared';

// ── Standalone utility ─────────────────────────────────────────────────

/**
 * Find a change by ID in a list.
 * Exported as a named function for testability.
 */
export function findChangeInList(
    changes: ChangeNode[],
    changeId?: string,
): ChangeNode | undefined {
    if (!changeId) return undefined;
    return changes.find(c => c.id === changeId);
}

// ── ReviewCommands ─────────────────────────────────────────────────────

/**
 * ReviewCommands owns all review/lifecycle command handlers:
 * accept, reject, amend, supersede, compact, bulk operations, add comment,
 * and the shared findChangeForCommand helper.
 *
 * Consumes BaseController + adapters directly — no ChangeDownContext bag.
 */
export class ReviewCommands implements vscode.Disposable {
    constructor(
        private readonly controller: BaseController,
        private readonly lspAdapter: VsCodeLspAdapter,
        private readonly editorHost: VsCodeEditorHost,
    ) {}

    // ── Helpers ────────────────────────────────────────────────────

    private getChangesForUri(uri: string): ChangeNode[] {
        return this.controller.getChangesForUri(uri);
    }

    private changeAtOffset(changes: ChangeNode[], offset: number): ChangeNode | null {
        for (const c of changes) {
            if (c.range.start === c.range.end) {
                if (offset === c.range.start) return c;
            } else if (offset >= c.range.start && offset < c.range.end) {
                return c;
            }
        }
        return null;
    }

    /**
     * Send a lifecycle LSP request and apply the returned edits to the active editor.
     * Used by accept/reject/amend/supersede/resolve/unresolve commands.
     */
    public async sendLifecycleRequest<T extends { edit?: unknown; edits?: unknown[]; error?: string; warning?: string }>(
        requestName: LspMethod,
        params: Record<string, unknown>
    ): Promise<{ success: boolean; result?: T }> {
        const editor = findSupportedEditor();
        if (!editor) return { success: false };

        const uri = editor.document.uri.toString();
        this.lspAdapter.sendBatchEditStart(uri);
        try {
            let result: T;
            try {
                result = await this.lspAdapter.sendRequest(requestName, { uri, ...params }) as T;
            } catch (err) {
                vscode.window.showErrorMessage(`LSP request failed: ${err instanceof Error ? err.message : String(err)}`);
                return { success: false };
            }

            if (result.error) {
                if (result.error === 'unresolved_discussion' && result.warning) {
                    const proceed = await vscode.window.showWarningMessage(
                        result.warning,
                        { modal: true },
                        'Proceed Anyway'
                    );
                    if (proceed !== 'Proceed Anyway') return { success: false };
                    return this.sendLifecycleRequest(requestName, { ...params, force: true });
                }
                vscode.window.showErrorMessage(result.error);
                return { success: false };
            }

            // Handle both singular 'edit' and plural 'edits'
            const rawEdits = (result.edits ?? (result.edit ? [result.edit] : [])) as Record<string, unknown>[];
            if (rawEdits.length > 0) {
                const rangeEdits: RangeEdit[] = rawEdits.map(edit => {
                    if ('range' in edit && edit.range) {
                        return lspEditToRangeEdit(edit as { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string });
                    } else {
                        const offset = edit.offset as number;
                        const length = edit.length as number;
                        const startPos = editor.document.positionAt(offset);
                        const endPos = editor.document.positionAt(offset + length);
                        return {
                            range: {
                                start: { line: startPos.line, character: startPos.character },
                                end: { line: endPos.line, character: endPos.character },
                            },
                            newText: edit.newText as string,
                        };
                    }
                });
                await this.editorHost.applyEdits(uri, rangeEdits);

                this.controller.stateManager.invalidateCache(uri);
            }

            return { success: true, result };
        } finally {
            this.lspAdapter.sendBatchEditEnd(uri);
        }
    }

    /** Fetch project config from LSP. */
    public async getProjectConfig(): Promise<{ reasonRequired: { human: boolean } }> {
        try {
            const result = await this.lspAdapter.sendRequest(LSP_METHOD.GET_PROJECT_CONFIG, {});
            return result as { reasonRequired: { human: boolean } };
        } catch {
            return { reasonRequired: { human: false } };
        }
    }

    // ── Shared helpers ────────────────────────────────────────────────

    /**
     * Find a change by ID or at the current cursor position.
     * Shared helper used by accept/reject/amend/supersede/compact commands.
     */
    public findChangeForCommand(changeId?: string): { change: ChangeNode; editor: vscode.TextEditor } | null {
        const editor = findSupportedEditor();
        if (!editor) return null;

        const text = editor.document.getText();
        const uri = editor.document.uri.toString();
        const changes = this.getChangesForUri(uri);

        let change: ChangeNode | null | undefined;
        if (changeId) {
            change = changes.find((c: ChangeNode) => c.id === changeId) ?? null;
        } else {
            const cursorOffset = positionToOffset(text, editor.selection.active);
            change = this.changeAtOffset(changes, cursorOffset);
        }

        if (!change) {
            vscode.window.showInformationMessage('No change found at cursor position');
            return null;
        }

        return { change, editor };
    }

    /**
     * Read author name with fallback chain.
     * Resolution order: changedown.author -> git config user.name -> system username -> 'unknown'.
     * When resource is provided, uses resource-scoped config so workspace/folder author is used for that document.
     */
    public getAuthor(resource?: vscode.Uri): string {
        return resolveAuthorIdentity(resource);
    }

    /**
     * Show a modal confirmation dialog before a bulk accept/reject operation.
     * Returns true if the user confirmed (or if the threshold is not exceeded).
     * Controlled by changedown.confirmBulkThreshold (default 5, 0 = disabled).
     */
    public async confirmBulkAction(action: string, count: number): Promise<boolean> {
        const threshold = vscode.workspace.getConfiguration('changedown').get<number>('confirmBulkThreshold', 5);
        if (threshold <= 0 || count <= threshold) return true;
        const label = `${action} All`;
        try {
            const choice = await vscode.window.showWarningMessage(
                `${action} all ${count} changes?`,
                { modal: true },
                label
            );
            return choice === label;
        } catch {
            // VS Code test host refuses modal dialogs — proceed without confirmation
            return true;
        }
    }

    // ── Single-change review commands ─────────────────────────────────

    /**
     * Accept a change by ID (from CodeLens) or at the current cursor position.
     * When called without `decision`, shows QuickPick for user to choose
     * (approve / approve with reason / request changes).
     * When `decision` is provided, bypasses all UI for programmatic callers.
     * Delegates to LSP for all edit computation.
     */
    public async acceptChangeAtCursor(changeId?: string, decision?: 'approve' | 'request_changes', reason?: string): Promise<void> {
        const found = this.findChangeForCommand(changeId);
        if (!found) return;
        const { change } = found;

        if (!decision) {
            const config = await this.getProjectConfig();
            decision = 'approve';

            if (config.reasonRequired.human) {
                // Reason is mandatory
                reason = await vscode.window.showInputBox({
                    prompt: 'Reason for accepting this change (required)',
                    placeHolder: 'Enter reason...',
                    validateInput: (v) => v.trim() ? null : 'Reason is required',
                });
                if (reason === undefined) return; // cancelled
            } else {
                // QuickPick with 3 options
                interface QuickPickAction extends vscode.QuickPickItem { value: string }
                const pick = await vscode.window.showQuickPick<QuickPickAction>([
                    { label: '$(check) Accept', description: 'Accept this change', value: 'approve' },
                    { label: '$(edit) Accept with reason...', description: 'Accept and provide a reason', value: 'approve_reason' },
                    { label: '$(comment-discussion) Request Changes...', description: 'Request modifications', value: 'request_changes' },
                ], { placeHolder: 'Review change' });
                if (!pick) return; // cancelled

                if (pick.value === 'approve_reason') {
                    reason = await vscode.window.showInputBox({
                        prompt: 'Reason for accepting',
                        placeHolder: 'Enter reason...',
                    });
                    if (reason === undefined) return;
                } else if (pick.value === 'request_changes') {
                    decision = 'request_changes';
                    reason = await vscode.window.showInputBox({
                        prompt: 'What changes are needed?',
                        placeHolder: 'Describe requested changes...',
                        validateInput: (v) => v.trim() ? null : 'Feedback is required',
                    });
                    if (reason === undefined) return;
                }
                // else: plain approve, no reason needed
            }
        }

        const { success } = await this.sendLifecycleRequest(LSP_METHOD.REVIEW_CHANGE, {
            changeId: change.id ?? '',
            decision,
            reason,
        });
        if (success) {
            const msg = decision === 'request_changes' ? 'Changes requested' : 'Change accepted';
            vscode.window.showInformationMessage(msg);
        }
    }

    /**
     * Reject a change by ID (from CodeLens) or at the current cursor position.
     * When called without `decision`, shows QuickPick for optional reason.
     * When `decision` is provided, bypasses all UI for programmatic callers.
     * Delegates to LSP for all edit computation.
     */
    public async rejectChangeAtCursor(changeId?: string, decision?: 'reject', reason?: string): Promise<void> {
        const found = this.findChangeForCommand(changeId);
        if (!found) return;
        const { change } = found;

        if (!decision) {
            const config = await this.getProjectConfig();

            if (config.reasonRequired.human) {
                reason = await vscode.window.showInputBox({
                    prompt: 'Reason for rejecting this change (required)',
                    placeHolder: 'Enter reason...',
                    validateInput: (v) => v.trim() ? null : 'Reason is required',
                });
                if (reason === undefined) return;
            } else {
                interface QuickPickAction extends vscode.QuickPickItem { value: string }
                const pick = await vscode.window.showQuickPick<QuickPickAction>([
                    { label: '$(close) Reject', description: 'Reject this change', value: 'reject' },
                    { label: '$(edit) Reject with reason...', description: 'Reject and provide a reason', value: 'reject_reason' },
                ], { placeHolder: 'Reject change' });
                if (!pick) return;

                if (pick.value === 'reject_reason') {
                    reason = await vscode.window.showInputBox({
                        prompt: 'Reason for rejecting',
                        placeHolder: 'Enter reason...',
                    });
                    if (reason === undefined) return;
                }
            }
        }

        const { success } = await this.sendLifecycleRequest(LSP_METHOD.REVIEW_CHANGE, {
            changeId: change.id ?? '',
            decision: 'reject',
            reason,
        });
        if (success) {
            vscode.window.showInformationMessage('Change rejected');
        }
    }

    /**
     * Request changes on a change by ID or at cursor position.
     * Always requires a reason explaining what changes are needed.
     */
    public async requestChangesAtCursor(changeId?: string): Promise<void> {
        const found = this.findChangeForCommand(changeId);
        if (!found) return;
        const { change } = found;

        const reason = await vscode.window.showInputBox({
            prompt: 'What changes are needed?',
            placeHolder: 'Describe requested changes...',
            validateInput: (v) => v.trim() ? null : 'Feedback is required',
        });
        if (reason === undefined) return;

        const { success } = await this.sendLifecycleRequest(LSP_METHOD.REVIEW_CHANGE, {
            changeId: change.id ?? '',
            decision: 'request_changes',
            reason,
        });
        if (success) {
            vscode.window.showInformationMessage('Changes requested');
        }
    }

    /**
     * Withdraw a previous request-changes decision on a change by ID or at cursor position.
     */
    public async withdrawRequestAtCursor(changeId?: string): Promise<void> {
        const found = this.findChangeForCommand(changeId);
        if (!found) return;
        const { change } = found;

        const { success } = await this.sendLifecycleRequest(LSP_METHOD.REVIEW_CHANGE, {
            changeId: change.id ?? '',
            decision: 'withdraw',
        });
        if (success) {
            vscode.window.showInformationMessage('Request withdrawn');
        }
    }

    /**
     * Amend a change by ID or at cursor position.
     * Shows InputBox pre-populated with current text, then asks for reason.
     */
    public async amendChangeAtCursor(changeId?: string): Promise<void> {
        const found = this.findChangeForCommand(changeId);
        if (!found) return;
        const { change } = found;

        const currentText = change.modifiedText ?? change.originalText ?? '';
        const newText = await vscode.window.showInputBox({
            prompt: `Amend ${change.id ?? 'change'}`,
            value: currentText,
            placeHolder: 'Enter amended text...',
        });
        if (newText === undefined) return;

        const reason = await vscode.window.showInputBox({
            prompt: 'Reason for amendment',
            placeHolder: 'Enter reason...',
        });
        if (reason === undefined) return;

        const { success } = await this.sendLifecycleRequest(LSP_METHOD.AMEND_CHANGE, {
            changeId: change.id ?? '',
            newText,
            reason,
        });
        if (success) {
            vscode.window.showInformationMessage('Change amended');
        }
    }

    /**
     * Supersede a change by ID or at cursor position.
     * Shows InputBox for replacement text, then asks for reason.
     */
    public async supersedeChangeAtCursor(changeId?: string): Promise<void> {
        const found = this.findChangeForCommand(changeId);
        if (!found) return;
        const { change } = found;

        const newText = await vscode.window.showInputBox({
            prompt: `Propose alternative for ${change.id ?? 'change'}`,
            placeHolder: 'Enter replacement text...',
        });
        if (newText === undefined) return;

        const reason = await vscode.window.showInputBox({
            prompt: 'Reason for superseding',
            placeHolder: 'Enter reason...',
        });
        if (reason === undefined) return;

        const { success } = await this.sendLifecycleRequest(LSP_METHOD.SUPERSEDE_CHANGE, {
            changeId: change.id ?? '',
            newText,
            reason,
        });
        if (success) {
            vscode.window.showInformationMessage('Change superseded');
        }
    }

    // ── Bulk review commands ──────────────────────────────────────────

    /**
     * Accept all pending changes in the document.
     */
    public async acceptAllChanges(): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor) return;

        const uri = editor.document.uri.toString();
        const changes = this.getChangesForUri(uri);

        if (changes.length === 0) {
            vscode.window.showInformationMessage('No changes found in document');
            return;
        }

        if (!await this.confirmBulkAction('Accept', changes.length)) return;

        const { success, result } = await this.sendLifecycleRequest<{ edit?: unknown; reviewedCount?: number; error?: string }>(LSP_METHOD.REVIEW_ALL, {
            decision: 'approve',
        });
        if (success && result?.reviewedCount) {
            vscode.window.showInformationMessage(`Accepted ${result.reviewedCount} change${result.reviewedCount === 1 ? '' : 's'}`);
        }
    }

    /**
     * Reject all pending changes in the document.
     */
    public async rejectAllChanges(): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor) return;

        const uri = editor.document.uri.toString();
        const changes = this.getChangesForUri(uri);

        if (changes.length === 0) {
            vscode.window.showInformationMessage('No changes found in document');
            return;
        }

        if (!await this.confirmBulkAction('Reject', changes.length)) return;

        const { success, result } = await this.sendLifecycleRequest<{ edit?: unknown; reviewedCount?: number; error?: string }>(LSP_METHOD.REVIEW_ALL, {
            decision: 'reject',
        });
        if (success && result?.reviewedCount) {
            vscode.window.showInformationMessage(`Rejected ${result.reviewedCount} change${result.reviewedCount === 1 ? '' : 's'}`);
        }
    }

    // ── Line-scoped review commands ───────────────────────────────────

    /**
     * Accept all proposed changes on the current cursor line.
     * Captures change IDs from the original cursor line BEFORE the LSP call
     * and passes them to reviewAll, which processes all of them atomically.
     */
    public async acceptAllOnLine(): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor) return;

        const text = editor.document.getText();
        const uri = editor.document.uri.toString();
        const cursorLine = editor.selection.active.line;
        const allChanges = this.getChangesForUri(uri);

        // Find proposed changes on current line
        const onLine = allChanges.filter((c: ChangeNode) => {
            if (c.decided || c.status !== ChangeStatus.Proposed) return false;
            const changeLineNum = text.slice(0, c.range.start).split('\n').length - 1;
            return changeLineNum === cursorLine;
        });

        if (onLine.length === 0) {
            vscode.window.showInformationMessage('No proposed changes on this line');
            return;
        }

        const targetChangeIds = onLine.map((c: ChangeNode) => c.id).filter((id): id is string => Boolean(id));

        const { success, result } = await this.sendLifecycleRequest<{ edit?: unknown; reviewedCount?: number; error?: string }>(LSP_METHOD.REVIEW_ALL, {
            decision: 'approve',
            changeIds: targetChangeIds,
        });
        if (success && result?.reviewedCount) {
            vscode.window.showInformationMessage(`Accepted ${result.reviewedCount} change${result.reviewedCount === 1 ? '' : 's'} on line`);
        }
    }

    /**
     * Reject all proposed changes on the current cursor line.
     * Captures change IDs from the original cursor line BEFORE the LSP call
     * and passes them to reviewAll, which processes all of them atomically.
     */
    public async rejectAllOnLine(): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor) return;

        const text = editor.document.getText();
        const uri = editor.document.uri.toString();
        const cursorLine = editor.selection.active.line;
        const allChanges = this.getChangesForUri(uri);

        // Find proposed changes on current line
        const onLine = allChanges.filter((c: ChangeNode) => {
            if (c.decided || c.status !== ChangeStatus.Proposed) return false;
            const changeLineNum = text.slice(0, c.range.start).split('\n').length - 1;
            return changeLineNum === cursorLine;
        });

        if (onLine.length === 0) {
            vscode.window.showInformationMessage('No proposed changes on this line');
            return;
        }

        const targetChangeIds = onLine.map((c: ChangeNode) => c.id).filter((id): id is string => Boolean(id));

        const { success, result } = await this.sendLifecycleRequest<{ edit?: unknown; reviewedCount?: number; error?: string }>(LSP_METHOD.REVIEW_ALL, {
            decision: 'reject',
            changeIds: targetChangeIds,
        });
        if (success && result?.reviewedCount) {
            vscode.window.showInformationMessage(`Rejected ${result.reviewedCount} change${result.reviewedCount === 1 ? '' : 's'} on line`);
        }
    }

    // ── Document-scoped review commands (SCM context menu) ────────────

    /**
     * Accept all pending changes in the document at the given URI.
     * Used from SCM context menu (file-scoped accept all).
     */
    public async acceptAllInDocument(uri: vscode.Uri): Promise<void> {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
            ?? await vscode.workspace.openTextDocument(uri);
        if (!isSupported(doc)) return;

        const uriStr = uri.toString();
        const changes = this.getChangesForUri(uriStr);
        if (changes.length === 0) return;
        if (!await this.confirmBulkAction('Accept', changes.length)) return;

        // CRITICAL: Focus target document before the LSP call.
        // sendLifecycleRequest uses findSupportedEditor() which returns the ACTIVE editor.
        // If SCM context menu targets a non-active document, this silently operates on the wrong doc.
        await vscode.window.showTextDocument(doc, { preview: false });

        const { success, result } = await this.sendLifecycleRequest<{ edit?: unknown; reviewedCount?: number; error?: string }>(LSP_METHOD.REVIEW_ALL, {
            decision: 'approve',
        });
        if (success && result?.reviewedCount) {
            vscode.window.showInformationMessage(`Accepted ${result.reviewedCount} change${result.reviewedCount === 1 ? '' : 's'} in file`);
        }
    }

    /**
     * Reject all pending changes in the document at the given URI.
     * Used from SCM context menu (file-scoped reject all).
     */
    public async rejectAllInDocument(uri: vscode.Uri): Promise<void> {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
            ?? await vscode.workspace.openTextDocument(uri);
        if (!isSupported(doc)) return;

        const uriStr = uri.toString();
        const changes = this.getChangesForUri(uriStr);
        if (changes.length === 0) return;
        if (!await this.confirmBulkAction('Reject', changes.length)) return;

        // CRITICAL: Focus target document before the LSP call.
        // sendLifecycleRequest uses findSupportedEditor() which returns the ACTIVE editor.
        // If SCM context menu targets a non-active document, this silently operates on the wrong doc.
        await vscode.window.showTextDocument(doc, { preview: false });

        const { success, result } = await this.sendLifecycleRequest<{ edit?: unknown; reviewedCount?: number; error?: string }>(LSP_METHOD.REVIEW_ALL, {
            decision: 'reject',
        });
        if (success && result?.reviewedCount) {
            vscode.window.showInformationMessage(`Rejected ${result.reviewedCount} change${result.reviewedCount === 1 ? '' : 's'} in file`);
        }
    }

    // ── Compact commands ──────────────────────────────────────────────

    /**
     * Compact a change from Level 2 to Level 1 via LSP.
     * If changeId is provided, finds the change by ID; otherwise uses cursor position.
     */
    public async compactChange(changeId?: string): Promise<void> {
        const found = this.findChangeForCommand(changeId);
        if (!found) return;
        const { change } = found;

        const { success } = await this.sendLifecycleRequest(LSP_METHOD.COMPACT_CHANGE, {
            changeId: change.id ?? '',
            fully: false,
        });
        if (success) {
            vscode.window.showInformationMessage('Change compacted (L2 -> L1)');
        }
    }

    /**
     * Fully compact a change to Level 0 via LSP.
     * If changeId is provided, finds the change by ID; otherwise uses cursor position.
     */
    public async compactChangeFully(changeId?: string): Promise<void> {
        const found = this.findChangeForCommand(changeId);
        if (!found) return;
        const { change } = found;

        const { success } = await this.sendLifecycleRequest(LSP_METHOD.COMPACT_CHANGE, {
            changeId: change.id ?? '',
            fully: true,
        });
        if (success) {
            vscode.window.showInformationMessage('Change fully compacted (L2/L1 -> L0)');
        }
    }

    /**
     * Compact all accepted/rejected resolved changes in the active document.
     * Shows a confirmation dialog before proceeding.
     */
    public async compactAllResolved(): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor) return;

        const uri = editor.document.uri.toString();

        // Initial parse to count candidates for the confirmation dialog
        const initialChanges = this.getChangesForUri(uri);
        const initialCount = initialChanges.filter(c => {
            const status = nodeStatus(c);
            const isTerminal = status === 'accepted' || status === 'rejected';
            const isResolved = c.metadata?.resolution?.type === 'resolved';
            return isTerminal && isResolved && c.id;
        }).length;

        if (initialCount === 0) {
            vscode.window.showInformationMessage('No resolved changes to compact');
            return;
        }

        const confirm = await vscode.window.showInformationMessage(
            `Compact ${initialCount} resolved change(s)?`,
            { modal: true },
            'Compact'
        );
        if (confirm !== 'Compact') return;

        // Re-parse between each compaction to avoid stale IDs after document mutation
        let compactedCount = 0;
        let lastCandidateId: string | undefined;
        while (true) {
            const currentEditor = findSupportedEditor();
            if (!currentEditor) break;

            const freshChanges = this.getChangesForUri(
                currentEditor.document.uri.toString()
            );

            // Pick the last resolved candidate (highest offset) for offset safety
            const candidate = freshChanges
                .filter(c => {
                    const status = nodeStatus(c);
                    const isTerminal = status === 'accepted' || status === 'rejected';
                    const isResolved = c.metadata?.resolution?.type === 'resolved';
                    return isTerminal && isResolved && c.id;
                })
                .sort((a, b) => b.range.start - a.range.start)[0];

            if (!candidate) break;
            // Guard against infinite loop if LSP succeeds but doesn't remove the change
            if (candidate.id === lastCandidateId) break;
            lastCandidateId = candidate.id;

            const { success } = await this.sendLifecycleRequest(LSP_METHOD.COMPACT_CHANGE, {
                changeId: candidate.id,
                fully: true,
            });
            if (!success) break;
            compactedCount++;
        }

        if (compactedCount > 0) {
            vscode.window.showInformationMessage(`Compacted ${compactedCount} resolved changes`);
        }
    }

    // ── Comment insertion ─────────────────────────────────────────────

    /**
     * Insert a comment at cursor or wrap selection in comment.
     * Respects changedown.commentInsertFormat (inline | footnote) and
     * changedown.commentInsertAuthor. Default: footnote with author.
     * @param predefinedText Optional text to use instead of prompting (for testing)
     */
    public async addComment(predefinedText?: string): Promise<void> {
        const editor = findSupportedEditor();
        if (!editor || editor.document.languageId !== 'markdown') {
            return;
        }

        const config = vscode.workspace.getConfiguration('changedown');
        const format = config.get<'inline' | 'footnote'>('commentInsertFormat', 'footnote');
        const includeAuthor = config.get<boolean>('commentInsertAuthor', true);

        const text = editor.document.getText();
        const selection = editor.selection;
        const selectedText = selection.isEmpty ? '' : editor.document.getText(selection);

        let commentText = predefinedText;

        if (commentText === undefined) {
            commentText = await vscode.window.showInputBox({
                placeHolder: 'Enter your comment...',
                prompt: selectedText ? `Add comment to "${selectedText}"` : 'Insert comment'
            });
        }

        if (commentText === undefined) {
            return; // Cancelled
        }

        const cursorOffset = positionToOffset(text, selection.active);

        if (format === 'footnote') {
            const author = includeAuthor ? (this.getAuthor() ?? 'unknown') : undefined;
            const date = new Date().toISOString().slice(0, 10);
            const maxId = scanMaxCnId(text);
            const newId = `cn-${maxId + 1}`;

            const inlineEdit = selection.isEmpty
                ? insertComment(commentText, cursorOffset)
                : insertComment(
                    commentText,
                    cursorOffset,
                    { start: positionToOffset(text, selection.start), end: positionToOffset(text, selection.end) },
                    selectedText
                );
            const inlinePart = inlineEdit.newText + `[^${newId}]`;
            const footnoteDef = generateFootnoteDefinition(newId, 'comment', author, date);
            const firstLine = author ? formatReply(author, commentText) : '\n    ' + commentText.replace(/\n/g, '\n    ');
            const footnoteBlock = footnoteDef + firstLine;

            const simulatedText = text.slice(0, inlineEdit.offset) + inlinePart + text.slice(inlineEdit.offset + inlineEdit.length);
            const finalText = appendFootnote(simulatedText, footnoteBlock);

            const startPos = editor.document.positionAt(0);
            const endPos = editor.document.positionAt(text.length);
            const result = await this.editorHost.applyEdits(editor.document.uri.toString(), [{
                range: {
                    start: { line: startPos.line, character: startPos.character },
                    end: { line: endPos.line, character: endPos.character },
                },
                newText: finalText,
            }]);
            if (!result.applied) {
                vscode.window.showWarningMessage('Comment insertion failed — please try again');
                return;
            }
        } else {
            const body = includeAuthor ? (() => {
                const author = this.getAuthor();
                return author ? `@${author}: ${commentText}` : commentText;
            })() : commentText;
            let edit: { offset: number; length: number; newText: string };
            if (selection.isEmpty) {
                edit = insertComment(body, cursorOffset);
            } else {
                const selectionRange = {
                    start: positionToOffset(text, selection.start),
                    end: positionToOffset(text, selection.end)
                };
                edit = insertComment(body, cursorOffset, selectionRange, selectedText);
            }
            const vscodeEdit = coreEditToVscode(text, edit);
            const editSuccess = await editor.edit(editBuilder => {
                editBuilder.replace(vscodeEdit.range, vscodeEdit.newText);
            });
            if (!editSuccess) {
                vscode.window.showWarningMessage('Comment insertion failed — please try again');
                return;
            }
        }
    }

    // ── Dispose ───────────────────────────────────────────────────────

    public dispose(): void {
        // No owned disposables — stateless command handler.
    }
}
