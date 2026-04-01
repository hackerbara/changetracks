// packages/core/src/host/index.ts
export {
  EventEmitter,
  type Event, type Disposable, type ContentChange, type ViewMode,
  type DocumentState, type DocumentSnapshot, type StatusInfo,
  type EditorHost, type RenderPort,
  type LspConnection, type ReviewResult,
} from './types.js';
export { DocumentStateManager } from './document-state-manager.js';
export { DecorationScheduler } from './decoration-scheduler.js';
export { TrackingService } from './services/tracking-service.js';
export { NavigationService } from './services/navigation-service.js';
export { ReviewService } from './services/review-service.js';
export {
  type DecorationTypeId, type DecorationStyleDef,
  type OffsetRange, type OffsetDecoration,
  type DecorationPlan, type OverviewRulerPlan, type DecorationTarget,
  type AuthorDecorationRole, type AuthorDecorationEntry,
  DECORATION_STYLES, OVERVIEW_RULER_COLORS, AUTHOR_PALETTE,
  AuthorColorMap,
  computeLineStarts, offsetToLine, isOffsetInRange,
  hideDelimiters, revealDelimiters, createEmptyPlan, getCharLevelRanges,
  buildDecorationPlan, buildOverviewRulerPlan, applyPlan,
} from './decorations/index.js';
export { transformRange, type OffsetContentChange } from './range-transform.js';
