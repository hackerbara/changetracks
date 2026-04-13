import { describe, it, expect, beforeAll } from 'vitest';
import { initHashline, buildSimpleDocument, buildDecidedDocument, buildReviewDocument, buildRawDocument } from '@changedown/core/internals';

const FIXTURE = [
  'Hello {++world++}[^cn-1] and {--old--}[^cn-2]',
  '',
  '[^cn-1]: @alice | 2026-03-23 | ins | proposed',
  '[^cn-2]: @bob | 2026-03-23 | del | accepted',
].join('\n');

beforeAll(async () => { await initHashline(); });

const OPTIONS = {
  filePath: 'test.md',
  trackingStatus: 'tracked' as const,
  protocolMode: 'standard',
  defaultView: 'working' as const,
  viewPolicy: 'default',
};

describe('parse-once view builders', () => {
  it('simple view produces correct header counts', () => {
    const doc = buildSimpleDocument(FIXTURE, OPTIONS);
    expect(doc.header.counts).toEqual({ proposed: 1, accepted: 1, rejected: 0 });
    expect(doc.header.authors).toEqual(['@alice', '@bob']);
  });

  it('decided view produces correct header counts', () => {
    const doc = buildDecidedDocument(FIXTURE, OPTIONS);
    expect(doc.header.counts).toEqual({ proposed: 1, accepted: 1, rejected: 0 });
  });

  it('working view produces correct header and metadata', () => {
    const doc = buildReviewDocument(FIXTURE, OPTIONS);
    expect(doc.header.counts).toEqual({ proposed: 1, accepted: 1, rejected: 0 });
    expect(doc.lines.length).toBeGreaterThan(0);
  });

  it('raw view produces correct header', () => {
    const doc = buildRawDocument(FIXTURE, OPTIONS);
    expect(doc.header.counts).toEqual({ proposed: 1, accepted: 1, rejected: 0 });
  });
});
