import type {
  EditorHost, TypedLspConnection, DecorationPort, PreviewPort,
  Disposable, DocumentState, DocumentSnapshot, ViewMode,
  ContentChange, RangeEdit, ReviewResult, ChangeNode, Event,
  FormatAdapter, ParseAdapter, DisplayOptions, Projection,
  SettlementConfig, ApplyEditResult, View, BuiltinView,
} from './types.js';
import { EventEmitter, VIEW_MODE_PRESETS, VIEW_PRESETS } from './types.js';
import { DocumentStateManager } from './document-state-manager.js';
import { DecorationScheduler } from './decoration-scheduler.js';
import { TrackingService, type TrackingServiceConfig } from './services/tracking-service.js';
import { ReviewService, type ReviewOperationResult } from './services/review-service.js';
import { NavigationService } from './services/navigation-service.js';
import { CoherenceService, type CoherenceState } from './services/coherence-service.js';
import { rangeToOffsetBatch, offsetToRange } from './edit-convert.js';
import { type CrystallizedEdit } from './pending-edit-manager.js';
import { type DocumentUri, UriMap, normalizeUri } from './uri.js';
import { FormatService } from './format-service.js';
import { ProjectionService } from './projection-service.js';

export interface ControllerConfig {
  readonly host: EditorHost;
  readonly decorationPort: DecorationPort;
  readonly previewPort?: PreviewPort;
  readonly lsp?: TypedLspConnection;
  readonly formatAdapter: FormatAdapter;
  readonly parseAdapter?: ParseAdapter;
  readonly defaultFormat?: 'L2' | 'L3';
  readonly defaultDisplay?: DisplayOptions;
  /** Initial view configuration. Defaults to VIEW_PRESETS.review. */
  readonly defaultView?: View;
  readonly hooks?: ControllerHooks;
  readonly settlement?: SettlementConfig;
  readonly tracking?: TrackingServiceConfig;
}

export interface ControllerHooks {
  onWillOpenDocument?: (uri: string) => void;
  onDidOpenDocument?: (uri: string, state: DocumentState) => void;
  onDidCrystallize?: (uri: string) => void;
  onDidReviewComplete?: (result: ReviewResult) => void;
  onDidChangeTrackingState?: (uri: string, enabled: boolean) => void;
  onDecorationData?: (data: { uri: string; changes: ChangeNode[]; documentVersion: number; autoFoldLines?: number[] }) => void;
  onRevealChange?: (offset: number) => void;
  onDispose?: () => void;
}

// Ports are owned by the host, not by BaseController. The host is responsible
// for disposing decorationPort and previewPort when they are no longer needed.
export class BaseController implements Disposable {
  readonly stateManager = new DocumentStateManager();
  readonly trackingService: TrackingService;
  readonly reviewService: ReviewService;
  readonly navigationService: NavigationService;
  readonly coherenceService: CoherenceService;
  readonly scheduler: DecorationScheduler;
  readonly formatService: FormatService;
  readonly projectionService: ProjectionService;

  private activeUri: DocumentUri | undefined = undefined;
  private _defaultView: View;
  private _viewOverrides = new UriMap<View>();
  private lastCursorOffset = new UriMap<number>();
  private disposables: Disposable[] = [];

  private readonly _onDidChangeViewMode = new EventEmitter<ViewMode>();
  readonly onDidChangeViewMode: Event<ViewMode> = this._onDidChangeViewMode.event;

  private readonly _onDidChangeView = new EventEmitter<View>();
  readonly onDidChangeView: Event<View> = this._onDidChangeView.event;

  private readonly host: EditorHost;
  private readonly lsp?: TypedLspConnection;
  private readonly decorationPort: DecorationPort;
  private readonly previewPort?: PreviewPort;
  private readonly defaultFormat: 'L2' | 'L3';
  private readonly hooks?: ControllerHooks;
  private readonly parseAdapter?: ParseAdapter;

