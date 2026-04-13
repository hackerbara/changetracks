import { describe, it, expect, beforeAll } from 'vitest';
import { initHashline, parseForFormat } from '@changedown/core';
import { buildSimpleDocument } from '@changedown/core/internals';

describe('buildSimpleDocument', () => {
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

  it('renders clean current-projection text with no delimiters', () => {
    const content = 'Hello {++big ++}world\n';
    const doc = buildSimpleDocument(content, baseOpts);

    expect(doc.view).toBe('simple');
    expect(doc.lines[0].content[0].text).toBe('Hello big world');
    // No delimiter spans
    expect(doc.lines[0].content.some(s => s.type === 'delimiter')).toBe(false);
  });

  it('uses currentView hash as margin hash', () => {
    const content = 'Hello {++big ++}world\n';
    const doc = buildSimpleDocument(content, baseOpts);
    const sh = doc.lines[0].sessionHashes!;
    expect(doc.lines[0].margin.hash).toBe(sh.currentView);
  });

  it('populates EOL metadata with full fields', () => {
    const content = [
      'Hello {++big ++}[^cn-1] world',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
      '    @alice 2026-02-17: make it bigger',
    ].join('\n');
    const doc = buildSimpleDocument(content, baseOpts);
    const metadata = doc.lines[0].metadata;
    expect(metadata.length).toBe(1);
    expect(metadata[0]).toMatchObject({
      changeId: 'cn-1',
      type: 'ins',
      status: 'proposed',
      author: '@alice',
      reason: 'make it bigger',
    });
  });

  it('uses current-projection line numbering', () => {
    const content = 'A\nB\nC\n';
    const doc = buildSimpleDocument(content, baseOpts);
    expect(doc.lines[0].margin.lineNumber).toBe(1);
    expect(doc.lines[1].margin.lineNumber).toBe(2);
  });

  it('emits P flag on lines with proposed changes', () => {
    const content = [
      'Hello {++big ++}[^cn-1] world',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | proposed',
    ].join('\n');
    const doc = buildSimpleDocument(content, baseOpts);
    expect(doc.lines[0].margin.flags).toContain('P');
  });

  it('emits A flag on lines with accepted-only changes', () => {
    const content = [
      'Hello {++big ++}[^cn-1] world',
      '',
      '[^cn-1]: @alice | 2026-02-17 | ins | accepted',
    ].join('\n');
    const doc = buildSimpleDocument(content, baseOpts);
    expect(doc.lines[0].margin.flags).toContain('A');
    expect(doc.lines[0].margin.flags).not.toContain('P');
  });
});
