/**
 * Round-trip tests for changeNodesToL3Document.
 *
 * For each fixture: changeNodesToL3Document → serializeL3 → parseL3 → assert
 * that parsed footnotes match the original document footnotes (modulo sourceRange).
 *
 * Edge cases covered:
 *  - no anchor / anchor.kind ≠ line-hash → no edit-op line
 *  - empty body
 *  - empty changes
 *  - author normalization (@-prefix dedup)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  changeNodesToL3Document,
  serializeL3,
  parseL3,
  ChangeType,
  ChangeStatus,
  parseTimestamp,
} from '@changedown/core';
import { initHashline } from '@changedown/core/internals';
import type { ChangeNode, Approval, Revision, DiscussionComment, Resolution } from '@changedown/core';

beforeAll(async () => {
  await initHashline();
});

// ─── Fixture helpers ───────────────────────────────────────────────────────

function baseNode(overrides: Partial<ChangeNode> = {}): ChangeNode {
  return {
    id: 'cn-1',
    type: ChangeType.Insertion,
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

function revision(label: string, author: string, date: string, text: string): Revision {
  return { label, author, date, timestamp: parseTimestamp(date), text };
}

function discussion(author: string, date: string, text: string, label?: string, depth = 0): DiscussionComment {
  return { author, date, timestamp: parseTimestamp(date), text, label, depth };
}

const BODY = 'Hello world.';

// ─── Utility: compare footnotes ignoring sourceRange ──────────────────────

function comparableFootnote(f: ReturnType<typeof parseL3>['footnotes'][0]) {
  // Return a snapshot of fields we care about for round-trip correctness,
  // excluding sourceRange (which differs between parsed and constructed footnotes).
  const { sourceRange: _sr, ...rest } = f as typeof f & { sourceRange: unknown };
  void _sr;
  // Also strip blank bodyLines that serializeL3 does not emit (trailing blanks
  // may appear only if the serializer adds them — it doesn't, so there should
  // be none, but guard anyway).
  return {
    ...rest,
    bodyLines: (rest as typeof rest & { bodyLines: Array<{ kind: string; raw: string }> }).bodyLines
      .filter((bl: { kind: string }) => bl.kind !== 'blank'),
  };
}

// ─── Test: comment-only (no other metadata) ────────────────────────────────

describe('changeNodesToL3Document — comment-only', () => {
  const changes: readonly ChangeNode[] = [
    baseNode({
      metadata: { author: '@alice', date: '2026-04-27', comment: 'simple note' },
    }),
  ];

  it('round-trips through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes).toHaveLength(1);
    const fn = parsed.footnotes[0];
    expect(fn.id).toBe('cn-1');
    expect(fn.reason).toBe('simple note');
    expect(fn.header.status).toBe('proposed');
    expect(fn.header.type).toBe('ins');
  });

  it('emits reason: body line with correct raw', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const bl = doc.footnotes[0].bodyLines.find(l => l.kind === 'reason');
    expect(bl).toBeDefined();
    expect(bl!.raw).toBe('    reason: simple note');
  });
});

// ─── Test: with discussion ─────────────────────────────────────────────────

describe('changeNodesToL3Document — with discussion', () => {
  const changes: readonly ChangeNode[] = [
    baseNode({
      metadata: {
        author: '@alice',
        date: '2026-04-27',
        discussion: [
          discussion('bob', '2026-04-27', 'looks good'),
          discussion('@carol', '2026-04-28', 'agreed', 'r1'),
        ],
      },
    }),
  ];

  it('round-trips discussion through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes[0].discussion).toHaveLength(2);
    expect(parsed.footnotes[0].discussion[0].text).toBe('looks good');
    expect(parsed.footnotes[0].discussion[1].label).toBe('r1');
  });

  it('emits discussion lines with 4-space indent + @prefix', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const discLines = doc.footnotes[0].bodyLines.filter(l => l.kind === 'discussion');
    expect(discLines).toHaveLength(2);
    expect(discLines[0].raw).toBe('    @bob 2026-04-27: looks good');
    expect(discLines[1].raw).toBe('    @carol 2026-04-28 [r1]: agreed');
  });
});

// ─── Test: with revisions ──────────────────────────────────────────────────

describe('changeNodesToL3Document — with revisions', () => {
  const changes: readonly ChangeNode[] = [
    baseNode({
      metadata: {
        author: '@alice',
        date: '2026-04-27',
        revisions: [
          revision('r1', '@alice', '2026-04-27', 'first pass'),
          revision('r2', 'bob', '2026-04-28', 'second pass'),
        ],
      },
    }),
  ];

  it('round-trips revisions through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes[0].revisions).toHaveLength(2);
    expect(parsed.footnotes[0].revisions[0].label).toBe('r1');
    expect(parsed.footnotes[0].revisions[0].text).toBe('first pass');
    expect(parsed.footnotes[0].revisions[1].author).toBe('@bob');
  });

  it('emits revisions-header then revision lines', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const bls = doc.footnotes[0].bodyLines;
    const hdrIdx = bls.findIndex(l => l.kind === 'revisions-header');
    expect(hdrIdx).toBeGreaterThanOrEqual(0);
    expect(bls[hdrIdx].raw).toBe('    revisions:');
    const revLines = bls.filter(l => l.kind === 'revision');
    expect(revLines).toHaveLength(2);
    expect(revLines[0].raw).toBe('    r1 @alice 2026-04-27: "first pass"');
    expect(revLines[1].raw).toBe('    r2 @bob 2026-04-28: "second pass"');
  });
});

// ─── Test: with requestChanges ─────────────────────────────────────────────

describe('changeNodesToL3Document — with requestChanges', () => {
  const changes: readonly ChangeNode[] = [
    baseNode({
      metadata: {
        author: '@alice',
        date: '2026-04-27',
        requestChanges: [
          approval('@bob', '2026-04-27', 'needs more context'),
        ],
      },
    }),
  ];

  it('round-trips requestChanges through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes[0].requestChanges).toHaveLength(1);
    expect(parsed.footnotes[0].requestChanges[0].author).toBe('@bob');
    expect(parsed.footnotes[0].requestChanges[0].reason).toBe('needs more context');
  });

  it('emits request-changes: raw line in correct format', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const bl = doc.footnotes[0].bodyLines.find(l => l.kind === 'request-changes');
    expect(bl).toBeDefined();
    expect(bl!.raw).toBe('    request-changes: @bob 2026-04-27 "needs more context"');
  });
});

// ─── Test: with approvals + rejections ────────────────────────────────────

describe('changeNodesToL3Document — with approvals + rejections', () => {
  const changes: readonly ChangeNode[] = [
    baseNode({
      status: ChangeStatus.Accepted,
      metadata: {
        author: '@alice',
        date: '2026-04-27',
        status: 'accepted',
        approvals: [approval('@bob', '2026-04-27', 'LGTM')],
        rejections: [approval('@carol', '2026-04-28')],
      },
    }),
  ];

  it('round-trips approvals + rejections through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes[0].approvals).toHaveLength(1);
    expect(parsed.footnotes[0].approvals[0].reason).toBe('LGTM');
    expect(parsed.footnotes[0].rejections).toHaveLength(1);
    expect(parsed.footnotes[0].rejections[0].author).toBe('@carol');
  });

  it('emits approved: and rejected: lines correctly', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const bls = doc.footnotes[0].bodyLines;
    const appLine = bls.find(l => l.kind === 'approval');
    const rejLine = bls.find(l => l.kind === 'rejection');
    expect(appLine!.raw).toBe('    approved: @bob 2026-04-27 "LGTM"');
    expect(rejLine!.raw).toBe('    rejected: @carol 2026-04-28');
  });
});

// ─── Test: with resolution — type resolved ────────────────────────────────

describe('changeNodesToL3Document — resolution: resolved', () => {
  const res: Resolution = {
    type: 'resolved',
    author: '@alice',
    date: '2026-04-27',
    timestamp: parseTimestamp('2026-04-27'),
    reason: 'done',
  };
  const changes: readonly ChangeNode[] = [
    baseNode({
      metadata: { author: '@alice', date: '2026-04-27', resolution: res },
    }),
  ];

  it('round-trips resolved resolution through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes[0].resolution).toBeDefined();
    expect(parsed.footnotes[0].resolution!.type).toBe('resolved');
    expect((parsed.footnotes[0].resolution as { author: string }).author).toBe('@alice');
  });

  it('emits resolved: line in correct format', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const bl = doc.footnotes[0].bodyLines.find(l => l.kind === 'resolution');
    expect(bl!.raw).toBe('    resolved: @alice 2026-04-27 "done"');
  });
});

// ─── Test: with resolution — type open ────────────────────────────────────

describe('changeNodesToL3Document — resolution: open', () => {
  const res: Resolution = { type: 'open', reason: 'needs discussion' };
  const changes: readonly ChangeNode[] = [
    baseNode({
      metadata: { author: '@alice', date: '2026-04-27', resolution: res },
    }),
  ];

  it('round-trips open resolution through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes[0].resolution!.type).toBe('open');
    expect(parsed.footnotes[0].resolution!.reason).toBe('needs discussion');
  });

  it('emits open -- reason line', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const bl = doc.footnotes[0].bodyLines.find(l => l.kind === 'resolution');
    expect(bl!.raw).toBe('    open -- needs discussion');
  });
});

// ─── Test: with supersedes (single string) ────────────────────────────────

describe('changeNodesToL3Document — with supersedes', () => {
  const changes: readonly ChangeNode[] = [
    baseNode({
      supersedes: 'cn-0',
      metadata: { author: '@alice', date: '2026-04-27' },
    }),
  ];

  it('round-trips supersedes through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes[0].supersedes).toBe('cn-0');
  });

  it('emits supersedes: line with correct raw', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const bl = doc.footnotes[0].bodyLines.find(l => l.kind === 'supersedes');
    expect(bl).toBeDefined();
    expect(bl!.raw).toBe('    supersedes: cn-0');
  });
});

// ─── Test: with supersededBy (multiple ids) ───────────────────────────────

describe('changeNodesToL3Document — with supersededBy', () => {
  const changes: readonly ChangeNode[] = [
    baseNode({
      supersededBy: ['cn-2', 'cn-3'],
      metadata: { author: '@alice', date: '2026-04-27' },
    }),
  ];

  it('round-trips supersededBy array through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);

    expect(parsed.footnotes[0].supersededBy).toEqual(['cn-2', 'cn-3']);
  });

  it('emits one superseded-by: line per entry', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const bls = doc.footnotes[0].bodyLines.filter(l => l.kind === 'superseded-by');
    expect(bls).toHaveLength(2);
    expect(bls[0].raw).toBe('    superseded-by: cn-2');
    expect(bls[1].raw).toBe('    superseded-by: cn-3');
  });
});

// ─── Test: ALL metadata fields populated ──────────────────────────────────

describe('changeNodesToL3Document — all metadata populated', () => {
  const res: Resolution = {
    type: 'resolved',
    author: 'alice',
    date: '2026-04-27',
    timestamp: parseTimestamp('2026-04-27'),
    reason: 'done',
  };

  const changes: readonly ChangeNode[] = [
    {
      id: 'cn-5',
      type: ChangeType.Substitution,
      status: ChangeStatus.Proposed,
      range: { start: 0, end: 5 },
      contentRange: { start: 0, end: 5 },
      level: 2,
      anchored: false,
      resolved: true,
      supersedes: 'cn-4',
      supersededBy: ['cn-6', 'cn-7'],
      metadata: {
        author: '@alice',
        date: '2026-04-27',
        comment: 'why this change',
        approvals: [approval('@bob', '2026-04-27', 'LGTM')],
        rejections: [approval('@carol', '2026-04-28')],
        requestChanges: [approval('@dave', '2026-04-28', 'explain more')],
        revisions: [revision('r1', '@alice', '2026-04-27', 'initial')],
        discussion: [discussion('@bob', '2026-04-27', 'question here')],
        resolution: res,
      },
    },
  ];

  it('round-trips all metadata through serializeL3 + parseL3', () => {
    const doc = changeNodesToL3Document(BODY, changes);
    const text = serializeL3(doc);
    const parsed = parseL3(text);
    const fn = parsed.footnotes[0];

    expect(fn.id).toBe('cn-5');
    expect(fn.reason).toBe('why this change');
    expect(fn.approvals).toHaveLength(1);
    expect(fn.rejections).toHaveLength(1);
    expect(fn.requestChanges).toHaveLength(1);
    expect(fn.revisions).toHaveLength(1);
    expect(fn.discussion).toHaveLength(1);
    expect(fn.resolution?.type).toBe('resolved');
    expect(fn.supersedes).toBe('cn-4');
    expect(fn.supersededBy).toEqual(['cn-6', 'cn-7']);
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────

describe('changeNodesToL3Document — edge cases', () => {
  it('anchor absent → no edit-op line emitted', () => {
    const changes = [baseNode({ metadata: { author: '@alice', date: '2026-04-27' } })];
    const doc = changeNodesToL3Document(BODY, changes);
    const hasEditOp = doc.footnotes[0].bodyLines.some(l => l.kind === 'edit-op');
    expect(hasEditOp).toBe(false);
  });

  it('anchor.kind = line-hash with empty embedding → no edit-op line (guards against literal "undefined" in output)', () => {
    const changes = [
      baseNode({
        anchor: { kind: 'line-hash', line: 1, hash: 'ab', embedding: undefined },
        metadata: { author: '@alice', date: '2026-04-27' },
      }),
    ];
    const doc = changeNodesToL3Document(BODY, changes);
    const hasEditOp = doc.footnotes[0].bodyLines.some(l => l.kind === 'edit-op');
    expect(hasEditOp).toBe(false);
    // Crucially, no 'undefined' literal in the serialized text
    const text = serializeL3(doc);
    expect(text).not.toContain('undefined');
  });

  it('anchor.kind = line-hash with non-empty embedding → emits edit-op line', () => {
    const changes = [
      baseNode({
        anchor: { kind: 'line-hash', line: 1, hash: 'ab', embedding: '{++world++}' },
        metadata: { author: '@alice', date: '2026-04-27' },
      }),
    ];
    const doc = changeNodesToL3Document(BODY, changes);
    const editOpLine = doc.footnotes[0].bodyLines.find(l => l.kind === 'edit-op');
    expect(editOpLine).toBeDefined();
    expect(editOpLine!.raw).toBe('    1:ab {++world++}');
  });

  it('empty body → body field is empty string', () => {
    const changes = [baseNode({ metadata: { author: '@alice', date: '2026-04-27' } })];
    const doc = changeNodesToL3Document('', changes);
    expect(doc.body).toBe('');
    // serializeL3 should still produce a valid text
    const text = serializeL3(doc);
    expect(text).toContain('[^cn-1]:');
  });

  it('empty changes → footnotes array is empty', () => {
    const doc = changeNodesToL3Document(BODY, []);
    expect(doc.footnotes).toHaveLength(0);
    const text = serializeL3(doc);
    // No footnote section when no changes
    expect(text).not.toContain('[^');
    expect(text).toContain(BODY);
  });

  it('author without @ prefix is normalized to have @ prefix in header', () => {
    const changes = [
      baseNode({ metadata: { author: 'alice', date: '2026-04-27' } }),
    ];
    const doc = changeNodesToL3Document(BODY, changes);
    expect(doc.footnotes[0].header.author).toBe('@alice');
    const text = serializeL3(doc);
    expect(text).toContain('@alice');
  });

  it('author with @ prefix is not double-prefixed', () => {
    const changes = [
      baseNode({ metadata: { author: '@alice', date: '2026-04-27' } }),
    ];
    const doc = changeNodesToL3Document(BODY, changes);
    expect(doc.footnotes[0].header.author).toBe('@alice');
    expect(doc.footnotes[0].header.author).not.toContain('@@');
  });

  it('sourceRange sentinel is { startLine: -1, endLine: -1 }', () => {
    const changes = [baseNode({ metadata: { author: '@alice', date: '2026-04-27' } })];
    const doc = changeNodesToL3Document(BODY, changes);
    expect(doc.footnotes[0].sourceRange).toEqual({ startLine: -1, endLine: -1 });
  });

  it('multiple changes produce multiple footnotes in order', () => {
    const changes: readonly ChangeNode[] = [
      baseNode({ id: 'cn-1', metadata: { author: '@alice', date: '2026-04-27' } }),
      baseNode({ id: 'cn-2', metadata: { author: '@bob', date: '2026-04-27' } }),
    ];
    const doc = changeNodesToL3Document(BODY, changes);
    expect(doc.footnotes).toHaveLength(2);
    expect(doc.footnotes[0].id).toBe('cn-1');
    expect(doc.footnotes[1].id).toBe('cn-2');
  });
});