  /** @deprecated Use getView() instead. Derives ViewMode from current view for backward compat. */
  get viewMode(): ViewMode {
    const view = this.getView(this.activeUri);
    switch (view.projection) {
      case 'decided': return 'settled';
      case 'original': return 'raw';
      case 'none': return 'raw';
      default: return view.display.delimiters === 'show' ? 'review' : 'changes';
    }
  }

  get defaultView(): View { return this._defaultView; }

  get showDelimiters(): boolean {
    const view = this.getView(this.activeUri);
    return view.display.delimiters === 'show';
  }

  get projection(): Projection {
    const view = this.getView(this.activeUri);
    return view.projection;
  }

  /** Get the active view for a URI, falling back to the default. */
  getView(uri?: DocumentUri): View {
    if (uri && this._viewOverrides.has(uri)) {
      return this._viewOverrides.get(uri)!;
    }
    return this._defaultView;
  }

  /** Set the active view. Pass a BuiltinView name or a custom View object. */
  setView(preset: BuiltinView | View, uri?: DocumentUri): void {
    const view = typeof preset === 'string' ? VIEW_PRESETS[preset] : preset;
    if (uri) {
      this._viewOverrides.set(uri, view);
    } else {
      this._defaultView = view;
    }
    if (this.activeUri) {
      // Translate View name → ViewMode for LSP protocol compatibility
      const lspMode = view.projection === 'decided' ? 'settled'
        : view.projection === 'original' ? 'raw'
        : view.display.delimiters === 'show' ? 'review' : 'changes';
      this.lsp?.sendViewMode(this.activeUri, lspMode as ViewMode);
    }
    this.pushSnapshotForActive();
    this._onDidChangeView.fire(view);
  }

  constructor(config: ControllerConfig) {
    this.host = config.host;
    this.lsp = config.lsp;
    this.decorationPort = config.decorationPort;
    this.previewPort = config.previewPort;
    this.defaultFormat = config.defaultFormat ?? 'L2';
    this.hooks = config.hooks;
    this.parseAdapter = config.parseAdapter;
    let defaultView = config.defaultView ?? VIEW_PRESETS.review;
    if (config.defaultDisplay) {
      defaultView = { ...defaultView, display: { ...defaultView.display, ...config.defaultDisplay } };
    }
    this._defaultView = defaultView;

    this.trackingService = new TrackingService(config.tracking);
    this.reviewService = new ReviewService(
      config.settlement ? { settlement: config.settlement } : undefined,
    );
    this.navigationService = new NavigationService(this.stateManager);
    this.coherenceService = new CoherenceService();
    this.scheduler = new DecorationScheduler((uri) => this.pushSnapshot(uri));
    this.formatService = new FormatService(config.formatAdapter);
    this.projectionService = new ProjectionService();

    // Subscribe to local TrackingService crystallization events
    this.disposables.push(
      this.trackingService.onDidCrystallize(async (edit) => {
        this.trackingService.expectEcho(edit.uri);
        const rangeEdits = this.convertCrystallizedEdits(edit);
        await this.applyMutationEdits(edit.uri, rangeEdits);
        this.hooks?.onDidCrystallize?.(edit.uri);
      }),
      this.trackingService.onDidChangeOverlay(({ uri, overlay }) => {
        if (overlay) {
          this.host.showOverlay?.(uri, overlay);
        } else {
          this.host.clearOverlay?.(uri);
        }
      }),
    );

    // Wire EditorHost events
    this.disposables.push(
      this.host.onDidOpenDocument((e) => this.handleOpenDocument(e.uri, e.text)),
      this.host.onDidCloseDocument((e) => this.handleCloseDocument(e.uri)),
      this.host.onDidSaveDocument((e) => {
        this.trackingService.handleSave(e.uri);
        this.lsp?.sendFlushPending(e.uri);
      }),
      this.host.onDidChangeContent((e) => this.handleContentChange(e)),
      this.host.onDidChangeActiveDocument((e) => {
        if (e && e.uri !== this.activeUri) this.handleOpenDocument(e.uri, e.text);
      }),
      this.host.onDidChangeCursorPosition((e) => {
        const prev = this.lastCursorOffset.get(e.uri as DocumentUri);
        if (prev !== e.offset) {
          this.lastCursorOffset.set(e.uri as DocumentUri, e.offset);
          this.lsp?.sendCursorMove(e.uri, e.offset);
          this.trackingService.handleCursorMove(e.uri, e.offset,
            this.stateManager.getState(e.uri)?.text ?? '');
        }
        this.navigationService.updateCursorContext(e.uri, e.offset);
        if (this.showDelimiters) this.scheduler.schedule(e.uri);
      }),
    );

    // Wire LSP notifications (only when lsp is provided)
    if (this.lsp) {
      this.disposables.push(
        this.lsp.onDecorationData((data) => {
          this.stateManager.setCachedDecorations(data.uri, data.changes, data.documentVersion);
          this.scheduler.schedule(data.uri);
          this.hooks?.onDecorationData?.(data);
        }),
        this.lsp.onPendingEditFlushed((data) => this.handlePendingEditFlushed(data)),
        this.lsp.onDocumentState((data) => {
          this.trackingService.setTrackingEnabled(data.uri, data.tracking.enabled);
          this.hooks?.onDidChangeTrackingState?.(data.uri, data.tracking.enabled);
        }),
      );

      // Wire overlay if host supports it
      if (this.host.showOverlay) {
        this.disposables.push(
          this.lsp.onOverlayUpdate((data) => {
            if (data.overlay) {
              this.host.showOverlay?.(data.uri, data.overlay);
            } else {
              this.host.clearOverlay?.(data.uri);
            }
          }),
        );
      }
    }
  }

