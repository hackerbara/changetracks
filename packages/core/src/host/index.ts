// packages/core/src/host/index.ts
export {
  EventEmitter,
  type Event, type Disposable, type ContentChange, type ViewMode,
  type DocumentState, type DocumentSnapshot, type StatusInfo,
  type EditorHost, type DecorationPort, type PreviewPort,
  type LspConnection, type TypedLspConnection, type ReviewResult,
  type ChangeNode, type RangeEdit, type OffsetEdit, type ApplyEditResult,
  type PendingOverlay, type SupersedeResult,
} from './types.js';
export { offsetToRange, rangeToOffset, rangeToOffsetBatch } from './edit-convert.js';
export { DocumentStateManager } from './document-state-manager.js';
export { DecorationScheduler } from './decoration-scheduler.js';
export { TrackingService, type TrackingServiceConfig } from './services/tracking-service.js';
export { NavigationService } from './services/navigation-service.js';
export { ReviewService, type ReviewOperationResult } from './services/review-service.js';
export { CoherenceService, type CoherenceState } from './services/coherence-service.js';
export {
  type DecorationTypeId, type DecorationStyleDef,
  type OffsetRange, type OffsetDecoration,
  type DecorationPlan, type OverviewRulerPlan, type DecorationTarget,
  type AuthorDecorationRole, type AuthorDecorationEntry,
  DECORATION_STYLES, OVERVIEW_RULER_COLORS, AUTHOR_PALETTE,
  VIEW_MODE_VISIBILITY, type VisibilityRule, type DecorationThemeOverride,
  isTypeVisibleInMode,
  AuthorColorMap,
  computeLineStarts, offsetToLine, isOffsetInRange,
  hideDelimiters, revealDelimiters, createEmptyPlan, getCharLevelRanges,
  buildDecorationPlan, buildOverviewRulerPlan, applyPlan,
} from './decorations/index.js';
export { transformRange, type OffsetContentChange } from './range-transform.js';
export { type DocumentUri, normalizeUri, UriMap, UriSet } from './uri.js';
export { BaseController, type ControllerConfig, type ControllerHooks } from './base-controller.js';
export { UriKeyedStore } from './uri-keyed-store.js';
export { LSP_METHOD, type LspMethod } from './lsp-methods.js';
export { FormatService } from './format-service.js';
export type { FormatTransitionResult } from './format-service.js';
export type { FormatAdapter } from './types.js';
export { ProjectionService } from './projection-service.js';
export type { Projection, ProjectionSource, DisplayOptions, ProjectionSelector, ProjectionResult, ProjectionRequest } from './types.js';
export { VIEW_MODE_PRESETS, projectionToViewMode, NULL_LSP_CONNECTION } from './types.js';
export type { View, BuiltinView } from './types.js';
export { VIEW_PRESETS } from './types.js';
// L3 SDK adapters
export { LspFormatAdapter } from './adapters/lsp-format-adapter.js';
export { LocalParseAdapter } from './adapters/local-parse-adapter.js';
export { LocalFormatAdapter } from './adapters/local-format-adapter.js';
// L3 SDK types (remaining)
export type { OperationResult, StructuredEdit, ParseAdapter, SettlementConfig } from './types.js';

export { PendingEditManager } from './pending-edit-manager.js';
export type { CrystallizedEdit, OnCrystallizeCallback, OnOverlayChangeCallback } from './pending-edit-manager.js';

