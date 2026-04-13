import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleProposeChange } from '@changedown/mcp/internals';
import { SessionState } from '@changedown/mcp/internals';
import { type ChangeDownConfig } from '@changedown/mcp/internals';
import { ConfigResolver } from '@changedown/mcp/internals';
import { createTestResolver } from './test-resolver.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('debug settle-on-demand', () => {
  let tmpDir: string;
  let state: SessionState;
  let config: ChangeDownConfig;
  let resolver: ConfigResolver;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-debug-'));
    state = new SessionState();
    config = {
      tracking: { include: ['**/*.md'], exclude: ['node_modules/**', 'dist/**'], default: 'tracked', auto_header: true },
      author: { default: 'ai:claude-opus-4.6', enforcement: 'optional' },
      hooks: { enforcement: 'warn', exclude: [] },
      matching: { mode: 'normalized' },
      hashline: { enabled: false, auto_remap: false },
      settlement: { auto_on_approve: true, auto_on_reject: true },
      policy: { mode: 'safety-net', creation_tracking: 'footnote' },
      protocol: { mode: 'classic', level: 2, reasoning: 'optional', batch_reasoning: 'optional' },
    };
    resolver = await createTestResolver(tmpDir, config);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('shows actual error message', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    const content = [
      '<!-- changedown.com/v1: tracked -->',
      'Hello {~~old~>new~~}[^cn-1] world',
      '',
      '[^cn-1]: @alice | 2026-03-04 | sub | accepted',
      '    approved: @bob 2026-03-04 "ok"',
    ].join('\n');
    await fs.writeFile(filePath, content);

    const result = await handleProposeChange(
      { file: filePath, old_text: 'new', new_text: 'newer', author: 'ai:test-model', reason: 'test' },
      resolver,
      state,
    );

    // Previously returned INTERNAL_ERROR "L3 format detected but level is not 3" because
    // applyAcceptedChanges generates L3 edit-op audit lines during settle-on-demand, making the
    // settled content L3. The handler now auto-upgrades to level:3 when it detects L3 content.
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.change_id).toBeDefined();
    expect(data.change_id).toBe('cn-2'); // cn-1 is the accepted change; cn-2 is the new proposal
  });
});
