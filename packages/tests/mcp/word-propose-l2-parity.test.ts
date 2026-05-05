import { describe, it, expect, beforeAll } from 'vitest';
import {
  initHashline,
  computeLineHash,
  handleProposeChange,
  SessionState,
  type ChangeDownConfig,
} from '@changedown/mcp/internals';
import { prepareCompactProposeChange } from '@changedown/cli/engine';
import { deriveSingleSupportedL2Delta } from '../../../packages/word-add-in/src/bridge/l2-delta.js';
import { createTestResolver } from './test-resolver.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const compactConfig: ChangeDownConfig = {
  tracking: { include: ['**/*.md'], exclude: [], default: 'tracked', auto_header: false },
  author: { default: 'ai:test-agent', enforcement: 'optional' },
  hooks: { enforcement: 'warn', exclude: [] },
  matching: { mode: 'normalized' },
  hashline: { enabled: true, auto_remap: false },
  settlement: { auto_on_approve: true, auto_on_reject: true },
  policy: { mode: 'safety-net', creation_tracking: 'footnote' },
  protocol: { mode: 'compact', level: 2, reasoning: 'optional', batch_reasoning: 'required' },
  reasoning: {
    propose: { human: false, agent: false },
    review: { human: false, agent: false },
  },
  response: { affected_lines: true },
};

describe('word:// propose_change L2 parity', () => {
  beforeAll(async () => {
    await initHashline();
  });

  it('prepares the same L2 bytes as file compact propose before the Word edge adapts markdown formatting', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-word-l2-parity-'));
    try {
      const content = 'first\nsecond';
      const hash = computeLineHash(0, 'first', content.split('\n'));
      const op = '{++**middle**++}';
      const args = { at: `1:${hash}`, op, author: 'ai:test-agent' };

      const filePath = path.join(tmpDir, 'doc.md');
      await fs.writeFile(filePath, content);
      const resolver = await createTestResolver(tmpDir, compactConfig);
      const fileState = new SessionState();
      const fileResult = await handleProposeChange(
        { file: filePath, ...args },
        resolver,
        fileState,
      );
      expect(fileResult.isError).toBeUndefined();
      const fileL2 = await fs.readFile(filePath, 'utf-8');

      const wordState = new SessionState();
      const prepared = await prepareCompactProposeChange({
        args,
        filePath: 'word://sess-test',
        relativePath: 'word://sess-test',
        fileContent: content,
        config: compactConfig,
        state: wordState,
      });

      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.oldL2).toBe(content);
      expect(prepared.newL2).toBe(fileL2);

      const delta = deriveSingleSupportedL2Delta(prepared.oldL2, prepared.newL2);
      expect(delta).toMatchObject({
        changeId: 'cn-1',
        type: 'ins',
        oldText: '',
        oldMarkdown: '',
        newText: 'middle\n',
        newMarkdown: '**middle**\n',
        position: { paragraphIndex: 1, column: 0 },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
