import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ChangedownLspClient, renderProjection, applyTextEdits } from '@changedown/vienna-plugin';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const TEST_DIR = resolve('/tmp/vienna-plugin-integration-test');
const TEST_FILE = resolve(TEST_DIR, 'test.md');
const TEST_URI = `file://${TEST_FILE}`;

const TRACKED_CONTENT = `# Test Plan

This plan has {++a new section++} and {--an old section--} to review.

The {~~original text~>updated text~~} was changed by the author.
`;

describe('Vienna plugin integration', () => {
  let lsp: ChangedownLspClient;

  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(TEST_FILE, TRACKED_CONTENT);

    // Find the LSP server binary relative to packages/tests/
    const lspPath = resolve(import.meta.dirname, '../../lsp-server/dist/bin/server.js');
    lsp = await ChangedownLspClient.spawn(lspPath, TEST_DIR);
  }, 15_000); // LSP startup can take a few seconds

  afterAll(async () => {
    await lsp?.shutdown();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('renders review projection with all changes visible', () => {
    const result = renderProjection(TRACKED_CONTENT, 'review');
    expect(result.changes.length).toBeGreaterThanOrEqual(3);
    expect(result.html).toContain('cn-ins');
    expect(result.html).toContain('cn-del');
  });

  it('renders settled projection as clean text', () => {
    const result = renderProjection(TRACKED_CONTENT, 'settled');
    expect(result.html).toContain('a new section');
    expect(result.html).not.toContain('an old section');
    expect(result.html).toContain('updated text');
    expect(result.html).not.toContain('original text');
  });

  it('accepts a change via LSP and verifies edit application', async () => {
    lsp.didOpen(TEST_URI, TRACKED_CONTENT);

    // Wait a moment for LSP to process the document
    await new Promise(r => setTimeout(r, 500));

    // Find the insertion change from the projection
    const { changes } = renderProjection(TRACKED_CONTENT, 'review');
    const insertion = changes.find(c => c.kind.toLowerCase().includes('insert'));
    expect(insertion).toBeDefined();
    expect(insertion!.id).toBeTruthy();

    // Accept it via LSP (client translates 'accept' → 'approve')
    const result = await lsp.reviewChange(TEST_URI, insertion!.id, 'accept', { author: 'testuser' });
    expect(result.edits).toBeDefined();
    expect(Array.isArray(result.edits)).toBe(true);
    // The LSP should have produced edits (approve adds a footnote entry)
    expect(result.edits.length).toBeGreaterThan(0);

    // Apply edits to get updated document text
    const edited = applyTextEdits(TRACKED_CONTENT, result.edits);
    // The insertion's content must survive (approved, not removed)
    expect(edited).toContain('a new section');
    // After approve, the document is updated (footnote added with approved: line)
    // The markup `{++` is still present because auto_on_approve defaults to false
    expect(edited).toContain('{++a new section++}');

    // Write to disk and verify persistence
    await writeFile(TEST_FILE, edited);
    const onDisk = await readFile(TEST_FILE, 'utf8');
    expect(onDisk).toBe(edited);
  }, 10_000);

  it('rejects a change via LSP', async () => {
    // Re-read the file (it was modified by the previous test)
    const currentText = await readFile(TEST_FILE, 'utf8');
    lsp.didOpen(TEST_URI, currentText);
    await new Promise(r => setTimeout(r, 500));

    const { changes } = renderProjection(currentText, 'review');
    const deletion = changes.find(c => c.kind.toLowerCase().includes('delet'));

    if (deletion) {
      const result = await lsp.reviewChange(TEST_URI, deletion.id, 'reject', { author: 'testuser' });
      expect(result.edits).toBeDefined();
      expect(result.edits.length).toBeGreaterThan(0);

      const edited = applyTextEdits(currentText, result.edits);
      // After reject, the deletion markup `{--` is still present
      // (auto_on_reject defaults to false, so settlement doesn't auto-run)
      expect(edited).toContain('{--an old section--}');

      await writeFile(TEST_FILE, edited);
    }
  }, 10_000);
});
