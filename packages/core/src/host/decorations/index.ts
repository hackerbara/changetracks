// packages/core/src/host/decorations/index.ts
export type {
  DecorationTypeId, DecorationStyleDef, OffsetRange, OffsetDecoration,
  DecorationPlan, OverviewRulerPlan, DecorationTarget,
  AuthorDecorationRole, AuthorDecorationEntry,
} from './types.js';
export { DECORATION_STYLES, OVERVIEW_RULER_COLORS, AUTHOR_PALETTE,
  type VisibilityRule, type DecorationThemeOverride } from './styles.js';
export { AuthorColorMap } from './author-colors.js';
export {
  computeLineStarts, offsetToLine, isOffsetInRange,
  hideDelimiters, revealDelimiters, createEmptyPlan,
  getCharLevelRanges, hideOrGhostDelimiters, hasInlineDelimiters,
} from './helpers.js';
export { buildDecorationPlan } from './plan-builder.js';
export { buildOverviewRulerPlan } from './ruler-builder.js';
export { applyPlan } from './apply-plan.js';
