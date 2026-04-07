import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createLanguageClient, clearStatusBarDocument } from './lsp-client';
import { LanguageClient } from 'vscode-languageclient/node';
import { annotateFromGit } from './annotate-command';
import { MoveCodeLensProvider } from './move-code-lens';
import { ReviewPanelProvider } from './review-panel';
import { SettingsPanelProvider } from './settings-panel';
import { ProjectStatusModel } from './project-status';
import { registerHoverProvider } from './hover-provider';
import { ResolvedContentProvider, RESOLVED_SCHEME, toResolvedUri, GitOriginalContentProvider, GIT_ORIGINAL_SCHEME } from './resolved-content-provider';
import { ChangedownSCM } from './changedown-scm';
import { CurrentDocumentService } from './current-document-service';
import { ChangeComments } from './change-comments';
import { ChangeTimelineProvider } from './change-timeline';
import { SIDECAR_BLOCK_MARKER } from '@changedown/core';
import { changedownPlugin, headingIdPlugin } from '@changedown/preview';
import { VsCodePreviewAdapter } from './preview-adapter';
import markdownItKatex = require('@traptitech/markdown-it-katex');
import { setOutputChannel } from './output-channel';
import { registerChangeCommands, registerScmCommands, registerCommentCommands, registerTestCommands, registerSetupCommands, type ChangeCommandsContext } from './commands';
import { DocxEditorProvider } from './docx/docx-editor-provider';
import { ProjectedView } from './projected-view';
import { GitGutterManager, GUTTER_STRATEGY } from './git-gutter-manager';
import type { GutterStrategy } from './git-gutter-manager';
import { BaseController, LspFormatAdapter, LSP_METHOD } from '@changedown/core/host';
import { VsCodeLspAdapter, VsCodeEditorHost } from './adapters';
import { ProjectedViewAdapter } from './projected-view-adapter';
import { CommentThreadGuard } from './features/comment-thread-guard';
import { MoveTracker } from './features/move-tracker';
import { StatusBar } from './features/status-bar';
import { registerConfigWatchers } from './features/config-watchers';
import { registerSaveConversion } from './features/save-conversion';
import { autoFold } from './features/auto-fold';
import { registerFileRenameHandler } from './features/file-rename';
import { DecorationManager } from './managers/decoration-manager';
import { NavigationCommands } from './commands/navigation-commands';
import { ReviewCommands } from './commands/review-commands';
import { AnchorCommands } from './commands/anchor-commands';
import { isSupported } from './managers/shared';

let scmInstance: ChangedownSCM | null = null;
let changeComments: ChangeComments | { getChangeIdForThread: () => undefined };
let client: LanguageClient;
let baseController: BaseController;
let statusModel: ProjectStatusModel;
let gutterManager: GitGutterManager | null = null;
let disposables: vscode.Disposable[] = [];

// Output channel for error logging
export let outputChannel: vscode.OutputChannel;

// Per-instance temp file path for test bridge.
function testDocPath(): string {
    const id = process.env.CHANGEDOWN_TEST_INSTANCE_ID;
    const suffix = id ? `-${id}` : '';
    return path.join(os.tmpdir(), `changedown-test-doc${suffix}.json`);
}

