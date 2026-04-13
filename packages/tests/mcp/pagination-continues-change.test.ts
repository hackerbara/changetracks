import { describe, it, expect, beforeAll } from 'vitest';
import { initHashline } from '@changedown/core';
import { buildSimpleDocument, buildDecidedDocument } from '@changedown/core/internals';

describe('simple and decided continuesChange population', () => {
  beforeAll(async () => { await initHashline(); });

  const baseOpts = {
    filePath: 'test.md',
    trackingStatus: 'tracked' as const,
    protocolMode: 'compact',
    defaultView: 'working' as const,
    viewPolicy: 'suggest',
  };

  it('simple view marks continuation lines for multi-line insertions', () => {
    const content = 'Hello {++\nline1\nline2\n++} world';
    const doc = buildSimpleDocument(content, baseOpts);
    // Assert that at least one line has continuesChange set
    const anyContinuation = doc.lines.some(l => l.continuesChange === true);
    expect(anyContinuation).toBe(true);
  });

  it('decided view marks continuation lines for multi-line accepted changes', () => {
    const content = [
      'Hello {~~\nold\n~>\nnew\n~~}[^cn-1] world',
      '',
      '[^cn-1]: @alice | 2026-02-17 | sub | accepted',
    ].join('\n');
    const doc = buildDecidedDocument(content, baseOpts);
    const anyContinuation = doc.lines.some(l => l.continuesChange === true);
    expect(anyContinuation).toBe(true);
  });
});
