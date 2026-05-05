import { describe, it, expect } from 'vitest';
import { isGhostNode, ChangeNode, ChangeType, ChangeStatus } from '@changedown/core';

function makeNode(overrides: Partial<ChangeNode>): ChangeNode {
  return {
    id: 'cn-1', type: ChangeType.Insertion, status: ChangeStatus.Proposed,
    range: { start: 0, end: 0 }, contentRange: { start: 0, end: 0 },
    anchored: false, level: 2, originalText: '', modifiedText: '',
    resolved: true,
    ...overrides,
  } as ChangeNode;
}

describe('isGhostNode', () => {
  it('returns true for unresolved L2+ node (resolved:false, no consumedBy)', () => {
    expect(isGhostNode(makeNode({ resolved: false }))).toBe(true);
  });

  it('returns false for consumed L2+ node (resolved:false, has consumedBy)', () => {
    expect(isGhostNode(makeNode({ resolved: false, consumedBy: 'cn-5' }))).toBe(false);
  });

  it('returns false for resolved L2+ node', () => {
    expect(isGhostNode(makeNode({ resolved: true }))).toBe(false);
  });

  it('returns false for L0/L1 nodes (always resolved:true per invariant)', () => {
    expect(isGhostNode(makeNode({ resolved: true, level: 0 }))).toBe(false);
    expect(isGhostNode(makeNode({ resolved: true, level: 1 }))).toBe(false);
  });
});