export async function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('ChangeDown');
    setOutputChannel(outputChannel);
    context.subscriptions.push(outputChannel);

    const isDevMode = context.extensionMode === vscode.ExtensionMode.Development;

    outputChannel.appendLine(`[activate] ChangeDown activating (v${context.extension.packageJSON.version})`);
    outputChannel.appendLine(`[activate] activeTextEditor: ${vscode.window.activeTextEditor?.document.uri.fsPath ?? 'none'}`);

    // --- First-install / upgrade detection ---
    setTimeout(() => {
        try {
            const VERSION_KEY = 'changedown.version';
            const currentVersion: string = context.extension.packageJSON.version;
            const previousVersion = context.globalState.get<string>(VERSION_KEY);
            const walkthroughMode = vscode.workspace.getConfiguration('changedown').get<string>('showWalkthroughOnStartup') || 'firstInstall';
            const walkthroughId = `${context.extension.id}#changedown.getStarted`;

            if (walkthroughMode === 'always') {
                vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, false);
            } else if (walkthroughMode !== 'never') {
                if (previousVersion === undefined) {
                    vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, false);
                } else if (currentVersion !== previousVersion) {
                    void vscode.window.showInformationMessage(
                        `ChangeDown updated to v${currentVersion}.`,
                        'Open Walkthrough'
                    ).then(action => {
                        if (action === 'Open Walkthrough') {
                            vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, false);
                        }
                    });
                }
            }
            context.globalState.update(VERSION_KEY, currentVersion);
        } catch (e) {
            outputChannel.appendLine(`Walkthrough check failed: ${e}`);
        }
    }, 2000);

    // Initialize xxhash-wasm before creating anything that may parse L3 documents
    const { initHashline } = await import('@changedown/core');
    await initHashline();

    // Preview adapter
    const previewAdapter = new VsCodePreviewAdapter();
    context.subscriptions.push(previewAdapter);

    // Recover any orphaned swap files from a previous crash while in projected view
    ProjectedView.recoverCrashBackups();

    // --- BaseController composition ---
    const lspAdapter = new VsCodeLspAdapter();
    const commentGuard = new CommentThreadGuard();
    const editorHost = new VsCodeEditorHost(lspAdapter, commentGuard);
    const projectedViewAdapter = new ProjectedViewAdapter(lspAdapter, editorHost);

    // Config — decoration style, author colors, localParseHotPath
    const config0 = vscode.workspace.getConfiguration('changedown');
    const rawStyle = config0.get<string>('decorationStyle', 'foreground');
    const decorationStyle = rawStyle === 'background' ? 'background' : 'foreground';
    const rawAuthorColors = config0.get<string>('authorColors', 'auto');
    const authorColors = (rawAuthorColors === 'always' || rawAuthorColors === 'never') ? rawAuthorColors : 'auto';
    const localParseHotPath = config0.get<boolean>('localParseHotPath', false);

    const decorationManager = new DecorationManager(decorationStyle, authorColors, localParseHotPath);
    decorationManager.subscribeVisibilityCleanup(context.subscriptions);

    // Initial show delimiters + author colors applied as display overrides after setView
    const initialShowDelimiters = config0.get<boolean>('showDelimiters', false);

    baseController = new BaseController({
        host: editorHost,
        lsp: lspAdapter,
        decorationPort: decorationManager,
        formatAdapter: new LspFormatAdapter(lspAdapter),
        defaultFormat: 'L3',
        defaultDisplay: { delimiters: initialShowDelimiters ? 'show' : 'hide', authorColors },
        hooks: {
            onDidOpenDocument: (uri, _state) => {
                const text = editorHost.getDocumentText(uri);
                const headerMatch = text.match(/^<!--\s*changedown\.com\/v1:\s*(tracked|untracked)\s*-->/m);
                if (headerMatch) {
                    baseController.trackingService.setTrackingEnabled(uri, headerMatch[1] === 'tracked');
                }
            },
            onDidCrystallize: (uri) => {
                outputChannel.appendLine(`[BaseController] crystallize: ${uri}`);
            },
            onDecorationData: (data) => {
                // Auto-fold hints from LSP decoration data
                if (data.autoFoldLines?.length) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.document.uri.toString() === data.uri) {
                        autoFold(data.autoFoldLines);
                    }
                }
                // Dev-mode signal file for test harness
                if (isDevMode) {
                    try {
                        const signalPath = path.join(os.tmpdir(), 'changedown-test-decoration-ready.json');
                        fs.writeFileSync(signalPath, JSON.stringify({
                            uri: data.uri, changeCount: data.changes.length, timestamp: Date.now(),
                        }));
                    } catch { /* non-critical */ }
                }
            },
        },
    });
    context.subscriptions.push(commentGuard, editorHost, lspAdapter, projectedViewAdapter, baseController, decorationManager);

    // Navigation commands — depends on baseController
    const navigationCommands = new NavigationCommands(
        baseController,
        (editor) => decorationManager.getHiddenOffsetsForEditor(editor),
    );
    context.subscriptions.push(navigationCommands);

    // Review commands — depends on baseController + lspAdapter + editorHost
    const reviewCommands = new ReviewCommands(
        baseController,
        lspAdapter,
        editorHost,
    );
    context.subscriptions.push(reviewCommands);

    // Anchor commands — depends on baseController
    const anchorCommands = new AnchorCommands(baseController);
    context.subscriptions.push(anchorCommands);

    // Decoration after-update hook: refresh cursor context + status bar
    decorationManager.setAfterUpdate((editor) => {
        navigationCommands.updateChangeAtCursorContext(editor);
    });

    // Wire config change listeners (decoration style, delimiters, hot path)
    registerConfigWatchers(context, baseController, decorationManager, outputChannel);

    // Wire cursor context on text editor selection change
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(event => {
            const editor = event.textEditor;
            if (isSupported(editor.document)) {
                navigationCommands.updateChangeAtCursorContext(editor);
                navigationCommands.snapCursorPastHiddenRanges(editor, event);
            }
        }),
    );

    // Auto-fold + dev-mode signal are wired via BaseController's onDecorationData hook
    // (set in the hooks config above). Do NOT register additional lspAdapter.onDecorationData()
    // handlers — vscode-languageclient uses Map<method, handler>, so each onNotification
    // for the same method REPLACES the previous handler, breaking BaseController's handler.

    // Wire coherence status from LSP
    context.subscriptions.push(
        lspAdapter.onCoherenceUpdate((data) => {
            baseController.coherenceService.update(data.uri, data.rate, data.unresolvedCount, data.threshold);
        })
    );

    // Status bar — reacts to changes + coherence + active editor
    const statusBar = new StatusBar(baseController);
    context.subscriptions.push(statusBar);

    // Inline coherence UI — show degradation notification when anchor resolution falls below threshold
    context.subscriptions.push(
        baseController.coherenceService.onDidChangeCoherence(({ uri, rate, unresolvedCount, threshold }) => {
            if (unresolvedCount > 0 && rate < threshold) {
                vscode.window.showInformationMessage(
                    `ChangeDown: ${unresolvedCount} anchor${unresolvedCount === 1 ? '' : 's'} could not be resolved. External or manual edits are the most common cause.`,
                    'Inspect', 'Dismiss',
                ).then(choice => {
                    if (choice === 'Inspect') vscode.commands.executeCommand('changedown.inspectUnresolved');
                });
            }
        })
    );

    // Wire document-close cleanup for status bar
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            clearStatusBarDocument(doc.uri.toString());
        })
    );

    // L3→L2 pre-save conversion
    registerSaveConversion(context, baseController, lspAdapter);

    // Start LSP client
    client = createLanguageClient(context);
    client.start().then(() => {
        lspAdapter.setClient(client);
        // Resync any documents whose queued notifications were dropped on overflow.
        // Full-document didOpen restores the server's coordinate space from current
        // text, replacing the stale sequence of didChange offsets that was discarded.
        const resyncUris = lspAdapter.getPendingResyncUris();
        if (resyncUris.length > 0) {
            outputChannel.appendLine(`[activate] resyncing ${resyncUris.length} document(s) after queue overflow`);
            const openDocs = new Map<string, vscode.TextDocument>();
            for (const doc of vscode.workspace.textDocuments) {
                openDocs.set(doc.uri.toString(), doc);
            }
            for (const uri of resyncUris) {
                const doc = openDocs.get(uri);
                if (doc) {
                    lspAdapter.sendDidOpen(uri, doc.getText(), doc.languageId);
                } else {
                    outputChannel.appendLine(`[activate] resync skipped — no open document for ${uri}`);
                }
            }
        }
        const initialMode = vscode.workspace.getConfiguration('changedown').get<string>('codeLensMode', 'cursor');
        client.sendNotification(LSP_METHOD.SET_CODELENS_MODE, { mode: initialMode });
        outputChannel.appendLine('[activate] LSP client connected');
    }).catch(err => {
        outputChannel.appendLine(`[activate] LSP start failed: ${err?.message ?? err}`);
        lspAdapter.clearQueue();
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('changedown.codeLensMode')) {
                const mode = vscode.workspace.getConfiguration('changedown').get<string>('codeLensMode', 'cursor');
                if (client?.isRunning?.()) {
                    client.sendNotification(LSP_METHOD.SET_CODELENS_MODE, { mode });
                }
            }
        })
    );

    // Hover provider
    registerHoverProvider(context, {
        getChangesForDocument: (doc) => baseController.getAuthoredChanges(doc.uri.toString()),
    });

    // Project Status Model
    statusModel = new ProjectStatusModel();
    context.subscriptions.push(statusModel);

    // Config file watching
    const configPattern = new vscode.RelativePattern(
        vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('.'),
        '.changedown/config.toml'
    );
    const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);

    const loadConfigFromDisk = async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;
        const configPath = vscode.Uri.joinPath(folders[0].uri, '.changedown', 'config.toml');
        try {
            const content = await vscode.workspace.fs.readFile(configPath);
            statusModel.updateFromToml(new TextDecoder().decode(content));
        } catch { /* No config file — use defaults */ }
    };

    context.subscriptions.push(
        configWatcher,
        configWatcher.onDidChange(loadConfigFromDisk),
        configWatcher.onDidCreate(loadConfigFromDisk),
        configWatcher.onDidDelete(() => statusModel.updateFromToml(''))
    );

    loadConfigFromDisk();

    const currentDocumentService = new CurrentDocumentService();

    // Review Panel
    const reviewPanelProvider = new ReviewPanelProvider({
        getChanges: () => {
            const doc = currentDocumentService.getCurrentDocument();
            return doc ? baseController.getAuthoredChanges(doc.uri.toString()) : [];
        },
        getDocumentText: () => currentDocumentService.getCurrentDocument()?.getText() ?? '',
        get trackingMode() {
            const uri = vscode.window.activeTextEditor?.document.uri.toString();
            return uri ? baseController.trackingService.isTrackingEnabled(uri) : false;
        },
        get viewMode() { return baseController.viewMode; },
        onDidChangeChanges: (listener) => baseController.stateManager.onDidChangeChanges(uris => listener(uris.map(u => vscode.Uri.parse(u)))),
    });
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('changedownReview', reviewPanelProvider),
        reviewPanelProvider
    );

    context.subscriptions.push(
        navigationCommands.onDidChangeCursorChange((changeId: string | null) => {
            reviewPanelProvider.setActiveChangeId(changeId);
        })
    );

    // Settings Panel
    const settingsPanelProvider = new SettingsPanelProvider(statusModel);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('changedownSettings', settingsPanelProvider),
        settingsPanelProvider
    );
    context.subscriptions.push(
        settingsPanelProvider.onDidRequestSave(async (toml: string) => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders) {
                settingsPanelProvider.postMessageToWebview({ type: 'saveResult', success: false });
                return;
            }
            const dirUri = vscode.Uri.joinPath(folders[0].uri, '.changedown');
            const fileUri = vscode.Uri.joinPath(dirUri, 'config.toml');
            try {
                try { await vscode.workspace.fs.createDirectory(dirUri); } catch { /* exists */ }
                await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(toml));
                settingsPanelProvider.postMessageToWebview({ type: 'saveResult', success: true });
                vscode.window.showInformationMessage('ChangeDown settings saved.');
            } catch (err: any) {
                settingsPanelProvider.postMessageToWebview({ type: 'saveResult', success: false });
                vscode.window.showErrorMessage(`Failed to save settings: ${err.message}`);
            }
        })
    );

    // Resolved content provider
    const resolvedProvider = new ResolvedContentProvider();
    const gitOriginalProvider = new GitOriginalContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(RESOLVED_SCHEME, resolvedProvider),
        vscode.workspace.registerTextDocumentContentProvider(GIT_ORIGINAL_SCHEME, gitOriginalProvider),
        resolvedProvider
    );

    context.subscriptions.push(
        baseController.stateManager.onDidChangeChanges((uris) => {
            for (const uri of uris) {
                resolvedProvider.notifyChange(toResolvedUri(vscode.Uri.parse(uri)));
            }
        })
    );

    // Git gutter management
    const gutterStrategy = vscode.workspace.getConfiguration('changedown').get<GutterStrategy>('gutterStrategy', GUTTER_STRATEGY.AUTO);
    const gm = new GitGutterManager(outputChannel);
    gm.setWarningShown(context.workspaceState.get<boolean>('changedown.gutterWarningShown', false));

    // SCM provider
    let scm: ChangedownSCM | null = null;
    try {
        scm = new ChangedownSCM(context, () => ({
            onDidChangeChanges: (l) => baseController.stateManager.onDidChangeChanges(uris => l(uris.map(u => vscode.Uri.parse(u)))),
            getChangesForDocument: (doc) => baseController.getAuthoredChanges(doc.uri.toString()),
        }), gm, gutterStrategy);
        scmInstance = scm;
        context.subscriptions.push(scm);
    } catch (err: any) {
        outputChannel.appendLine(`[activate] SCM provider failed to initialize: ${err.message}\n${err.stack}`);
    }

    const proposedApiActive = scm?.isUsingProposedQuickDiff?.() ?? false;
    if (gutterStrategy !== GUTTER_STRATEGY.OFF && !(gutterStrategy === GUTTER_STRATEGY.AUTO && proposedApiActive)) {
        gm.start();
        gutterManager = gm;
        context.subscriptions.push(gm);
        const suppressEnabled = vscode.workspace.getConfiguration('changedown').get<boolean>('suppressGitGutter', true);
        if (suppressEnabled) {
            suppressGitQuickDiff(outputChannel, context);
        } else {
            registerGitGutterToggle(outputChannel, context);
        }
    } else {
        gm.setEnabled(false);
    }

    context.subscriptions.push({
        dispose: () => {
            context.workspaceState.update('changedown.gutterWarningShown', gm.wasWarningShown());
        }
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('changedown.gutterStrategy')) {
                const strategy = vscode.workspace.getConfiguration('changedown').get<GutterStrategy>('gutterStrategy', GUTTER_STRATEGY.AUTO);
                const shouldEnable = strategy !== GUTTER_STRATEGY.OFF && strategy !== GUTTER_STRATEGY.PROPOSED_API;
                gutterManager?.setEnabled(shouldEnable);
            }
        })
    );
    watchSuppressGitGutterSetting(outputChannel, context);

    registerScmCommands(context, reviewCommands, () => scmInstance);

    // Comment API
    try {
        changeComments = new ChangeComments(
            {
                onDidChangeChanges: (l) => baseController.stateManager.onDidChangeChanges(() => l()),
                getChangesForDocument: (doc) => baseController.getAuthoredChanges(doc.uri.toString()),
            },
            () => vscode.window.activeTextEditor?.document,
            () => baseController.viewMode,
        );
        // Wire thread expansion events to the comment guard so edits typed
        // inside comment widgets are not tracked on the source document.
        context.subscriptions.push(
            changeComments.onDidChangeAnyThreadExpansion(isExpanded => {
                commentGuard.setActive(isExpanded);
            }),
        );
        context.subscriptions.push(changeComments);
    } catch (err: any) {
        outputChannel.appendLine(`[activate] ChangeComments failed to initialize: ${err.message}\n${err.stack}`);
        changeComments = { getChangeIdForThread: () => undefined, expandThreadForChangeId: () => undefined } as any;
    }

    // Timeline provider
    const timelineProvider = new ChangeTimelineProvider({
        onDidChangeChanges: (l) => baseController.stateManager.onDidChangeChanges(() => l()),
        getChangesForDocument: (doc) => baseController.getAuthoredChanges(doc.uri.toString()),
    });
    try {
        if (typeof vscode.workspace.registerTimelineProvider === 'function') {
            context.subscriptions.push(
                vscode.workspace.registerTimelineProvider('file', timelineProvider),
                timelineProvider
            );
        }
    } catch { /* Timeline API not available */ }

    // MoveTracker — client-side cut-as-move / paste-as-move
    const moveTracker = new MoveTracker((uri, text) => lspAdapter.sendMoveMetadata(uri, text));
    context.subscriptions.push(moveTracker);

    // Register commands
    registerChangeCommands(context, baseController, lspAdapter, projectedViewAdapter, decorationManager, navigationCommands, reviewCommands, changeComments as ChangeCommandsContext, moveTracker);
    registerCommentCommands(context, baseController, reviewCommands, changeComments);
    if (isDevMode) {
        registerTestCommands(context, baseController, () => client, changeComments as any);
    }
    registerSetupCommands(context);

    if (isDevMode) {
        context.subscriptions.push(
            vscode.window.onDidChangeTextEditorSelection((e) => {
                if (e.textEditor.document.languageId === 'markdown') {
                    const statePath = path.join(os.tmpdir(), 'changedown-test-cursor.json');
                    fs.writeFileSync(statePath, JSON.stringify({
                        line: e.selections[0].active.line + 1, timestamp: Date.now(),
                    }));
                }
            }),
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.languageId === 'markdown' && e.document.uri.scheme === 'file') {
                    fs.writeFileSync(testDocPath(), JSON.stringify({
                        text: e.document.getText(), uri: e.document.uri.toString(), timestamp: Date.now(),
                    }));
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(async (editor) => {
                if (editor?.document.languageId === 'markdown') {
                    fs.writeFileSync(testDocPath(), JSON.stringify({
                        text: editor.document.getText(), uri: editor.document.uri.toString(), timestamp: Date.now(),
                    }));
                }
            }),
        );
    }

    // CodeLens provider for move operations
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'markdown' },
            new MoveCodeLensProvider((doc) => baseController.getAuthoredChanges(doc.uri.toString()))
        ),

        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (!editor) return;
            const config = vscode.workspace.getConfiguration('changedown');
            if (!config.get<boolean>('annotateOnOpen', false)) return;
            if (editor.document.uri.scheme !== 'file') return;
            const text = editor.document.getText();
            if (text.includes(SIDECAR_BLOCK_MARKER) || text.includes('{++') || text.includes('{--')) return;
            await annotateFromGit(editor);
        }),
    );

    // Handle file renames — migrate BaseController state and decoration/gutter state
    registerFileRenameHandler(context, baseController, (oldUriStr, newUriStr) => {
        const oldUri = vscode.Uri.parse(oldUriStr);
        decorationManager.handleFileRename(oldUriStr, newUriStr);
        if (changeComments instanceof ChangeComments) {
            changeComments.disposeThreadsForUri(oldUri);
        }
        if (gutterManager && oldUri.path.endsWith('.md')) {
            gutterManager.handleFileRenamed(oldUriStr, newUriStr);
        }
    });

    // DOCX custom editor
    context.subscriptions.push(DocxEditorProvider.register(context));

    // Export to DOCX command
    context.subscriptions.push(
        vscode.commands.registerCommand('changedown.exportToDocx', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                vscode.window.showWarningMessage('Open a markdown file to export to DOCX.');
                return;
            }
            const mdPath = editor.document.uri.fsPath;
            const defaultDocxPath = mdPath.replace(/-changedown\.md$/i, '.docx').replace(/\.md$/i, '.docx');
            const defaultUri = vscode.Uri.file(defaultDocxPath);
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri,
                filters: { 'Word Document': ['docx'] },
                title: 'Export to DOCX',
            });
            if (!saveUri) return;
            try {
                const markdown = editor.document.getText();
                const { exportDocx } = await import('@changedown/docx');
                const mdDir = path.dirname(mdPath);
                const docxBasename = path.basename(mdPath)
                    .replace(/-changedown\.md$/i, '')
                    .replace(/\.md$/i, '');
                const mediaDir = path.join(mdDir, `${docxBasename}_media`);
                const hasMedia = fs.existsSync(mediaDir);
                const { buffer, stats } = await exportDocx(markdown, {
                    mediaDir: hasMedia ? mediaDir : undefined,
                    fileReader: hasMedia ? (p: string) => { try { return new Uint8Array(fs.readFileSync(p)); } catch { return null; } } : undefined,
                });
                await vscode.workspace.fs.writeFile(saveUri, new Uint8Array(buffer));
                vscode.window.showInformationMessage(
                    `Exported ${stats.insertions} ins, ${stats.deletions} del, ${stats.substitutions} sub to ${path.basename(saveUri.fsPath)}`
                );
            } catch (err: any) {
                vscode.window.showErrorMessage(`DOCX export failed: ${err.message}`);
            }
        })
    );

    // Test-only: write initial active editor content
    if (isDevMode) {
        const initialEditor = vscode.window.activeTextEditor;
        if (initialEditor?.document.languageId === 'markdown') {
            fs.writeFileSync(testDocPath(), JSON.stringify({
                text: initialEditor.document.getText(),
                uri: initialEditor.document.uri.toString(),
                timestamp: Date.now(),
            }));
        }
    }

    // Initialize context keys
    vscode.commands.executeCommand('setContext', 'changedown:viewMode', baseController.getView()?.name ?? 'review');
    vscode.commands.executeCommand('setContext', 'changedown:trackingEnabled', false);

    // Update trackingEnabled context key when tracking state changes for active URI
    context.subscriptions.push(
        baseController.trackingService.onDidChangeTrackingState(({ uri, enabled }) => {
            const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
            if (uri === activeUri) {
                vscode.commands.executeCommand('setContext', 'changedown:trackingEnabled', enabled);
            }
        })
    );

    // Refresh trackingEnabled on active editor change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            const uri = editor?.document.uri.toString();
            const enabled = uri ? baseController.trackingService.isTrackingEnabled(uri) : false;
            vscode.commands.executeCommand('setContext', 'changedown:trackingEnabled', enabled);
        })
    );

    // Markdown preview
    return {
        extendMarkdownIt(md: any) {
            md.use(markdownItKatex, { throwOnError: false });
            md.use(changedownPlugin, () => previewAdapter.getPluginConfig());
            md.use(headingIdPlugin);
            return md;
        }
    };
}

