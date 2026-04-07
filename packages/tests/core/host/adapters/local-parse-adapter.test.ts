// packages/tests/core/host/adapters/local-parse-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { LocalParseAdapter } from '@changedown/core/host';

describe('LocalParseAdapter', () => {
  const adapter = new LocalParseAdapter();

  it('parses L2 text and returns ChangeNode[]', () => {
    const text = 'Hello {++world++}.\n';
    const changes = adapter.parse('file:///test.md', text, 'L2');
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBeDefined();
  });

  it('parses L3 text with footnotes', () => {
    const text = 'Hello world.[^cn-1]\n\n[^cn-1]: @ai:test | 2026-01-01 | ins | proposed\n    {++world++}\n';
    const changes = adapter.parse('file:///test.md', text, 'L3');
    expect(changes.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for text with no changes', () => {
    const changes = adapter.parse('file:///test.md', 'No changes here.\n', 'L2');
    expect(changes).toEqual([]);
  });
});
