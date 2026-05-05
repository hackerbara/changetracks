import { describe, it, expect, beforeAll } from 'vitest';
import { initHashline, computeLineHash } from '@changedown/core';
import { prepareCompactProposeChange, SessionState, type ChangeDownConfig } from '@changedown/cli/engine';
import { deriveSingleSupportedL2Delta } from '../../word-add-in/src/bridge/l2-delta';

const config: ChangeDownConfig = {
  tracking: { include: ['**/*.md'], exclude: [], default: 'tracked', auto_header: false },
  author: { default: 'ai:test-agent', enforcement: 'optional' },
  hooks: { enforcement: 'warn', exclude: [], intercept_tools: true, intercept_bash: false },
  matching: { mode: 'normalized' },
  hashline: { enabled: true, auto_remap: false },
  settlement: { auto_on_approve: true, auto_on_reject: true },
  policy: { mode: 'safety-net', creation_tracking: 'footnote' },
  protocol: { mode: 'compact', level: 2, reasoning: 'required', batch_reasoning: 'required' },
  reasoning: { propose: { human: true, agent: true }, review: { human: true, agent: true } },
  response: { affected_lines: true },
};

function hashForLine(content: string, line: number): string {
  const lines = content.split('\n');
  return computeLineHash(line - 1, lines[line - 1]!, lines);
}

describe('Word L2 delta with existing Word-origin changes', () => {
  beforeAll(async () => {
    await initHashline();
  });

  it('derives the single native delta from a compact proposal after an existing Word-origin insertion', async () => {
    const oldL2 = '{++Here’s some text to anchor on++}[^cn-1]\n\n{++and a tracked change++}[^cn-2]\n\n[^cn-1]: @unknown (text-diff) | 2026-05-01T05:01:15.846Z | ins | proposed\n[^cn-2]: @unknown (text-diff) | 2026-05-01T05:01:16.000Z | ins | proposed\n';
    const hash = hashForLine(oldL2, 1);
    const state = new SessionState();
    state.recordAfterRead('word://sess-test', 'working', [
      { line: 1, raw: hash, currentView: hash, rawLineNum: 1 },
    ], oldL2);

    const prepared = await prepareCompactProposeChange({
      args: {
        at: `1:${hash}`,
        op: '{++ — Codex can see this anchor.++}',
        author: 'ai:codex',
        reason: 'Smoke-test an anchored insertion after reading native Word tracked changes.',
      },
      filePath: 'word://sess-test',
      relativePath: 'word://sess-test',
      fileContent: oldL2,
      config,
      state,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(() => deriveSingleSupportedL2Delta(prepared.oldL2, prepared.newL2)).not.toThrow();
    const delta = deriveSingleSupportedL2Delta(prepared.oldL2, prepared.newL2);
    expect(delta).toMatchObject({
      changeId: 'cn-3',
      author: 'ai:codex',
      type: 'ins',
      oldText: '',
      newText: ' — Codex can see this anchor.\n',
      position: { paragraphIndex: 1, column: 0 },
    });
  });
});
