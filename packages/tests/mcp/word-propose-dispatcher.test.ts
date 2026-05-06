import { describe, it, expect, beforeEach } from 'vitest';
import { initHashline } from '@changedown/core';
import {
  DEFAULT_CONFIG,
  SessionState,
  computeLineHash,
  applyPreparedWordProposeChange,
  prepareWordProposeChange,
  type ChangeDownConfig,
} from '@changedown/mcp/internals';

const compactConfig: ChangeDownConfig = {
  ...DEFAULT_CONFIG,
  tracking: { include: ['**/*.md'], exclude: [], default: 'tracked', auto_header: false },
  author: { default: 'ai:test-agent', enforcement: 'optional' },
  hashline: { enabled: true, auto_remap: false },
  protocol: { mode: 'compact', level: 2, reasoning: 'optional', batch_reasoning: 'required' },
  reasoning: {
    propose: { human: false, agent: false },
    review: { human: false, agent: false },
  },
  response: { affected_lines: true },
};

function hashForLine(content: string, lineNum: number): string {
  const lines = content.split('\n');
  return computeLineHash(lineNum - 1, lines[lineNum - 1] ?? '', lines);
}

describe('prepareWordProposeChange', () => {
  beforeEach(async () => {
    await initHashline();
  });

  it('routes compact+hashline arguments to compact preparation', async () => {
    const state = new SessionState();
    const source = 'The quick fox';
    state.recordAfterRead('word://sess-test', 'working', [{
      line: 1,
      raw: hashForLine(source, 1),
      committed: hashForLine(source, 1),
      currentView: hashForLine(source, 1),
      rawLineNum: 1,
    }], source);

    const prepared = await prepareWordProposeChange({
      args: {
        file: 'word://sess-test',
        at: `1:${hashForLine(source, 1)}`,
        op: '{~~quick~>slow~~}',
        author: 'ai:codex',
      },
      uri: 'word://sess-test',
      snapshotText: source,
      config: compactConfig,
      state,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('expected ok result');
    expect(prepared.family).toBe('compact');
    expect(prepared.oldL2).toBe(source);
    expect(prepared.newL2).toContain('{~~quick~>slow~~}');
  });

  it('routes classic arguments even when config mode is compact', async () => {
    const state = new SessionState();
    const source = 'The quick fox';

    const prepared = await prepareWordProposeChange({
      args: {
        file: 'word://sess-test',
        old_text: 'quick',
        new_text: 'slow',
        author: 'ai:codex',
      },
      uri: 'word://sess-test',
      snapshotText: source,
      config: compactConfig,
      state,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('expected ok result');
    expect(prepared.family).toBe('classic');
    expect(prepared.oldL2).toBe(source);
    expect(prepared.newL2).toContain('{~~quick~>slow~~}');
  });

  it('rejects mixed compact and classic arguments', async () => {
    const state = new SessionState();
    const prepared = await prepareWordProposeChange({
      args: {
        file: 'word://sess-test',
        at: '1:aa',
        op: '{~~quick~>slow~~}',
        old_text: 'quick',
        new_text: 'slow',
        author: 'ai:codex',
      },
      uri: 'word://sess-test',
      snapshotText: 'The quick fox',
      config: compactConfig,
      state,
    });

    expect(prepared.ok).toBe(false);
    if (prepared.ok) throw new Error('expected error result');
    expect(prepared.toolResult.isError).toBe(true);
    expect(prepared.toolResult.content[0]!.text).toMatch(/mixed proposal families/i);
  });

  it('rejects multi-change arrays for word sessions before backend apply', async () => {
    const state = new SessionState();
    const prepared = await prepareWordProposeChange({
      args: {
        file: 'word://sess-test',
        author: 'ai:codex',
        changes: [
          { old_text: 'quick', new_text: 'slow' },
          { old_text: 'fox', new_text: 'hare' },
        ],
      },
      uri: 'word://sess-test',
      snapshotText: 'The quick fox',
      config: compactConfig,
      state,
    });

    expect(prepared.ok).toBe(false);
    if (prepared.ok) throw new Error('expected error result');
    expect(prepared.toolResult.content[0]!.text).toMatch(/one proposal per call/i);
  });

  it('rejects classic preparation that would auto-settle accepted/rejected history for word sessions', async () => {
    const state = new SessionState();
    const source = '{++Alpha++}[^cn-1]\n\n[^cn-1]: @ai:prior | 2026-05-06 | ins | accepted\n';

    const prepared = await prepareWordProposeChange({
      args: {
        file: 'word://sess-test',
        old_text: 'Alpha',
        new_text: 'Beta',
        author: 'ai:codex',
      },
      uri: 'word://sess-test',
      snapshotText: source,
      config: compactConfig,
      state,
    });

    expect(prepared.ok).toBe(false);
    if (prepared.ok) throw new Error('expected error result');
    expect(prepared.toolResult.content[0]!.text).toMatch(/settling accepted\/rejected changes/i);
  });


  it('applies prepared backend payload as only oldL2/newL2 and never public classic args', async () => {
    const state = new SessionState();
    const source = 'Alpha beta';
    const prepared = await prepareWordProposeChange({
      args: {
        file: 'word://sess-test',
        old_text: 'beta',
        new_text: 'gamma',
        author: 'ai:codex',
      },
      uri: 'word://sess-test',
      snapshotText: source,
      config: compactConfig,
      state,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('expected ok result');

    const calls: unknown[] = [];
    const backend = {
      async applyChange(target: unknown, op: unknown) {
        calls.push({ target, op });
        return { applied: true, text: 'ok' };
      },
    };

    await applyPreparedWordProposeChange(backend, 'word://sess-test', prepared);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      target: { uri: 'word://sess-test' },
      op: {
        kind: 'propose',
        args: { oldL2: source },
      },
    });
    const args = (calls[0] as { op: { args: Record<string, unknown> } }).op.args;
    expect(Object.keys(args).sort()).toEqual(['newL2', 'oldL2']);
    expect(JSON.stringify(args)).not.toContain('old_text');
    expect(JSON.stringify(args)).not.toContain('new_text');
    expect(JSON.stringify(args)).not.toContain('insert_after');
  });

});
