import { describe, it, expect, beforeAll } from 'vitest';
import { initHashline, buildSessionHashes, parseForFormat } from '@changedown/core/internals';

describe('buildSessionHashes', () => {
  beforeAll(async () => {
    await initHashline();
  });

  it('produces all three hash fields for every raw line of a clean file', () => {
    const content = 'Line one\nLine two\nLine three\n';
    const result = buildSessionHashes(content, []);

    expect(result.byRawLine.size).toBeGreaterThanOrEqual(3);
    for (const [, hashes] of result.byRawLine) {
      expect(hashes.raw).toMatch(/^[0-9a-f]{2}$/);
      expect(hashes.committed).toMatch(/^[0-9a-f]{2}$/);
      expect(hashes.currentView).toMatch(/^[0-9a-f]{2}$/);
    }
  });

  it('leaves committed undefined for pending-insertion lines dropped by decided projection', () => {
    const content = [
      'Hello world',
      '{++brand new line++}',
      'Line three',
    ].join('\n');
    const changes = parseForFormat(content).getChanges();

    const result = buildSessionHashes(content, changes);
    const line2 = result.byRawLine.get(2);
    expect(line2).toBeDefined();
    expect(line2!.raw).toMatch(/^[0-9a-f]{2}$/);
    expect(line2!.currentView).toMatch(/^[0-9a-f]{2}$/);
    expect(line2!.committed).toBeUndefined(); // decided drops it
  });

  it('produces raw↔decided and raw↔current line number mappings', () => {
    const content = 'Line one\nLine two\nLine three\n';
    const result = buildSessionHashes(content, []);

    expect(result.decidedLineByRaw.get(1)).toBe(1);
    expect(result.decidedLineByRaw.get(2)).toBe(2);
    expect(result.currentLineByRaw.get(1)).toBe(1);
    expect(result.rawLineByDecided.get(1)).toBe(1);
    expect(result.rawLineByCurrent.get(1)).toBe(1);
  });

  it('returns stable hashes when re-parsing the same content', () => {
    const content = 'Same content\nTwo lines\n';
    const result1 = buildSessionHashes(content, []);
    const result2 = buildSessionHashes(content, []);

    const l1a = result1.byRawLine.get(1)!;
    const l1b = result2.byRawLine.get(1)!;
    expect(l1a.raw).toBe(l1b.raw);
    expect(l1a.committed).toBe(l1b.committed);
    expect(l1a.currentView).toBe(l1b.currentView);
  });
});