  // --- Public API ---

  openDocument(uri: string, text?: string): void {
    this.handleOpenDocument(uri, text);
  }

  closeDocument(uri: string): void {
    this.handleCloseDocument(uri);
  }

  getState(uri: string): DocumentState | undefined {
    return this.stateManager.getState(uri);
  }

  getActiveUri(): DocumentUri | undefined {
    return this.activeUri;
  }

  /** @deprecated Use setView() instead. */
  setProjection(projection: Projection): void {
    this._defaultView = { ...this._defaultView, projection };
    this.pushSnapshotForActive();
  }

  setDisplay(partial: Partial<DisplayOptions>, uri?: DocumentUri): void {
    const current = this.getView(uri);
    const merged: View = { ...current, display: { ...current.display, ...partial } };
    if (uri) {
      this._viewOverrides.set(uri, merged);
    } else {
      this._defaultView = merged;
    }
    // Update LSP viewMode when display changes affect the derived mode
    if (this.activeUri) {
      const lspMode = merged.projection === 'decided' ? 'settled'
        : merged.projection === 'original' || merged.projection === 'none' ? 'raw'
        : merged.display.delimiters === 'show' ? 'review' : 'changes';
      this.lsp?.sendViewMode(this.activeUri, lspMode as ViewMode);
    }
    this.pushSnapshotForActive();
  }

  setFormatPreference(uri: string, format: 'L2' | 'L3'): Promise<void> {
    this.formatService.setPreferredFormat(uri, format);
    const state = this.stateManager.getState(normalizeUri(uri));
    if (state && state.format !== format) {
      return this.convertFormat(uri, state.text, format);
    }
    return Promise.resolve();
  }

  /** @deprecated Use setView() instead. */
  setViewMode(mode: ViewMode): void {
    const preset = VIEW_MODE_PRESETS[mode];
    this.setView({
      name: mode,
      projection: preset.projection,
      display: { ...this._defaultView.display, ...preset.display },
    });
    this._onDidChangeViewMode.fire(mode);
  }

  /** @deprecated Use setDisplay({ delimiters }) instead. */
  setShowDelimiters(show: boolean): void {
    this.setDisplay({ delimiters: show ? 'show' : 'hide' });
  }

