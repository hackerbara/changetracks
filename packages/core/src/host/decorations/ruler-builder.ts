// packages/core/src/host/decorations/ruler-builder.ts
import { ChangeType } from '../../model/types.js';
import type { ChangeNode } from '../../model/types.js';
import type { View } from '../types.js';
import type { OverviewRulerPlan, OffsetRange } from './types.js';

export function buildOverviewRulerPlan(
  changes: ChangeNode[],
  view: View,
): OverviewRulerPlan {
  const plan: OverviewRulerPlan = {
    insertions: [], deletions: [], substitutions: [], highlights: [], comments: [],
  };

  if (view.projection !== 'current') return plan;

  for (const change of changes) {
    if (change.decided) continue;
    const effectiveType = change.moveRole === 'from' ? ChangeType.Deletion
      : change.moveRole === 'to' ? ChangeType.Insertion
      : change.type;
    const range: OffsetRange = { start: change.range.start, end: change.range.end };
    switch (effectiveType) {
      case ChangeType.Insertion:    plan.insertions.push(range); break;
      case ChangeType.Deletion:     plan.deletions.push(range); break;
      case ChangeType.Substitution: plan.substitutions.push(range); break;
      case ChangeType.Highlight:    plan.highlights.push(range); break;
      case ChangeType.Comment:      plan.comments.push(range); break;
    }
  }

  return plan;
}
