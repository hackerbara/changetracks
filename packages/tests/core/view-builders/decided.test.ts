import { describe, it, expect, beforeAll } from 'vitest';
import { initHashline } from '@changedown/core';
import { buildDecidedDocument } from '@changedown/core/internals';

describe('buildDecidedDocument', () => {
  beforeAll(async () => {
    await initHashline();
  });

  const baseOpts = {
    filePath: 'test.md',
    trackingStatus: 'tracked' as const,
    protocolMode: 'compact',
    defaultView: 'working' as const,
    viewPolicy: 'suggest',
  };

  it('renders decided projection — accepted changes applied, proposals reverted', () => {
    const content = [
      'Hello {~~old~>new~~}[^cn-1] world',
      '',
      '[^cn-1]: @alice | 2026-02-17 | sub | accepted',
    ].join('\n');
    const doc = buildDecidedDocument(content, baseOpts);
    expect(doc.view).toBe('decided');
    expect(doc.lines[0].content[0].text).toContain('Hello new world');
  });

  it('uses committed hash as margin hash', () => {
    const content = 'Clean content\n';
    const doc = buildDecidedDocument(content, baseOpts);
    expect(doc.lines[0].margin.hash).toBe(doc.lines[0].sessionHashes!.committed);
  });

  it('emits A-only flags (no P)', () => {
    const content = [
      'Hello world{++!++}[^cn-1]',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | accepted',
    ].join('\n');
    const doc = buildDecidedDocument(content, baseOpts);
    expect(doc.lines[0].margin.flags).toContain('A');
    expect(doc.lines[0].margin.flags).not.toContain('P');
  });

  it('emits P flags for proposed changes reverted from the decided projection', () => {
    const content = [
      'Hello world{++!++}[^cn-1]',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
    ].join('\n');
    const doc = buildDecidedDocument(content, baseOpts);
    expect(doc.lines[0].margin.flags).toEqual(['P']);
  });

  it('produces no metadata zone (empty array per line)', () => {
    const content = [
      'Hello world{++!++}[^cn-1]',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | accepted',
    ].join('\n');
    const doc = buildDecidedDocument(content, baseOpts);
    expect(doc.lines[0].metadata).toEqual([]);
  });
});