// ── Git QuickDiff suppression ───────────────────────────────────────────────

const SCM_DIFF_SETTING = 'scm.diffDecorations';
const ORIGINAL_SETTING_KEY = 'changedown.originalDiffDecorations';

function suppressGitQuickDiff(output: vscode.OutputChannel, context: vscode.ExtensionContext): void {
    const config = vscode.workspace.getConfiguration();
    const current = config.get<string>(SCM_DIFF_SETTING, 'all');
    if (context.workspaceState.get<string>(ORIGINAL_SETTING_KEY) === undefined) {
        context.workspaceState.update(ORIGINAL_SETTING_KEY, current);
    }
    if (current !== 'none') {
        config.update(SCM_DIFF_SETTING, 'none', vscode.ConfigurationTarget.Workspace);
        output.appendLine(`[gutter] suppressed git QuickDiff (scm.diffDecorations: "${current}" → "none")`);
    }
    registerGitGutterToggle(output, context);
}

function registerGitGutterToggle(output: vscode.OutputChannel, context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('changedown.toggleGitGutter', () => {
            const cfg = vscode.workspace.getConfiguration();
            const val = cfg.get<string>(SCM_DIFF_SETTING, 'all');
            if (val === 'none') {
                const original = context.workspaceState.get<string>(ORIGINAL_SETTING_KEY, 'all');
                cfg.update(SCM_DIFF_SETTING, original, vscode.ConfigurationTarget.Workspace);
                output.appendLine(`[gutter] restored git QuickDiff (scm.diffDecorations: "${original}")`);
                vscode.window.showInformationMessage(`Git gutter restored (scm.diffDecorations: "${original}").`);
            } else {
                context.workspaceState.update(ORIGINAL_SETTING_KEY, val);
                cfg.update(SCM_DIFF_SETTING, 'none', vscode.ConfigurationTarget.Workspace);
                output.appendLine('[gutter] suppressed git QuickDiff');
                vscode.window.showInformationMessage('Git gutter suppressed. ChangeDown decorations still active.');
            }
        })
    );
}

