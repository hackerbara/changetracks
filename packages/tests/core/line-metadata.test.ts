import { describe, it, expect } from 'vitest';
import { buildLineMetadataFromFootnotes, ChangeType } from '@changedown/core/internals';
import type { ChangeNode } from '@changedown/core/internals';

function mkNode(overrides: Partial<ChangeNode> = {}): ChangeNode {
  return {
    id: 'cn-1',
    type: ChangeType.Insertion,
    range: { start: 0, end: 0 },
    text: '',
    metadata: {
      author: 'alice',
      status: 'proposed',
      comment: 'make it bigger',
      discussion: [],
    },
    inlineMetadata: undefined,
    replyCount: 0,
    ...overrides,
  } as ChangeNode;
}

describe('buildLineMetadataFromFootnotes', () => {
  it('populates type, status, reason for a bare insertion', () => {
    const map = new Map([['cn-1', mkNode()]]);
    const result = buildLineMetadataFromFootnotes(new Set(['cn-1']), map);
    expect(result[0]).toMatchObject({
      changeId: 'cn-1',
      type: 'ins',
      status: 'proposed',
      author: 'alice',
      reason: 'make it bigger',
    });
    expect(result[0].latestThreadTurn).toBeUndefined();
  });

  it('sets latestThreadTurn to the last discussion entry when 2+ turns exist', () => {
    const node = mkNode({
      metadata: {
        author: 'alice',
        status: 'proposed',
        discussion: [
          { author: 'alice', date: '2026-02-17', timestamp: '2026-02-17T00:00:00Z', depth: 0, text: 'reason text' },
          { author: 'dave', date: '2026-02-18', timestamp: '2026-02-18T00:00:00Z', depth: 0, text: 'pushback response' },
        ],
      },
    });
    const map = new Map([['cn-1', node]]);
    const result = buildLineMetadataFromFootnotes(new Set(['cn-1']), map);
    expect(result[0].latestThreadTurn).toEqual({
      author: 'dave',
      text: 'pushback response',
    });
  });

  it('omits latestThreadTurn when only the reason turn exists', () => {
    const node = mkNode({
      metadata: {
        author: 'alice',
        status: 'proposed',
        discussion: [
          { author: 'alice', date: '2026-02-17', timestamp: '2026-02-17T00:00:00Z', depth: 0, text: 'just one turn' },
        ],
      },
    });
    const map = new Map([['cn-1', node]]);
    const result = buildLineMetadataFromFootnotes(new Set(['cn-1']), map);
    expect(result[0].latestThreadTurn).toBeUndefined();
  });

  it('maps change types to short codes', () => {
    const ins = mkNode({ id: 'cn-1', type: ChangeType.Insertion });
    const del = mkNode({ id: 'cn-2', type: ChangeType.Deletion });
    const sub = mkNode({ id: 'cn-3', type: ChangeType.Substitution });
    const hl  = mkNode({ id: 'cn-4', type: ChangeType.Highlight });
    const com = mkNode({ id: 'cn-5', type: ChangeType.Comment });
    const map = new Map([
      ['cn-1', ins], ['cn-2', del], ['cn-3', sub], ['cn-4', hl], ['cn-5', com],
    ]);
    const result = buildLineMetadataFromFootnotes(
      new Set(['cn-1', 'cn-2', 'cn-3', 'cn-4', 'cn-5']),
      map,
    );
    const byId = new Map(result.map(m => [m.changeId, m]));
    expect(byId.get('cn-1')!.type).toBe('ins');
    expect(byId.get('cn-2')!.type).toBe('del');
    expect(byId.get('cn-3')!.type).toBe('sub');
    expect(byId.get('cn-4')!.type).toBe('hl');
    expect(byId.get('cn-5')!.type).toBe('com');
  });

  it('returns empty array when refIds is undefined', () => {
    const result = buildLineMetadataFromFootnotes(undefined, new Map());
    expect(result).toEqual([]);
  });

  it('skips refIds not present in the footnote map', () => {
    const map = new Map([['cn-1', mkNode()]]);
    const result = buildLineMetadataFromFootnotes(
      new Set(['cn-1', 'cn-999']),
      map,
    );
    expect(result.length).toBe(1);
    expect(result[0].changeId).toBe('cn-1');
  });

  it('populates replyCount when > 0', () => {
    const node = mkNode({ replyCount: 3 });
    const map = new Map([['cn-1', node]]);
    const result = buildLineMetadataFromFootnotes(new Set(['cn-1']), map);
    expect(result[0].replyCount).toBe(3);
  });
});