  invalidateRendering(uri: string): void {
    this.scheduler.updateNow(uri);
  }

  revealChange(offset: number): void {
    this.hooks?.onRevealChange?.(offset);
  }

  /**
   * Curated helper: get all changes for a URI.
   * Shortcut for `controller.stateManager.getChangesForUri(uri)`.
   */
  getChangesForUri(uri: string): ChangeNode[] {
    return this.stateManager.getChangesForUri(uri);
  }

  /**
   * Curated helper: get authoring-visible changes (filters out L0 / empty-id ghost nodes).
   */
  getAuthoredChanges(uri: string): ChangeNode[] {
    return this.stateManager.getChangesForUri(uri).filter(c => c.id !== '' && c.level > 0);
  }

  /**
   * Curated helper: is tracking enabled for this URI?
   * Shortcut for `controller.trackingService.isTrackingEnabled(uri)`.
   */
  isTrackingEnabled(uri: string): boolean {
    return this.trackingService.isTrackingEnabled(uri);
  }

  /**
   * Curated helper: get coherence state for this URI.
   * Shortcut for `controller.coherenceService.getCoherence(uri)`.
   */
  getCoherence(uri: string): CoherenceState | undefined {
    return this.coherenceService.getCoherence(uri);
  }

  // --- Review convenience methods ---

  async acceptChange(uri: string, changeId: string, author: string): Promise<ReviewOperationResult> {
    return this.executeReviewOp(uri, (text) => this.reviewService.acceptChange(text, changeId, author));
  }

  async rejectChange(uri: string, changeId: string, author: string): Promise<ReviewOperationResult> {
    return this.executeReviewOp(uri, (text) => this.reviewService.rejectChange(text, changeId, author));
  }

  async acceptAll(uri: string, changeIds?: string[], author?: string): Promise<ReviewOperationResult> {
    return this.executeReviewOp(uri, (text) => this.reviewService.acceptAll(text, changeIds, author));
  }

  async rejectAll(uri: string, changeIds?: string[], author?: string): Promise<ReviewOperationResult> {
    return this.executeReviewOp(uri, (text) => this.reviewService.rejectAll(text, changeIds, author));
  }

  private async executeReviewOp(
    uri: string,
    op: (text: string) => ReviewOperationResult,
  ): Promise<ReviewOperationResult> {
    const text = this.stateManager.getState(uri)?.text;
    if (text === undefined) return { updatedText: '', affectedChangeIds: [], error: 'Document not open' };
    const result = op(text);
    if (result.affectedChangeIds.length > 0) await this.applyMutationResult(uri, text, result.updatedText);
    return result;
  }

  dispose(): void {
    this.hooks?.onDispose?.();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.lastCursorOffset.clear();
    this._viewOverrides.clear();
    this.scheduler.dispose();
    this.trackingService.dispose();
    this.reviewService.dispose();
    this.navigationService.dispose();
    this.coherenceService.dispose();
    this.formatService.dispose();
    this.projectionService.dispose();
    this.stateManager.dispose();
    this._onDidChangeViewMode.dispose();
    this._onDidChangeView.dispose();
  }

  // --- Private handlers ---

  /** Parse locally and cache results. No-op when parseAdapter is absent. */
  private localParseAndCache(uri: string, text: string, version: number, format?: 'L2' | 'L3'): void {
    if (!this.parseAdapter) return;
    const fmt = format ?? this.stateManager.getState(uri)?.format ?? 'L2';
    const changes = this.parseAdapter.parse(uri, text, fmt);
    this.stateManager.setCachedDecorations(uri, changes, version);
  }

