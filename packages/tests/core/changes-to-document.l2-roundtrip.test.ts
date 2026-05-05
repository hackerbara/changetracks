/**
 * L2 wire round-trip tests for changeNodesToL3Document.
 *
 * Pipeline: changeNodesToL3Document → serializeL3 → convertL3ToL2 → parseL2
 *
 * Verifies that the L2 wire shape consumers see (via parseL2) produces the
 * same metadata as the original ChangeNode[].
 *
 * Note: All fixtures use Proposed status to avoid the all-decided passthrough
 * in convertL3ToL2 (l3-to-l2.ts:109) where every-decided docs are returned
 * unchanged as L3 text even though format: 'L2' would be claimed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  changeNodesToL3Document,
  serializeL3,
  convertL3ToL2,
  parseL2,
  ChangeType,
  ChangeStatus,
  parseTimestamp,
} from '@changedown/core';
import { initHashline } from '@changedown/core/internals';
import type { ChangeNode, Approval, Resolution } from '@changedown/core';

beforeAll(async () => {
  await initHashline();
});

// ─── Fixture helpers ───────────────────────────────────────────────────────

function baseNode(overrides: Partial<ChangeNode> = {}): ChangeNode {
  return {
    id: 'cn-1',
    type: ChangeType.Insertion,
    // Always Proposed to avoid all-decided passthrough in convertL3ToL2.
    status: ChangeStatus.Proposed,
    range: { start: 0, end: 5 },
    contentRange: { start: 0, end: 5 },
    level: 2,
    anchored: false,
    resolved: true,
    metadata: {
      author: '@alice',
      date: '2026-04-27',
    },
    ...overrides,
  };
}

function approval(author: string, date: string, reason?: string): Approval {
  return { author, date, timestamp: parseTimestamp(date), reason };
}

const BODY = 'Hello world.';

// ─── Full pipeline helper ──────────────────────────────────────────────────

async function roundtrip(changes: readonly ChangeNode[]) {
  const doc = changeNodesToL3Document(BODY, changes);
  const l3text = serializeL3(doc);
  const l2text = await convertL3ToL2(l3text);
  const parsed = parseL2(l2text);
  return { doc, l3text, l2text, parsed };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('L2 round-trip: comment-only', () => {
  it('preserves reason in footnote after L3→L2 conversion', async () => {
    const changes = [
      baseNode({ metadata: { author: '@alice', date: '2026-04-27', comment: 'why' } }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes).toHaveLength(1);
    expect(parsed.footnotes[0].reason).toBe('why');
  });
});

describe('L2 round-trip: approvals', () => {
  it('preserves approvals after L3→L2', async () => {
    const changes = [
      baseNode({
        metadata: {
          author: '@alice',
          date: '2026-04-27',
          approvals: [approval('@bob', '2026-04-27', 'LGTM')],
        },
      }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes[0].approvals).toHaveLength(1);
    expect(parsed.footnotes[0].approvals[0].reason).toBe('LGTM');
  });
});

describe('L2 round-trip: rejections', () => {
  it('preserves rejections after L3→L2', async () => {
    const changes = [
      baseNode({
        metadata: {
          author: '@alice',
          date: '2026-04-27',
          rejections: [approval('@carol', '2026-04-28')],
        },
      }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes[0].rejections).toHaveLength(1);
    expect(parsed.footnotes[0].rejections[0].author).toBe('@carol');
  });
});

describe('L2 round-trip: requestChanges', () => {
  it('preserves requestChanges after L3→L2', async () => {
    const changes = [
      baseNode({
        metadata: {
          author: '@alice',
          date: '2026-04-27',
          requestChanges: [approval('@dave', '2026-04-28', 'explain')],
        },
      }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes[0].requestChanges).toHaveLength(1);
    expect(parsed.footnotes[0].requestChanges[0].reason).toBe('explain');
  });
});

describe('L2 round-trip: discussion', () => {
  it('preserves discussion entries after L3→L2', async () => {
    const changes = [
      baseNode({
        metadata: {
          author: '@alice',
          date: '2026-04-27',
          discussion: [
            { author: 'bob', date: '2026-04-27', timestamp: parseTimestamp('2026-04-27'), text: 'hello', depth: 0 },
          ],
        },
      }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes[0].discussion).toHaveLength(1);
    expect(parsed.footnotes[0].discussion[0].text).toBe('hello');
  });
});

describe('L2 round-trip: supersedes + supersededBy', () => {
  it('preserves supersedes after L3→L2', async () => {
    const changes = [
      baseNode({
        supersedes: 'cn-0',
        metadata: { author: '@alice', date: '2026-04-27' },
      }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes[0].supersedes).toBe('cn-0');
  });

  it('preserves supersededBy array after L3→L2', async () => {
    const changes = [
      baseNode({
        supersededBy: ['cn-2', 'cn-3'],
        metadata: { author: '@alice', date: '2026-04-27' },
      }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes[0].supersededBy).toEqual(['cn-2', 'cn-3']);
  });
});

describe('L2 round-trip: resolution', () => {
  it('preserves resolved type after L3→L2', async () => {
    const res: Resolution = {
      type: 'resolved',
      author: '@alice',
      date: '2026-04-27',
      timestamp: parseTimestamp('2026-04-27'),
      reason: 'done',
    };
    const changes = [
      baseNode({ metadata: { author: '@alice', date: '2026-04-27', resolution: res } }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes[0].resolution?.type).toBe('resolved');
  });

  it('preserves open type after L3→L2', async () => {
    const res: Resolution = { type: 'open', reason: 'ongoing' };
    const changes = [
      baseNode({ metadata: { author: '@alice', date: '2026-04-27', resolution: res } }),
    ];
    const { parsed } = await roundtrip(changes);
    expect(parsed.footnotes[0].resolution?.type).toBe('open');
    expect(parsed.footnotes[0].resolution?.reason).toBe('ongoing');
  });
});

describe('L2 round-trip: all-decided passthrough behavior', () => {
  it('Proposed-status nodes convert to L2 (have inline CriticMarkup or footnotes)', async () => {
    // With Proposed status and a line-hash anchor, convertL3ToL2 should inject
    // inline markup. Without a real body anchor the change will be in footnotes only.
    const changes = [
      baseNode({ metadata: { author: '@alice', date: '2026-04-27', comment: 'note' } }),
    ];
    const { l2text } = await roundtrip(changes);
    // L2 text must contain the footnote definition
    expect(l2text).toContain('[^cn-1]:');
  });
});

describe('L2 round-trip: edge case — no anchor', () => {
  it('no edit-op in L2 footnote when no anchor', async () => {
    const changes = [
      baseNode({ metadata: { author: '@alice', date: '2026-04-27' } }),
    ];
    const { l3text } = await roundtrip(changes);
    // L3 text must NOT contain LINE:HASH edit-op line
    expect(l3text).not.toMatch(/^ {4}\d+:[0-9a-f]+ /m);
  });
});
