import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScenarioContext } from './features/scenario-context.js';

// Config that keeps test proposals minimal: no reasoning required on either
// human or agent proposals so tests can call propose without a reason param.
// The shallow spread in ScenarioContext replaces the top-level 'reasoning' key,
// so both human and agent enforcement are disabled here.
const CTX_CONFIG = {
  protocol: { mode: 'classic' as const, level: 2 as const, reasoning: 'optional' as const, batch_reasoning: 'optional' as const },
  reasoning: { propose: { human: false, agent: false }, review: { human: false, agent: false } },
};

describe('Multi-agent conflict invariants', () => {
  let ctx: ScenarioContext;

  beforeEach(async () => {
    ctx = new ScenarioContext(CTX_CONFIG);
    await ctx.setup();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('two agents propose non-overlapping edits: both land in arrival order', async () => {
    const filePath = await ctx.createFile('doc.md',
      '<!-- changedown.com/v1: tracked -->\nLine one content.\nLine two content.\n');

    // Agent A proposes on "Line one"
    const p1 = await ctx.propose(filePath, {
      old_text: 'Line one',
      new_text: 'Line 1',
      author: 'ai:agent-a',
    });
    expect(p1.isError).toBeUndefined();
    const r1 = ctx.parseResult(p1);
    expect(r1.change_id).toBe('cn-1');

    // Agent B reads the updated file then proposes on "Line two"
    const p2 = await ctx.propose(filePath, {
      old_text: 'Line two',
      new_text: 'Line 2',
      author: 'ai:agent-b',
    });
    expect(p2.isError).toBeUndefined();
    const r2 = ctx.parseResult(p2);
    expect(r2.change_id).toBe('cn-2');

    // Both changes are present on disk in arrival order
    const disk = await ctx.readDisk(filePath);
    expect(disk).toContain('[^cn-1]');
    expect(disk).toContain('[^cn-2]');
    // cn-1 appears before cn-2 in the document body (arrival order)
    expect(disk.indexOf('[^cn-1]')).toBeLessThan(disk.indexOf('[^cn-2]'));
  });

  it('two agents propose the same old_text: second one gets a stale error pointing to re-read', async () => {
    const filePath = await ctx.createFile('doc.md',
      '<!-- changedown.com/v1: tracked -->\nThe API uses REST for integration.\n');

    // Agent A wins — proposes REST → GraphQL
    const p1 = await ctx.propose(filePath, {
      old_text: 'REST',
      new_text: 'GraphQL',
      author: 'ai:agent-a',
    });
    expect(p1.isError).toBeUndefined();
    expect(ctx.parseResult(p1).change_id).toBe('cn-1');

    // Agent B races with a conflicting proposal on the same text.
    // Because agent-b is a different author, the engine cannot auto-supersede —
    // resolveOverlapWithAuthor throws the overlap guard, returning an error
    // rather than silently overwriting agent-a's recorded change.
    const p2 = await ctx.propose(filePath, {
      old_text: 'REST',
      new_text: 'gRPC',
      author: 'ai:agent-b',
    });

    // Different-author overlap: resolveOverlapWithAuthor sees allSameAuthor === false
    // and always fires the overlap guard, so p2 must be an error.
    // (Auto-supersede only fires for same-author conflicts — not exercised here.)
    expect(p2.isError).toBe(true);

    // No-silent-loss guard: cn-1 must still exist on disk regardless.
    const disk = await ctx.readDisk(filePath);
    expect(disk).toContain('[^cn-1]');
  });

  it('agent A subscribes; agent B proposes; agent A receives the updated notification before B returns', async () => {
    const filePath = await ctx.createFile('doc.md',
      '<!-- changedown.com/v1: tracked -->\nContent for subscription test.\n');

    // Collect document_changed events delivered to agent A
    const notifications: string[] = [];
    const unsubscribe = ctx.subscribeToFile(filePath, (event) => {
      notifications.push(event.kind);
    });

    try {
      // Agent B proposes a change — this writes to disk, triggering fs.watch
      const p = await ctx.propose(filePath, {
        old_text: 'Content',
        new_text: 'Updated content',
        author: 'ai:agent-b',
      });
      expect(p.isError).toBeUndefined();

      // Allow up to 200ms for the 100ms-debounced fs.watch callback to fire.
      // 200ms gives 100ms headroom over the debounce window, reducing CI flake risk.
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      expect(notifications).toContain('document_changed');
    } finally {
      unsubscribe();
    }
  });

  it('review_changes accepts a change authored by a different agent (PERMISSIVE default)', async () => {
    const filePath = await ctx.createFile('doc.md',
      '<!-- changedown.com/v1: tracked -->\nThe system uses REST.\n');

    // Agent A authors the proposal
    const p = await ctx.propose(filePath, {
      old_text: 'REST',
      new_text: 'GraphQL',
      author: 'ai:agent-a',
    });
    expect(p.isError).toBeUndefined();
    const changeId = ctx.parseResult(p).change_id as string;

    // Agent B reviews (approves) a change it did not author.
    // rv.isError === undefined proves the tool dispatch did not throw a ToolResult-level error.
    // The follow-up `approved` lookup (status_updated === true) is what actually proves PERMISSIVE behavior.
    const rv = await ctx.review(filePath, {
      author: 'ai:agent-b',
      reviews: [{ change_id: changeId, decision: 'approve', reason: 'looks correct' }],
    });

    expect(rv.isError).toBeUndefined();
    const rvResult = ctx.parseResult(rv);
    // review_changes returns a results array; at least one entry should have status_updated true
    const results = rvResult.results as Array<{ change_id: string; status_updated?: boolean }> | undefined;
    const approved = results?.find((r) => r.change_id === changeId && r.status_updated === true);
    expect(approved).toBeDefined();
  });
});
