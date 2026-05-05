import { describe, it, expect } from 'vitest';
import { formatPlainText } from '@changedown/core/internals';
import type { ThreeZoneDocument } from '@changedown/core/internals';

function mkDecidedDoc(overrides: Partial<ThreeZoneDocument['header']['counts']> = {}, threadCount = 0): ThreeZoneDocument {
  return {
    view: 'decided',
    header: {
      filePath: 'test.md',
      trackingStatus: 'tracked',
      protocolMode: 'compact',
      defaultView: 'working',
      viewPolicy: 'suggest',
      counts: { proposed: 0, accepted: 0, rejected: 0, ...overrides },
      authors: [],
      threadCount,
    },
    lines: [
      {
        margin: { lineNumber: 1, hash: 'ab', flags: [] },
        content: [{ type: 'plain', text: 'hello' }],
        metadata: [],
        rawLineNumber: 1,
      },
    ],
  };
}

describe('decided view bottom status footer', () => {
  it('renders footer with non-zero counts', () => {
    const doc = mkDecidedDoc({ proposed: 3, accepted: 2 }, 1);
    const text = formatPlainText(doc);
    expect(text).toContain('── accepted 2 · rejected 0 · proposed 3 · threads 1 ──');
    expect(text.endsWith('── accepted 2 · rejected 0 · proposed 3 · threads 1 ──')).toBe(true);
  });

  it('omits footer entirely when all counts are zero', () => {
    const doc = mkDecidedDoc({}, 0);
    const text = formatPlainText(doc);
    expect(text).not.toContain('──');
  });

  it('renders footer when only threads count is non-zero', () => {
    const doc = mkDecidedDoc({}, 2);
    const text = formatPlainText(doc);
    expect(text).toContain('── accepted 0 · rejected 0 · proposed 0 · threads 2 ──');
  });

  it('does not render footer on working view', () => {
    const doc = mkDecidedDoc({ proposed: 3 }, 1);
    doc.view = 'working';
    const text = formatPlainText(doc);
    expect(text).not.toContain('──');
  });

  it('does not render footer on simple view', () => {
    const doc = mkDecidedDoc({ proposed: 3 }, 1);
    doc.view = 'simple';
    const text = formatPlainText(doc);
    expect(text).not.toContain('──');
  });

  it('does not render footer on raw view', () => {
    const doc = mkDecidedDoc({ proposed: 3 }, 1);
    doc.view = 'raw';
    const text = formatPlainText(doc);
    expect(text).not.toContain('──');
  });
});
