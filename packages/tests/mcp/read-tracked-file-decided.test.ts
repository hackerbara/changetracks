import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { handleReadTrackedFile } from '@changedown/mcp/internals';
import { SessionState } from '@changedown/mcp/internals';
import { type ChangeDownConfig } from '@changedown/mcp/internals';
import { ConfigResolver } from '@changedown/mcp/internals';
import { createTestResolver } from './test-resolver.js';
import { initHashline } from '@changedown/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('read_tracked_file decided view', () => {
  let tmpDir: string;
  let state: SessionState;
  let config: ChangeDownConfig;
  let resolver: ConfigResolver;

  beforeAll(async () => {
    await initHashline();
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-decided-view-'));
    state = new SessionState();
    config = {
      tracking: {
        include: ['**/*.md'],
        exclude: ['node_modules/**', 'dist/**'],
        default: 'tracked',
        auto_header: true,
      },
      author: {
        default: 'ai:claude-opus-4.6',
        enforcement: 'optional',
      },
      hooks: {
        enforcement: 'warn',
        exclude: [],
      },
      matching: {
        mode: 'normalized',
      },
      hashline: {
        enabled: true,
        auto_remap: false,
      },
      settlement: { auto_on_approve: true, auto_on_reject: true },
      policy: { mode: 'safety-net', creation_tracking: 'footnote' },
      protocol: { mode: 'classic', level: 2, reasoning: 'optional', batch_reasoning: 'optional' },
    };
    resolver = await createTestResolver(tmpDir, config);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns decided view header and content', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      '# Title',
      'Clean line.',
    ].join('\n'));

    const result = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('## view: decided');
    expect(text).toMatch(/## proposed: \d+ \| accepted: \d+ \| rejected: \d+/);
    expect(text).toContain('# Title');
    expect(text).toContain('Clean line.');
  });

  it('shows P flag while reverting proposed insertion content', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      'Before {++added text++}[^cn-1] after',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
    ].join('\n'));

    const result = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toMatch(/P\| Before  after/);
    expect(text).not.toContain('added text');
    expect(text).not.toContain('[cn-1 @alice ins proposed]');
  });

  it('shows A flag for accepted changes', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      'Before {++added text++}[^cn-1] after',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | accepted',
    ].join('\n'));

    const result = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    const text = result.content[0].text;
    // Accepted insertion should be kept, line should have A flag
    // Unified format: "N:HH A| content {>>cn-N<<}"
    expect(text).toMatch(/A\| Before added text after/);
  });

  it('excludes footnote definitions from output', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      'Some text {++new++}[^cn-1]',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
      '    reason: clarity improvement',
    ].join('\n'));

    const result = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    const text = result.content[0].text;
    expect(text).not.toContain('[^cn-1]:');
    expect(text).not.toContain('reason: clarity improvement');
  });

  it('rejects committed as an unsupported view name', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, '# Title\nClean line.');

    const result = await handleReadTrackedFile(
      { file: filePath, view: 'committed' },
      resolver,
      state,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown view 'committed'");
    expect(result.content[0].text).toContain('decided');
  });

  it('records decided-coordinate hashes in session state', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      '# Title',
      'Clean line.',
    ].join('\n'));

    await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    const hashes = state.getRecordedHashes(filePath);
    expect(hashes).toBeDefined();
    expect(hashes!.length).toBe(2);
    expect(hashes![0].rawLineNum).toBeDefined();
    expect(hashes![0].committed).toMatch(/^[0-9a-f]{2}$/);
  });

  it('shows change summary in header', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      'Before {++added++}[^cn-1] after',
      '{--removed--}[^cn-2]',
      'Clean line.',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
      '[^cn-2]: @alice | 2026-02-17 | del | accepted',
    ].join('\n'));

    const result = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    const text = result.content[0].text;
    // Unified format: "proposed: N | accepted: N | rejected: N"
    expect(text).toContain('proposed: 1');
    expect(text).toContain('accepted: 1');
  });

  it('returns decided output when hashline is disabled', async () => {
    const disabledConfig: ChangeDownConfig = {
      ...config,
      hashline: { enabled: false, auto_remap: false },
    };
    const disabledResolver = await createTestResolver(tmpDir, disabledConfig);
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, '# Title\n');

    const result = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      disabledResolver,
      state,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('## view: decided');
    expect(result.content[0].text).toContain('Hashline addressing is disabled');
  });

  it('shows clean summary for file without CriticMarkup', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, '# Title\nSome text.\n');

    const result = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    const text = result.content[0].text;
    // Unified format always shows all three counts, even when all zero
    expect(text).toContain('proposed: 0');
    expect(text).toContain('accepted: 0');
    expect(text).toContain('rejected: 0');
  });
});