  private handleOpenDocument(uri: string, text?: string): void {
    const docText = text ?? this.host.getDocumentText(uri);
    this.hooks?.onWillOpenDocument?.(uri);
    const isNew = !this.stateManager.getState(uri);
    const state = this.stateManager.ensureState(uri, docText, 1);

    // Detect format
    state.format = this.formatService.getDetectedFormat(uri, docText);

    this.localParseAndCache(uri, docText, state.version, state.format);

    // Check if format preference differs → convert
    const preferred = this.defaultFormat ?? this.formatService.getPreferredFormat(uri);
    if (preferred && state.format !== preferred) {
      // Defer async conversion — don't block openDocument
      void this.convertFormat(uri, docText, preferred);
    }

    this.activeUri = uri as DocumentUri;
    if (isNew) this.lsp?.sendDidOpen(uri, docText);
    // In hybrid mode, tell server we're handling tracking locally.
    // This disables the server's PEM for this document, preventing double-crystallization.
    // handlePendingEditFlushed remains wired as a fallback for server-generated edits.
    if (isNew) this.lsp?.sendSetDocumentState(uri, { tracking: { enabled: false } });
    this.pushSnapshot(uri);
    this.hooks?.onDidOpenDocument?.(uri, state);
  }

  private handleCloseDocument(uri: string): void {
    this.trackingService.closeDocument(uri);
    this.lsp?.sendDidClose(uri);
    this.stateManager.removeState(uri);
    this.formatService.remove(uri);
    this.projectionService.invalidate(uri);
    this.decorationPort.clear(uri);
    this.previewPort?.clear(uri);
    this.lastCursorOffset.delete(uri as DocumentUri);
    this._viewOverrides.delete(uri as DocumentUri);
    if (this.activeUri === uri) this.activeUri = undefined;
  }

  private handleContentChange(event: {
    uri: string; text: string; version: number;
    changes: ContentChange[]; isEcho: boolean;
  }): void {
    if (event.isEcho) return;
    // Use pre-computed offsets when the host provides them (VS Code does natively).
    // Fall back to range→offset scan for hosts that don't (website, tests).
    let offsetChanges;
    if (event.changes.every(c => c.rangeOffset !== undefined)) {
      offsetChanges = event.changes.map(c => ({
        rangeOffset: c.rangeOffset!,
        rangeLength: c.rangeLength,
        text: c.text,
      }));
    } else {
      // Use pre-edit text for range→offset conversion: event.changes carries pre-edit
      // coordinates but event.text is post-edit. stateManager.text is still pre-edit
      // because applyContentChange hasn't been called yet.
      const preEditText = this.stateManager.getState(event.uri)?.text ?? event.text;
      offsetChanges = rangeToOffsetBatch(preEditText, event.changes.map(c => ({ range: c.range, newText: c.text })))
        .map(e => ({ rangeOffset: e.offset, rangeLength: e.length, text: e.newText }));
    }
    // Capture pre-edit text BEFORE applyContentChange updates state
    const preEditTextForTracking = this.stateManager.getState(event.uri)?.text ?? '';
    this.stateManager.applyContentChange(event.uri, event.text, event.version, offsetChanges);
    // Route to TrackingService for PEM processing (user edits only)
    if (offsetChanges.length === 1) {
      const c = offsetChanges[0];
      const type = c.text.length > 0 && c.rangeLength === 0 ? 'insertion'
        : c.text.length === 0 && c.rangeLength > 0 ? 'deletion'
        : 'substitution';
      const deletedText = c.rangeLength > 0
        ? preEditTextForTracking.slice(c.rangeOffset, c.rangeOffset + c.rangeLength)
        : '';
      this.trackingService.handleContentChange(
        event.uri, type, c.rangeOffset, c.text,
        deletedText,
        event.text,
      );
    } else if (offsetChanges.length > 1) {
      // Multi-change events (e.g., Enter + auto-indent) trigger a flush.
      this.trackingService.flush(event.uri);
    }

    // Format re-detect on large external changes (>50% of document replaced)
    const totalChangeLength = offsetChanges.reduce((sum, c) => sum + c.rangeLength, 0);
    if (totalChangeLength > event.text.length * 0.5) {
      const state = this.stateManager.getState(event.uri);
      if (state) {
        state.format = this.formatService.getDetectedFormat(event.uri, event.text);
      }
    }

    this.localParseAndCache(event.uri, event.text, event.version);

    this.lsp?.sendDidChange(event.uri, event.changes);
    this.scheduler.schedule(event.uri);
  }

