import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { handleProposeChange } from '@changedown/mcp/internals';
import { handleReadTrackedFile } from '@changedown/mcp/internals';
import { SessionState } from '@changedown/mcp/internals';
import { type ChangeDownConfig } from '@changedown/mcp/internals';
import { createTestResolver } from './test-resolver.js';
import { initHashline } from '@changedown/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('propose_change with settled hashes', () => {
  let tmpDir: string;
  let state: SessionState;
  let config: ChangeDownConfig;

  beforeAll(async () => {
    await initHashline();
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-propose-settled-'));
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
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('accepts settled hash and maps to raw position for substitution', async () => {
    // File with a proposed insertion — in final view (accept-all), the insertion
    // text appears as a real line, so final line numbers shift relative to raw
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      '<!-- changedown.com/v1: tracked -->',
      '# Title',
      '{++Inserted line.++}[^cn-1]',
      'Line after.',
      '',
      '[^cn-1]: @alice | 2026-02-24 | ins | proposed',
      '    @alice 2026-02-24: adding context',
    ].join('\n'));

    const resolver = await createTestResolver(tmpDir, config);

    // 1. Read with decided view (records decided hashes with rawLineNum in session state)
    const readResult = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );
    expect(readResult.isError).toBeUndefined();

    // Extract settled hash for "Line after." from output
    const readText = readResult.content[0].text;
    const lines = readText.split('\n');
    const targetLineEntry = lines.find(l => l.includes('Line after.'));
    expect(targetLineEntry).toBeDefined();

    // Parse the settled line format: "N:HH|content"
    const match = targetLineEntry!.match(/^\s*(\d+):([0-9a-f]{2})/);
    expect(match).toBeDefined();
    const settledLineNum = parseInt(match![1], 10);
    const settledHash = match![2];

    // 2. Propose a change using settled coordinates
    const proposeResult = await handleProposeChange(
      {
        file: filePath,
        old_text: 'Line after.',
        new_text: 'Updated after.',
        start_line: settledLineNum,
        start_hash: settledHash,
        reason: 'test update via settled coordinates',
      },
      resolver,
      state,
    );

    if (proposeResult.isError) {
      throw new Error(`propose_change failed: ${proposeResult.content[0].text}`);
    }
    const response = JSON.parse(proposeResult.content[0].text);
    expect(response.change_id).toBeDefined();
    expect(response.type).toBe('sub');

    // 3. Verify the file was modified correctly
    const modifiedContent = await fs.readFile(filePath, 'utf-8');
    expect(modifiedContent).toContain('{~~Line after.~>Updated after.~~}');
  });

  it('returns error for stale settled hash', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      '<!-- changedown.com/v1: tracked -->',
      '# Title',
      'Some text.',
    ].join('\n'));

    const resolver = await createTestResolver(tmpDir, config);

    // 1. Read with decided view (records decided hashes)
    await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    // 2. Propose with wrong settled hash
    const proposeResult = await handleProposeChange(
      {
        file: filePath,
        old_text: 'Some text.',
        new_text: 'Updated text.',
        start_line: 2,
        start_hash: 'zz', // wrong hash
        reason: 'test',
      },
      resolver,
      state,
    );

    expect(proposeResult.isError).toBe(true);
    const errorText = proposeResult.content[0].text;
    expect(errorText).toContain('Hash mismatch on line');
    expect(errorText).toContain('read_tracked_file');
  });

  it('handles file with pending deletion — deleted line present in decided view', async () => {
    // In decided view, a pending deletion line is still visible (only accepted
    // changes are applied; proposed deletions are kept pending).
    // The agent can still target lines around the deletion using decided-space coordinates.
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      '<!-- changedown.com/v1: tracked -->',
      '# Title',
      'Line before.',
      '{--Deleted line.--}[^cn-1]',
      'Line after deletion.',
      '',
      '[^cn-1]: @alice | 2026-02-24 | del | proposed',
    ].join('\n'));

    const resolver = await createTestResolver(tmpDir, config);

    // 1. Read decided view — "Deleted line." is present (pending deletions not yet applied)
    const readResult = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );
    expect(readResult.isError).toBeUndefined();
    const readText = readResult.content[0].text;

    // Verify the deleted line IS in decided output (pending, not yet accepted)
    expect(readText).toContain('Deleted line.');

    // Extract settled hash for "Line after deletion."
    const lines = readText.split('\n');
    const afterEntry = lines.find(l => l.includes('Line after deletion.'));
    expect(afterEntry).toBeDefined();

    const match = afterEntry!.match(/^\s*(\d+):([0-9a-f]{2})/);
    expect(match).toBeDefined();
    const settledLineNum = parseInt(match![1], 10);
    const settledHash = match![2];

    // 2. Propose a change targeting "Line after deletion."
    const proposeResult = await handleProposeChange(
      {
        file: filePath,
        old_text: 'Line after deletion.',
        new_text: 'Updated after deletion.',
        start_line: settledLineNum,
        start_hash: settledHash,
        reason: 'edit near deletion',
      },
      resolver,
      state,
    );

    if (proposeResult.isError) {
      throw new Error(`propose_change failed: ${proposeResult.content[0].text}`);
    }
    const response = JSON.parse(proposeResult.content[0].text);
    expect(response.type).toBe('sub');

    // 3. Verify the correct raw line was modified
    const modifiedContent = await fs.readFile(filePath, 'utf-8');
    expect(modifiedContent).toContain('{~~Line after deletion.~>Updated after deletion.~~}');
    // The original deletion markup should still be intact
    expect(modifiedContent).toContain('{--Deleted line.--}');
  });

  it('re-records settled hashes after edit for chained edits', async () => {
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      '<!-- changedown.com/v1: tracked -->',
      '# Title',
      'First line.',
      'Second line.',
    ].join('\n'));

    const resolver = await createTestResolver(tmpDir, config);

    // 1. Read with decided view
    const readResult = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );

    // Extract hash for "First line."
    const readText = readResult.content[0].text;
    const firstLine = readText.split('\n').find(l => l.includes('First line.'));
    const firstMatch = firstLine!.match(/^\s*(\d+):([0-9a-f]{2})/);
    const firstLineNum = parseInt(firstMatch![1], 10);
    const firstHash = firstMatch![2];

    // 2. Make first edit
    const proposeResult = await handleProposeChange(
      {
        file: filePath,
        old_text: 'First line.',
        new_text: 'Updated first line.',
        start_line: firstLineNum,
        start_hash: firstHash,
        reason: 'test',
      },
      resolver,
      state,
    );
    expect(proposeResult.isError).toBeUndefined();

    // 3. Verify settled hashes were re-recorded (should have currentView field)
    const hashes = state.getRecordedHashes(filePath);
    expect(hashes).toBeDefined();
    expect(hashes!.some(h => h.currentView !== undefined)).toBe(true);

    // 4. Read decided view again to get fresh hashes for second edit
    const readResult2 = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );
    const readText2 = readResult2.content[0].text;
    const secondLine = readText2.split('\n').find(l => l.includes('Second line.'));
    expect(secondLine).toBeDefined();
    const secondMatch = secondLine!.match(/^\s*(\d+):([0-9a-f]{2})/);
    const secondLineNum = parseInt(secondMatch![1], 10);
    const secondHash = secondMatch![2];

    // 5. Make second edit using settled coordinates
    const proposeResult2 = await handleProposeChange(
      {
        file: filePath,
        old_text: 'Second line.',
        new_text: 'Updated second line.',
        start_line: secondLineNum,
        start_hash: secondHash,
        reason: 'test',
      },
      resolver,
      state,
    );
    expect(proposeResult2.isError).toBeUndefined();

    // 6. Verify both edits applied
    const finalContent = await fs.readFile(filePath, 'utf-8');
    expect(finalContent).toContain('{~~First line.~>Updated first line.~~}');
    expect(finalContent).toContain('{~~Second line.~>Updated second line.~~}');
  });

  it('maps settled coordinates for insertion (after_line)', async () => {
    // Test inserting new content using settled-space after_line coordinate
    const filePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(filePath, [
      '<!-- changedown.com/v1: tracked -->',
      '# Title',
      '{++Existing insertion.++}[^cn-1]',
      'Target line.',
      '',
      '[^cn-1]: @alice | 2026-02-24 | ins | proposed',
    ].join('\n'));

    const resolver = await createTestResolver(tmpDir, config);

    // 1. Read decided view
    const readResult = await handleReadTrackedFile(
      { file: filePath, view: 'decided' },
      resolver,
      state,
    );
    expect(readResult.isError).toBeUndefined();

    // Extract settled hash for "Target line."
    const readText = readResult.content[0].text;
    const targetEntry = readText.split('\n').find(l => l.includes('Target line.'));
    expect(targetEntry).toBeDefined();
    const match = targetEntry!.match(/^\s*(\d+):([0-9a-f]{2})/);
    const settledLineNum = parseInt(match![1], 10);
    const settledHash = match![2];

    // 2. Insert after "Target line." using settled coordinates
    const proposeResult = await handleProposeChange(
      {
        file: filePath,
        old_text: '',
        new_text: 'New content here.',
        after_line: settledLineNum,
        after_hash: settledHash,
        reason: 'insert via settled coordinates',
      },
      resolver,
      state,
    );

    if (proposeResult.isError) {
      throw new Error(`propose_change failed: ${proposeResult.content[0].text}`);
    }
    const response = JSON.parse(proposeResult.content[0].text);
    expect(response.type).toBe('ins');

    // 3. Verify the insertion was placed correctly
    const modifiedContent = await fs.readFile(filePath, 'utf-8');
    expect(modifiedContent).toContain('{++New content here.++}');
  });
});
