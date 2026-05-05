// packages/tests/engine/file-backend.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHashline } from '@changedown/core';
import { FileBackend } from '@changedown/cli/engine';
import type { DocumentRef } from '@changedown/core/backend';

const SAMPLE_CONTENT = `# Test Document

Hello world.

`;

const CONFIG_TOML = `[tracking]
include = ["**/*.md"]
[author]
default = "ai:test"
[hashline]
enabled = true
[settlement]
auto_on_approve = false
[reasoning.propose]
agent = false
`;

describe('FileBackend', () => {
  let tmpDir: string;
  let filePath: string;
  let ref: DocumentRef;
  let backend: FileBackend;

  beforeAll(async () => {
    await initHashline();
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cd-file-backend-'));
    const configDir = path.join(tmpDir, '.changedown');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'config.toml'), CONFIG_TOML);
    filePath = path.join(tmpDir, 'doc.md');
    await fs.writeFile(filePath, SAMPLE_CONTENT);
    ref = { uri: `file://${filePath}` };
    backend = new FileBackend(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('declares "file" scheme', () => {
    expect(backend.schemes).toContain('file');
  });

  // ── read() ──────────────────────────────────────────────────────────────

  it('read() returns a snapshot with text, format, and version', async () => {
    const snapshot = await backend.read(ref);
    expect(snapshot.text).toContain('Hello world');
    expect(snapshot.format).toBe('L2');
    expect(typeof snapshot.version).toBe('string');
    expect(snapshot.version.length).toBeGreaterThan(0);
  });

  it('read() throws on a non-existent file', async () => {
    const badRef: DocumentRef = { uri: `file://${tmpDir}/nonexistent.md` };
    await expect(backend.read(badRef)).rejects.toThrow();
  });

  it('read() throws on a URI with a non-file scheme', async () => {
    const badRef: DocumentRef = { uri: 'word://sess-123' };
    await expect(backend.read(badRef)).rejects.toThrow('scheme');
  });

  it('read() throws a helpful error on a file:// URI with a remote host', async () => {
    const badRef: DocumentRef = { uri: 'file://remotehost/foo' };
    await expect(backend.read(badRef)).rejects.toThrow(/cannot resolve URI to path/);
  });

  // ── listChanges() ────────────────────────────────────────────────────────

  it('listChanges() returns an empty array for a file with no changes', async () => {
    const changes = await backend.listChanges(ref);
    expect(changes).toEqual([]);
  });

  it('listChanges() returns one entry after a propose via applyChange', async () => {
    await backend.applyChange(ref, {
      kind: 'propose',
      args: {
        file: filePath,
        old_text: 'Hello world.',
        new_text: 'Hello universe.',
        author: 'ai:test',
      },
    });
    const changes = await backend.listChanges(ref);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.changeId).toBe('cn-1');
    expect(changes[0]!.status).toBe('proposed');
  });

  // ── applyChange() — propose ───────────────────────────────────────────────

  it('applyChange() propose returns { applied: true, changeId }', async () => {
    const result = await backend.applyChange(ref, {
      kind: 'propose',
      args: {
        file: filePath,
        old_text: 'Hello world.',
        new_text: 'Hello universe.',
        author: 'ai:test',
      },
    });
    expect(result.applied).toBe(true);
    expect(result.changeId).toBe('cn-1');
  });

  it('applyChange() propose writes the CriticMarkup to disk', async () => {
    await backend.applyChange(ref, {
      kind: 'propose',
      args: {
        file: filePath,
        old_text: 'Hello world.',
        new_text: 'Hello universe.',
        author: 'ai:test',
      },
    });
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('{~~Hello world.~>Hello universe.~~}');
  });

  // ── applyChange() — review ────────────────────────────────────────────────

  it('applyChange() review accepts a proposed change', async () => {
    await backend.applyChange(ref, {
      kind: 'propose',
      args: { file: filePath, old_text: 'Hello world.', new_text: 'Hello universe.', author: 'ai:test' },
    });
    const result = await backend.applyChange(ref, {
      kind: 'review',
      args: {
        file: filePath,
        reviews: [{ change_id: 'cn-1', decision: 'approve', reason: 'looks good' }],
      },
    });
    expect(result.applied).toBe(true);
  });

  // ── applyChange() — unknown kind ──────────────────────────────────────────

  it('applyChange() rejects an unknown op kind', async () => {
    await expect(
      backend.applyChange(ref, { kind: 'unknown_op' as 'propose', args: {} }),
    ).rejects.toThrow('Unknown ChangeOp kind');
  });

  // ── subscribe() ───────────────────────────────────────────────────────────

  it('subscribe() returns an Unsubscribe function', () => {
    const unsub = backend.subscribe(ref, () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('subscribe() fires document_changed when file is written externally', async () => {
    const events: string[] = [];
    const unsub = backend.subscribe(ref, (e) => {
      if (e.kind === 'document_changed') events.push(e.version);
    });

    await fs.writeFile(filePath, SAMPLE_CONTENT + '\nExtra line\n');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 500);
      const poll = setInterval(() => {
        if (events.length > 0) { clearInterval(poll); clearTimeout(timeout); resolve(); }
      }, 20);
      void poll; void timeout;
    });

    unsub();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('subscribe() stops firing after Unsubscribe is called', async () => {
    const events: string[] = [];
    const unsub = backend.subscribe(ref, (e) => {
      if (e.kind === 'document_changed') events.push(e.version);
    });
    unsub();

    await fs.writeFile(filePath, SAMPLE_CONTENT + '\nafter unsub\n');
    await new Promise((r) => setTimeout(r, 300));

    expect(events).toHaveLength(0);
  });
});
