/**
 * LSP Client
 *
 * Creates and manages the Language Server Protocol client for ChangeDown.
 * Spawns the LSP server as a child process and handles custom notifications.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    State,
    TransportKind
} from 'vscode-languageclient/node';
import type { CoherenceStatusParams, ChangeCountParams, AllChangesResolvedParams } from '@changedown/core';
import { LSP_METHOD } from '@changedown/core/host';

/**
 * Resolve reviewer identity from VS Code config.
 * Mirrors the reviewer identity resolution:
 * changedown.reviewerIdentity → changedown.author → undefined.
 */
function resolveReviewerIdentity(): string | undefined {
    const config = vscode.workspace.getConfiguration('changedown');
    const identity = (config.get<string>('reviewerIdentity', '') || config.get<string>('author', '')).trim();
    return identity || undefined;
}

/**
 * Send current reviewer identity to the LSP server.
 */
function sendReviewerIdentity(client: LanguageClient): void {
    client.sendNotification(LSP_METHOD.UPDATE_SETTINGS, {
        reviewerIdentity: resolveReviewerIdentity() ?? '',
    });
}


/**
 * Status bar manager for displaying change counts
 */
class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private changeCounts: Map<string, ChangeCountParams['counts']> = new Map();
    private coherenceData: Map<string, { rate: number; unresolvedCount: number; threshold: number }> = new Map();

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.text = '$(check) No changes';
        this.statusBarItem.show();
    }

    /**
     * Update status bar with change count for a document
     */
    updateChangeCount(uri: string, counts: ChangeCountParams['counts']): void {
        this.changeCounts.set(uri, counts);
        this.refresh();
    }

    /**
     * Get stored change counts for a document.
     */
    getChangeCount(uri: string): ChangeCountParams['counts'] | undefined {
        return this.changeCounts.get(uri);
    }

    /**
     * Clear change count for a document
     */
    clearChangeCount(uri: string): void {
        this.changeCounts.delete(uri);
        this.refresh();
    }

    /**
     * Update coherence data for a document
     */
    updateCoherence(uri: string, rate: number, unresolvedCount: number, threshold: number): void {
        this.coherenceData.set(uri, { rate, unresolvedCount, threshold });
        this.refresh();
    }

    /**
     * Get stored coherence data for a document
     */
    getCoherence(uri: string): { rate: number; unresolvedCount: number; threshold: number } | undefined {
        return this.coherenceData.get(uri);
    }

    /**
     * Clear coherence data for a document
     */
    clearCoherence(uri: string): void {
        this.coherenceData.delete(uri);
        this.refresh();
    }

    /**
     * Clear all data for a document (change counts + coherence). Call on document close.
     */
    clearDocument(uri: string): void {
        this.changeCounts.delete(uri);
        this.coherenceData.delete(uri);
        this.refresh();
    }

    /**
     * Refresh status bar display based on active editor
     */
    private refresh(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            this.statusBarItem.text = '$(check) No changes';
            this.statusBarItem.backgroundColor = undefined;
            return;
        }

        const uri = activeEditor.document.uri.toString();
        const counts = this.changeCounts.get(uri);
        const coherence = this.coherenceData.get(uri);

        if (coherence && coherence.unresolvedCount > 0) {
            const resolved = (counts?.total ?? 0) - coherence.unresolvedCount;
            this.statusBarItem.text = `$(warning) ${coherence.unresolvedCount} unresolved · ${resolved >= 0 ? resolved : 0} resolved`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            if (!counts || counts.total === 0) {
                this.statusBarItem.text = '$(check) No changes';
            } else {
                this.statusBarItem.text = `$(check) ${counts.total} change${counts.total === 1 ? '' : 's'}`;
            }
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    /**
     * Dispose of the status bar item
     */
    dispose(): void {
        this.statusBarItem.dispose();
    }
}

/**
 * Status bar manager instance
 */
let statusBarManager: StatusBarManager | undefined;

/**
 * Create and configure the Language Server Protocol client
 *
 * @param context Extension context
 * @returns Configured LanguageClient instance
 */
export function createLanguageClient(context: vscode.ExtensionContext): LanguageClient {
    // Resolve path to LSP server module (single bundled file so no node_modules needed at runtime)
    const serverModule = context.asAbsolutePath(path.join('out', 'server', 'server.js'));

    // Configure server options - spawn server as Node.js process
    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.stdio
        },
        debug: {
            module: serverModule,
            transport: TransportKind.stdio,
            options: {
                execArgv: ['--nolazy', '--inspect=6009']
            }
        }
    };

    // Configure client options
    const clientOptions: LanguageClientOptions = {
        // Target all file types (markdown + sidecar-annotated code files)
        documentSelector: [
            { scheme: 'file' }
        ],
        // Synchronize file change events for markdown and config files
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{md,toml}')
        }
    };

    // Create the language client
    const client = new LanguageClient(
        'changedown-lsp',
        'ChangeDown Language Server',
        serverOptions,
        clientOptions
    );

    // Initialize status bar manager
    statusBarManager = new StatusBarManager();
    context.subscriptions.push(statusBarManager);

    // Listen for active editor changes to update status bar
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            if (statusBarManager) {
                // Trigger refresh by getting current counts
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    const uri = activeEditor.document.uri.toString();
                    const counts = statusBarManager.getChangeCount(uri);
                    if (counts) {
                        statusBarManager.updateChangeCount(uri, counts);
                    }
                }
            }
        })
    );

    // Status bar wiring — these notifications only update the status bar
    // (BaseController owns decoration / document state / coherence routing)
    client.onNotification(
        LSP_METHOD.CHANGE_COUNT,
        (params: ChangeCountParams) => {
            if (statusBarManager) {
                statusBarManager.updateChangeCount(params.uri, params.counts);
            }
        }
    );

    client.onNotification(
        LSP_METHOD.ALL_CHANGES_RESOLVED,
        (params: AllChangesResolvedParams) => {
            if (statusBarManager) {
                statusBarManager.clearChangeCount(params.uri);
            }
        }
    );

    // Status bar also mirrors coherence (BaseController has its own handler via lspAdapter)
    client.onNotification(
        LSP_METHOD.COHERENCE_STATUS,
        (params: CoherenceStatusParams) => {
            if (statusBarManager) {
                statusBarManager.updateCoherence(params.uri, params.coherenceRate, params.unresolvedCount, params.threshold);
            }
        }
    );

    // Push reviewer identity to the LSP server once it transitions to Running,
    // and again on every configuration change that affects the reviewer identity settings.
    context.subscriptions.push(
        client.onDidChangeState(event => {
            if (event.newState === State.Running) {
                sendReviewerIdentity(client);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (
                event.affectsConfiguration('changedown.reviewerIdentity') ||
                event.affectsConfiguration('changedown.author')
            ) {
                // Only send if the client is already running
                if (client.isRunning()) {
                    sendReviewerIdentity(client);
                }
            }
        })
    );

    return client;
}

/**
 * Clear all StatusBarManager data for a document (change counts + coherence).
 * Call when a document closes to prevent memory leaks.
 */
export function clearStatusBarDocument(uri: string): void {
    statusBarManager?.clearDocument(uri);
}

/**
 * Get the current coherence data stored in StatusBarManager for a document.
 * Returns undefined if no coherence notification has been received yet.
 */
export function getStatusBarCoherence(uri: string): { rate: number; unresolvedCount: number; threshold: number } | undefined {
    return statusBarManager?.getCoherence(uri);
}

