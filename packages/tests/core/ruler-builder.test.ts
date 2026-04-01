import { describe, it, expect } from 'vitest';
import { buildOverviewRulerPlan } from '@changedown/core/host';
import { ChangeType } from '@changedown/core';

describe('buildOverviewRulerPlan', () => {
  const makeChange = (type: ChangeType, start: number, end: number, settled = false) => ({
    id: 'cn-1', type, level: 1,
    range: { start, end },
    contentRange: { start, end },
    settled,
  } as any);

  it('groups changes by type', () => {
    const changes = [
      makeChange(ChangeType.Insertion, 0, 10),
      makeChange(ChangeType.Deletion, 15, 25),
      makeChange(ChangeType.Substitution, 30, 40),
    ];
    const plan = buildOverviewRulerPlan(changes, 'review');
    expect(plan.insertions).toHaveLength(1);
    expect(plan.deletions).toHaveLength(1);
    expect(plan.substitutions).toHaveLength(1);
  });

  it('returns empty for settled mode', () => {
    const changes = [makeChange(ChangeType.Insertion, 0, 10)];
    const plan = buildOverviewRulerPlan(changes, 'settled');
    expect(plan.insertions).toHaveLength(0);
  });

  it('returns empty for raw mode', () => {
    const changes = [makeChange(ChangeType.Insertion, 0, 10)];
    const plan = buildOverviewRulerPlan(changes, 'raw');
    expect(plan.insertions).toHaveLength(0);
  });

  it('skips settled changes', () => {
    const changes = [makeChange(ChangeType.Insertion, 0, 10, true)];
    const plan = buildOverviewRulerPlan(changes, 'review');
    expect(plan.insertions).toHaveLength(0);
  });

  it('maps moveRole to effective type', () => {
    const changes = [{
      ...makeChange(ChangeType.Insertion, 0, 10),
      moveRole: 'from' as const,
    }];
    const plan = buildOverviewRulerPlan(changes as any, 'review');
    expect(plan.deletions).toHaveLength(1);
    expect(plan.insertions).toHaveLength(0);
  });
});
