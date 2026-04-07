import { describe, it, expect } from 'vitest';
import { buildOverviewRulerPlan, VIEW_PRESETS } from '@changedown/core/host';
import { ChangeType } from '@changedown/core';

describe('buildOverviewRulerPlan', () => {
  const makeChange = (type: ChangeType, start: number, end: number, decided = false) => ({
    id: 'cn-1', type, level: 1,
    range: { start, end },
    contentRange: { start, end },
    decided,
  } as any);

  it('groups changes by type', () => {
    const changes = [
      makeChange(ChangeType.Insertion, 0, 10),
      makeChange(ChangeType.Deletion, 15, 25),
      makeChange(ChangeType.Substitution, 30, 40),
    ];
    const plan = buildOverviewRulerPlan(changes, VIEW_PRESETS.review);
    expect(plan.insertions).toHaveLength(1);
    expect(plan.deletions).toHaveLength(1);
    expect(plan.substitutions).toHaveLength(1);
  });

  it('returns empty for final (settled) view', () => {
    const changes = [makeChange(ChangeType.Insertion, 0, 10)];
    const plan = buildOverviewRulerPlan(changes, VIEW_PRESETS.final);
    expect(plan.insertions).toHaveLength(0);
  });

  it('returns empty for original (raw) view', () => {
    const changes = [makeChange(ChangeType.Insertion, 0, 10)];
    const plan = buildOverviewRulerPlan(changes, VIEW_PRESETS.original);
    expect(plan.insertions).toHaveLength(0);
  });

  it('skips decided changes', () => {
    const changes = [makeChange(ChangeType.Insertion, 0, 10, true)];
    const plan = buildOverviewRulerPlan(changes, VIEW_PRESETS.review);
    expect(plan.insertions).toHaveLength(0);
  });

  it('maps moveRole to effective type', () => {
    const changes = [{
      ...makeChange(ChangeType.Insertion, 0, 10),
      moveRole: 'from' as const,
    }];
    const plan = buildOverviewRulerPlan(changes as any, VIEW_PRESETS.review);
    expect(plan.deletions).toHaveLength(1);
    expect(plan.insertions).toHaveLength(0);
  });
});
