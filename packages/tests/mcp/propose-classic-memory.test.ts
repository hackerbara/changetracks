import { describe, it, expect, beforeEach } from 'vitest';
import { initHashline } from '@changedown/core';
import {
  DEFAULT_CONFIG,
  SessionState,
  prepareClassicProposeChange,
  prepareCompactProposeChange,
  computeLineHash,
  type ChangeDownConfig,
} from '@changedown/mcp/internals';

const baseConfig: ChangeDownConfig = {
  ...DEFAULT_CONFIG,
  tracking: { include: ['**/*.md'], exclude: [], default: 'tracked', auto_header: false },
  author: { default: 'ai:test-agent', enforcement: 'optional' },
  hashline: { enabled: true, auto_remap: false },
  protocol: { mode: 'classic', level: 2, reasoning: 'optional', batch_reasoning: 'required' },
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

describe('prepareClassicProposeChange', () => {
  beforeEach(async () => {
    await initHashline();
  });

  it('substitutes old_text/new_text without writing to disk', async () => {
    const state = new SessionState();
    const oldL2 = 'The quick fox';

    const result = await prepareClassicProposeChange({
      args: {
        file: 'word://sess-test',
        old_text: 'quick',
        new_text: 'slow',
        reason: 'clearer',
        author: 'ai:codex',
      },
      filePath: 'word://sess-test',
      relativePath: 'word://sess-test',
      fileContent: oldL2,
      config: baseConfig,
      state,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.oldL2).toBe(oldL2);
    expect(result.newL2).toContain('{~~quick~>slow~~}[^cn-1]');
    expect(result.newL2).toContain('[^cn-1]: @ai:codex');
    expect(result.newL2).toContain('clearer');
    expect(JSON.parse(result.toolResult.content[0]!.text)).toMatchObject({
      change_id: 'cn-1',
      file: 'word://sess-test',
      type: 'sub',
    });
  });

  it('inserts using insert_after', async () => {
    const state = new SessionState();
    const oldL2 = 'first paragraph\nsecond paragraph';

    const result = await prepareClassicProposeChange({
      args: {
        file: 'word://sess-test',
        old_text: '',
        new_text: '\ninserted paragraph',
        insert_after: 'first paragraph',
        author: 'ai:codex',
      },
      filePath: 'word://sess-test',
      relativePath: 'word://sess-test',
      fileContent: oldL2,
      config: baseConfig,
      state,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.newL2).toContain('{++\ninserted paragraph++}[^cn-1]');
    expect(JSON.parse(result.toolResult.content[0]!.text)).toMatchObject({ type: 'ins' });
  });

  it('deletes with empty new_text', async () => {
    const state = new SessionState();
    const oldL2 = 'keep this\ndelete this\nkeep that';

    const result = await prepareClassicProposeChange({
      args: {
        file: 'word://sess-test',
        old_text: 'delete this',
        new_text: '',
        author: 'ai:codex',
      },
      filePath: 'word://sess-test',
      relativePath: 'word://sess-test',
      fileContent: oldL2,
      config: baseConfig,
      state,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.newL2).toContain('{--delete this--}[^cn-1]');
    expect(JSON.parse(result.toolResult.content[0]!.text)).toMatchObject({ type: 'del' });
  });

  it('normalizes a one-element changes array into the same classic path', async () => {
    const state = new SessionState();
    const result = await prepareClassicProposeChange({
      args: {
        file: 'word://sess-test',
        author: 'ai:codex',
        changes: [{ old_text: 'alpha', new_text: 'beta', reason: 'single-array' }],
      },
      filePath: 'word://sess-test',
      relativePath: 'word://sess-test',
      fileContent: 'alpha',
      config: baseConfig,
      state,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.newL2).toContain('{~~alpha~>beta~~}[^cn-1]');
    expect(result.newL2).toContain('single-array');
  });

  it('rejects multi-change arrays for Word-diskless classic preparation', async () => {
    const state = new SessionState();
    const result = await prepareClassicProposeChange({
      args: {
        file: 'word://sess-test',
        author: 'ai:codex',
        changes: [
          { old_text: 'alpha', new_text: 'beta' },
          { old_text: 'one', new_text: 'two' },
        ],
      },
      filePath: 'word://sess-test',
      relativePath: 'word://sess-test',
      fileContent: 'alpha\none',
      config: baseConfig,
      state,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error result');
    expect(result.toolResult.isError).toBe(true);
    expect(result.toolResult.content[0]!.text).toMatch(/one proposal per call/i);
  });

  it('produces an L2 delta that the Word adapter can derive', async () => {
    const state = new SessionState();
    const oldL2 = 'The quick fox';
    const classic = await prepareClassicProposeChange({
      args: {
        file: 'word://sess-test',
        old_text: 'quick',
        new_text: 'slow',
        author: 'ai:codex',
      },
      filePath: 'word://sess-test',
      relativePath: 'word://sess-test',
      fileContent: oldL2,
      config: baseConfig,
      state,
    });

    expect(classic.ok).toBe(true);
    if (!classic.ok) throw new Error('expected ok result');
    const compactState = new SessionState();
    compactState.recordAfterRead('word://sess-test', 'working', [{
      line: 1,
      raw: hashForLine(oldL2, 1),
      committed: hashForLine(oldL2, 1),
      currentView: hashForLine(oldL2, 1),
      rawLineNum: 1,
    }], oldL2);
    const compact = await prepareCompactProposeChange({
      args: {
        file: 'word://sess-test',
        at: `1:${hashForLine(oldL2, 1)}`,
        op: '{~~quick~>slow~~}',
        author: 'ai:codex',
      },
      filePath: 'word://sess-test',
      relativePath: 'word://sess-test',
      fileContent: oldL2,
      config: { ...baseConfig, protocol: { ...baseConfig.protocol, mode: 'compact' } },
      state: compactState,
    });

    expect(compact.ok).toBe(true);
    if (!compact.ok) throw new Error('expected compact ok result');
    expect(classic.oldL2).toBe(compact.oldL2);
    expect(classic.newL2).toContain('{~~quick~>slow~~}');
    expect(compact.newL2).toContain('{~~quick~>slow~~}');
  });
});
