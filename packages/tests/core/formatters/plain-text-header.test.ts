import { describe, it, expect } from 'vitest';
import { formatPlainText } from '@changedown/core/internals';
import type { ThreeZoneDocument } from '@changedown/core/internals';

function mkDoc(overrides: Partial<ThreeZoneDocument> = {}): ThreeZoneDocument {
  return {
    view: 'working',
    header: {
      filePath: 'test.md',
      trackingStatus: 'tracked',
      protocolMode: 'compact',
      defaultView: 'working',
      viewPolicy: 'suggest',
      counts: { proposed: 3, accepted: 2, rejected: 0 },
      authors: ['@alice', '@carol'],
      threadCount: 1,
    },
    lines: [],
    ...overrides,
  };
}

describe('formatHeader 2-line compact format', () => {
  it('emits 2 content lines + separator for working view', () => {
    const doc = mkDoc({ view: 'working' });
    const text = formatPlainText(doc);
    const headerLines = text.split('\n').slice(0, 4);

    expect(headerLines[0]).toBe('## proposed: 3 | accepted: 2 | rejected: 0 | threads: 1');
    expect(headerLines[1]).toBe('## authors: @alice, @carol');
    expect(headerLines[2]).toBe('---');
    expect(headerLines[3]).toBe('');
  });

  it('omits authors line when authors array is empty', () => {
    const doc = mkDoc({
      view: 'working',
      header: { ...mkDoc().header, authors: [] },
    });
    const text = formatPlainText(doc);
    const headerLines = text.split('\n').slice(0, 3);
    expect(headerLines[0]).toBe('## proposed: 3 | accepted: 2 | rejected: 0 | threads: 1');
    expect(headerLines[1]).toBe('---');
  });

  it('omits threads segment when threadCount is 0', () => {
    const doc = mkDoc({
      view: 'simple',
      header: { ...mkDoc().header, threadCount: 0 },
    });
    const text = formatPlainText(doc);
    expect(text.split('\n')[0]).toBe('## proposed: 3 | accepted: 2 | rejected: 0');
  });

  it('emits no top header for decided view', () => {
    const doc = mkDoc({ view: 'decided' });
    const text = formatPlainText(doc);
    expect(text.startsWith('##')).toBe(false);
  });

  it('emits no top header for raw view', () => {
    const doc = mkDoc({ view: 'raw' });
    const text = formatPlainText(doc);
    expect(text.startsWith('##')).toBe(false);
  });
});
