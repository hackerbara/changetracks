import { describe, it, expect, beforeAll } from 'vitest';
import {
  initHashline,
  buildViewDocument,
  formatPlainText,
  formatAnsi,
} from '@changedown/core';

const FIXTURE_CONTENT = [
  'Hello {++world++}[^cn-1].',
  '',
  '[^cn-1]: @ai:test | 2026-01-01 | ins | proposed',
  '    reason: greeting',
].join('\n');

const VIEW_OPTIONS = {
  filePath: 'test.md',
  trackingStatus: 'tracked' as const,
  protocolMode: 'classic',
  defaultView: 'working' as const,
  viewPolicy: 'suggest',
};

describe('unified renderer CLI integration', () => {
  beforeAll(async () => { await initHashline(); });

  it('working view output contains three-zone format', () => {
    const doc = buildViewDocument(FIXTURE_CONTENT, 'working', VIEW_OPTIONS);
    const output = formatPlainText(doc);

    expect(output).toContain('## proposed: 1 | accepted: 0 | rejected: 0');
    expect(output).toContain('---');

    // Hashline coordinates: LINE:HASH FLAG| content
    expect(output).toMatch(/\d+:[0-9a-f]{2}\s+\w?\|/);

    expect(output).toContain('[cn-1');
  });

  it('simple view output contains P/A flags and change IDs', () => {
    const doc = buildViewDocument(FIXTURE_CONTENT, 'simple', VIEW_OPTIONS);
    const output = formatPlainText(doc);

    // P flag for proposed change
    expect(output).toMatch(/P\|/);

    // Change ID in metadata (simple view: rich bracket format)
    expect(output).toContain('[cn-1');

    // Current projection text (insertion applied since simple uses current projection)
    expect(output).toContain('Hello world.');
  });

  it('decided view output contains clean text', () => {
    const doc = buildViewDocument(FIXTURE_CONTENT, 'decided', VIEW_OPTIONS);
    const output = formatPlainText(doc);

    // Decided projection: proposals reverted, only accepted changes applied.
    // The insertion is proposed (not accepted), so it is stripped.
    expect(output).toContain('Hello .');

    // No CriticMarkup in output
    expect(output).not.toContain('{++');
    expect(output).not.toContain('[^cn-1]');

    // No metadata zone
    expect(output).not.toContain('{>>');
  });

  it('raw view output contains literal file content', () => {
    const doc = buildViewDocument(FIXTURE_CONTENT, 'raw', VIEW_OPTIONS);
    const output = formatPlainText(doc);

    // Literal CriticMarkup preserved
    expect(output).toContain('{++world++}');
    expect(output).toContain('[^cn-1]');
  });

  it('ANSI formatter produces colored output without hashlines', () => {
    const doc = buildViewDocument(FIXTURE_CONTENT, 'working', VIEW_OPTIONS);
    const output = formatAnsi(doc);

    // ANSI escape codes present
    expect(output).toContain('\x1b[');

    // No hashline coordinates in ANSI output
    expect(output).not.toMatch(/^\d+:[0-9a-f]{2}/m);
  });

  it('ANSI formatter respects showMarkup option', () => {
    const doc = buildViewDocument(FIXTURE_CONTENT, 'working', VIEW_OPTIONS);
    const withMarkup = formatAnsi(doc, { showMarkup: true });
    const withoutMarkup = formatAnsi(doc, { showMarkup: false });

    // With showMarkup, delimiters are visible
    expect(withMarkup).toContain('{++');

    // Without showMarkup, delimiters are hidden (empty string for delimiters)
    expect(withoutMarkup).not.toContain('{++');
  });
});
