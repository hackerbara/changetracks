// packages/tests/engine/write-tracked-file.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeTrackedFile, writeTrackedFileSync } from '@changedown/cli/engine';
import { StructuralIntegrityError } from '@changedown/core';

// Nested CriticMarkup that triggers structural_invalid
const NESTED_MARKUP = '{~~a{~~b~>c~~}~>d~~}';
// Clean prose — passes validation
const CLEAN_PROSE = 'clean prose without markup';

describe('writeTrackedFile (async)', () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wtf-test-'));
    tmpFile = path.join(tmpDir, 'doc.md');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('writes valid content to disk', async () => {
    await writeTrackedFile(tmpFile, CLEAN_PROSE);
    const written = await fs.readFile(tmpFile, 'utf-8');
    expect(written).toBe(CLEAN_PROSE);
  });

  test('refuses to write content with nested markup; original file unchanged', async () => {
    // Write original content first
    await fs.writeFile(tmpFile, 'original', 'utf-8');

    await expect(writeTrackedFile(tmpFile, NESTED_MARKUP))
      .rejects.toThrow(StructuralIntegrityError);

    // Original file must be unchanged
    const still = await fs.readFile(tmpFile, 'utf-8');
    expect(still).toBe('original');
  });

  test('throws StructuralIntegrityError carrying violations', async () => {
    try {
      await writeTrackedFile(tmpFile, NESTED_MARKUP);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(StructuralIntegrityError);
      const e = err as StructuralIntegrityError;
      expect(e.violations.length).toBeGreaterThan(0);
      expect(e.violations.some(v => v.kind === 'structural_invalid')).toBe(true);
    }
  });

  test('StructuralIntegrityError.name is StructuralIntegrityError', async () => {
    try {
      await writeTrackedFile(tmpFile, NESTED_MARKUP);
    } catch (err) {
      expect((err as Error).name).toBe('StructuralIntegrityError');
    }
  });

  test('does not write the file at all when validation fails (file not created)', async () => {
    // tmpFile does not exist yet — validation failure must not create it
    await expect(writeTrackedFile(tmpFile, NESTED_MARKUP))
      .rejects.toThrow(StructuralIntegrityError);

    await expect(fs.access(tmpFile)).rejects.toThrow();
  });

  test('writes a doc with valid inline markup and footnote to disk', async () => {
    const text = [
      'The {++new ++}[^cn-1]prototype.',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | proposed',
    ].join('\n');
    await writeTrackedFile(tmpFile, text);
    expect(await fs.readFile(tmpFile, 'utf-8')).toBe(text);
  });

  test('orphaned inline ref triggers validation failure (record_orphaned)', async () => {
    const text = 'prose [^cn-1] more prose';
    await expect(writeTrackedFile(tmpFile, text))
      .rejects.toThrow(StructuralIntegrityError);
  });

  test('writes decided audit footnotes without inline surface refs (surface_orphaned)', async () => {
    const text = [
      'settled prose',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | rejected',
      '    superseded-by: cn-2',
    ].join('\n');
    await writeTrackedFile(tmpFile, text);
    expect(await fs.readFile(tmpFile, 'utf-8')).toBe(text);
  });
});

describe('writeTrackedFileSync', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wtf-sync-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('writes valid content synchronously', () => {
    const filePath = path.join(tmpDir, 'sync-doc.md');
    writeTrackedFileSync(filePath, CLEAN_PROSE);
    expect(readFileSync(filePath, 'utf-8')).toBe(CLEAN_PROSE);
  });

  test('refuses invalid content synchronously; original file unchanged', () => {
    const filePath = path.join(tmpDir, 'sync-doc.md');
    const originalContent = 'original sync content';
    // Write original first
    require('fs').writeFileSync(filePath, originalContent);

    expect(() => writeTrackedFileSync(filePath, NESTED_MARKUP))
      .toThrow(StructuralIntegrityError);

    // Original must be unchanged
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });

  test('throws StructuralIntegrityError with violations for nested markup', () => {
    const filePath = path.join(tmpDir, 'sync-doc-bad.md');
    try {
      writeTrackedFileSync(filePath, NESTED_MARKUP);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(StructuralIntegrityError);
      const e = err as StructuralIntegrityError;
      expect(e.violations.some(v => v.kind === 'structural_invalid')).toBe(true);
    }
  });

  test('does not create file when validation fails', () => {
    const filePath = path.join(tmpDir, 'never-created.md');
    expect(() => writeTrackedFileSync(filePath, NESTED_MARKUP))
      .toThrow(StructuralIntegrityError);
    expect(() => readFileSync(filePath, 'utf-8')).toThrow();
  });

  test('writes decided audit footnotes without inline surface refs (surface_orphaned)', () => {
    const filePath = path.join(tmpDir, 'sync-surface-orphan.md');
    const text = [
      'settled prose',
      '',
      '[^cn-1]: @alice | 2026-03-16 | ins | accepted',
      '    accepted: done',
    ].join('\n');
    writeTrackedFileSync(filePath, text);
    expect(readFileSync(filePath, 'utf-8')).toBe(text);
  });
});
