// packages/core/src/host/decorations/apply-plan.ts
import type { ChangeNode } from '../../model/types.js';
import type { DecorationPlan, OverviewRulerPlan, DecorationTarget } from './types.js';

export function applyPlan(
  target: DecorationTarget,
  plan: DecorationPlan,
  rulerPlan: OverviewRulerPlan,
  text: string,
  _changes: ChangeNode[],
): void {
  target.beginPass();

  // Fixed types in canonical order (must match SpyEditor)
  target.setDecorations('insertion', plan.insertions, text);
  target.setDecorations('deletion', plan.deletions, text);
  target.setDecorations('substitutionOriginal', plan.substitutionOriginals, text);
  target.setDecorations('substitutionModified', plan.substitutionModifieds, text);
  target.setDecorations('highlight', plan.highlights, text);
  target.setDecorations('comment', plan.comments, text);
  target.setDecorations('hidden', plan.hiddens, text);
  target.setDecorations('unfoldedDelimiter', plan.unfoldedDelimiters, text);
  target.setDecorations('commentIcon', plan.commentIcons, text);
  target.setDecorations('activeHighlight', plan.activeHighlights, text);
  target.setDecorations('moveFrom', plan.moveFroms, text);
  target.setDecorations('moveTo', plan.moveTos, text);
  target.setDecorations('settledRef', plan.settledRefs, text);
  target.setDecorations('settledDim', plan.settledDims, text);
  target.setDecorations('ghostDeletion', plan.ghostDeletions, text);
  target.setDecorations('consumed', plan.consumedRanges, text);
  target.setDecorations('consumingAnnotation', plan.consumingOpAnnotations, text);
  target.setDecorations('ghostDelimiter', plan.ghostDelimiters, text);
  target.setDecorations('ghostRef', plan.ghostRefs, text);

  // Dynamic per-author types
  for (const [key, entry] of plan.authorDecorations) {
    target.setDecorations(`author:${key}`, entry.ranges, text);
  }

  // Overview ruler marks (right lane)
  target.setOverviewRuler('insertion', rulerPlan.insertions, text);
  target.setOverviewRuler('deletion', rulerPlan.deletions, text);
  target.setOverviewRuler('substitution', rulerPlan.substitutions, text);
  target.setOverviewRuler('highlight', rulerPlan.highlights, text);
  target.setOverviewRuler('comment', rulerPlan.comments, text);

  target.endPass();
}