function watchSuppressGitGutterSetting(output: vscode.OutputChannel, context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('changedown.suppressGitGutter')) return;
            const enabled = vscode.workspace.getConfiguration('changedown').get<boolean>('suppressGitGutter', true);
            const cfg = vscode.workspace.getConfiguration();
            if (enabled) {
                const current = cfg.get<string>(SCM_DIFF_SETTING, 'all');
                if (current !== 'none') {
                    context.workspaceState.update(ORIGINAL_SETTING_KEY, current);
                    cfg.update(SCM_DIFF_SETTING, 'none', vscode.ConfigurationTarget.Workspace);
                    output.appendLine('[gutter] suppressGitGutter enabled — suppressed git QuickDiff');
                }
            } else {
                const original = context.workspaceState.get<string>(ORIGINAL_SETTING_KEY, 'all');
                cfg.update(SCM_DIFF_SETTING, original, vscode.ConfigurationTarget.Workspace);
                output.appendLine(`[gutter] suppressGitGutter disabled — restored git QuickDiff ("${original}")`);
            }
        })
    );
}

export async function deactivate() {
    if (gutterManager) {
        gutterManager.setEnabled(false);
        await gutterManager.clearAllFlags();
        gutterManager = null;
    }
    if (client) {
        await client.stop();
        client = null!;
    }
    scmInstance = null;
}