  /**
   * Shared post-mutation handler. All mutation paths (review, crystallize, format convert)
   * call this after producing edits. Generalizes the existing handlePendingEditFlushed pattern.
   *
   * Flow: host.applyEdits → update state → re-parse locally → send to LSP → schedule render.
   * The echo from host.applyEdits is correctly suppressed by handleContentChange's isEcho guard
   * because this method updates state BEFORE the echo arrives.
   */
  private async applyMutationEdits(uri: string, edits: RangeEdit[]): Promise<ApplyEditResult | null> {
    if (!this.host.applyEdits) return null;
    const result = await this.host.applyEdits(uri, edits);
    if (!result.applied) return result;

    // Update state from verified result
    const state = this.stateManager.getState(uri);
    if (!state) return result;
    state.text = result.text;
    state.version = result.version;

    this.stateManager.invalidateCache(uri);
    this.localParseAndCache(uri, result.text, result.version, state.format);

    // Send verified text to LSP for standard features (hybrid mode)
    this.lsp?.sendDidChangeFullDoc(uri, result.text);

    this.scheduler.updateNow(uri);
    return result;
  }

  private async applyMutationResult(uri: string, oldText: string, newText: string): Promise<void> {
    if (oldText === newText) return;
    const edit = offsetToRange(oldText, { offset: 0, length: oldText.length, newText });
    await this.applyMutationEdits(uri, [edit]);
  }

  private convertCrystallizedEdits(edit: CrystallizedEdit): RangeEdit[] {
    const state = this.stateManager.getState(edit.uri);
    if (!state) return [];
    const text = state.text;
    const { markupEdit, footnoteEdit } = edit.edits;
    const result: RangeEdit[] = [];
    if (markupEdit) {
      result.push(offsetToRange(text, markupEdit));
    }
    if (footnoteEdit) {
      // After markup edit, text has shifted — use post-markup text for footnote range
      const textAfterMarkup = markupEdit
        ? text.slice(0, markupEdit.offset) + markupEdit.newText + text.slice(markupEdit.offset + markupEdit.length)
        : text;
      result.push(offsetToRange(textAfterMarkup, footnoteEdit));
    }
    return result;
  }

  private async handlePendingEditFlushed(data: { uri: string; edits: RangeEdit[] }): Promise<void> {
    const result = await this.applyMutationEdits(data.uri, data.edits);
    if (result?.applied) {
      this.hooks?.onDidCrystallize?.(data.uri);
    }
  }

  private pushSnapshotForActive(): void {
    if (this.activeUri) this.pushSnapshot(this.activeUri);
  }

  private pushSnapshot(uri: string): void {
    const state = this.stateManager.getState(uri);
    if (!state) return;

    const view = this.getView(uri as DocumentUri);

    const snapshot: DocumentSnapshot = {
      uri,
      sourceVersion: state.version,
      text: state.text,
      changes: state.cachedChanges,
      format: state.format,
      view,
      cursorOffset: this.lastCursorOffset.get(uri as DocumentUri),
    };

    this.decorationPort.update(snapshot);
    this.previewPort?.update(snapshot);
  }

  private async convertFormat(uri: string, text: string, targetFormat: 'L2' | 'L3'): Promise<void> {
    const result = targetFormat === 'L3'
      ? await this.formatService.promoteToL3(uri, text)
      : await this.formatService.demoteToL2(uri, text);
    // Apply the converted text via host
    // For now, just update the state — full implementation in a future task
    const state = this.stateManager.getState(normalizeUri(uri));
    if (state) {
      state.text = result.convertedText;
      state.format = targetFormat;
    }
    this.pushSnapshotForActive();
  }
}
