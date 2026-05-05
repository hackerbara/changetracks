import { describe, it, expect } from 'vitest';
import { formatPlainText, ThreeZoneDocument } from '@changedown/core/internals';

describe('formatPlainText', () => {
  const baseHeader = {
    filePath: 'test.md',
    trackingStatus: 'tracked' as const,
    protocolMode: 'classic',
    defaultView: 'working' as const,
    viewPolicy: 'suggest',
    counts: { proposed: 1, accepted: 0, rejected: 0 },
    authors: ['@alice'],
    threadCount: 0,
  };

  it('formats working view with hashline margin + bracket metadata', () => {
    const doc: ThreeZoneDocument = {
      view: 'working',
      header: baseHeader,
      lines: [{
        margin: { lineNumber: 1, hash: 'a3', flags: ['P'] },
        content: [
          { type: 'plain', text: 'Use ' },
          { type: 'delimiter', text: '{~~' },
          { type: 'sub_old', text: 'REST' },
          { type: 'sub_arrow', text: '~>' },
          { type: 'sub_new', text: 'GraphQL' },
          { type: 'delimiter', text: '~~}' },
          { type: 'anchor', text: '[^cn-1]' },
          { type: 'plain', text: '.' },
        ],
        metadata: [{ changeId: 'cn-1', author: 'alice', reason: 'paradigm', status: 'proposed' }],
        rawLineNumber: 1,
      }],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('1:a3 P|');
    expect(output).toContain('{~~REST~>GraphQL~~}');
    expect(output).toContain('[^cn-1]');
    expect(output).toContain('[cn-1 @alice proposed: "paradigm"]');
  });

  it('formats simple view with committed text + rich metadata bracket format', () => {
    const doc: ThreeZoneDocument = {
      view: 'simple',
      header: baseHeader,
      lines: [{
        margin: { lineNumber: 1, hash: 'a3', flags: ['P'] },
        content: [{ type: 'plain', text: 'Use REST.' }],
        metadata: [{ changeId: 'cn-1', author: 'alice', type: 'ins', status: 'proposed', reason: 'initial wording' }],
        rawLineNumber: 1,
      }],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('1:a3 P|');
    expect(output).toContain('Use REST.');
    expect(output).toContain('[cn-1 @alice ins proposed: "initial wording"]');
  });

  it('simple view: insertion with 2+ turn discussion includes | @author: turn segment', () => {
    const doc: ThreeZoneDocument = {
      view: 'simple',
      header: baseHeader,
      lines: [{
        margin: { lineNumber: 1, hash: 'a3', flags: ['P'] },
        content: [{ type: 'plain', text: 'Make it bigger.' }],
        metadata: [{
          changeId: 'cn-1',
          author: 'alice',
          type: 'ins',
          status: 'proposed',
          reason: 'make it bigger',
          latestThreadTurn: { author: 'dave', text: 'actually, keep it small' },
        }],
        rawLineNumber: 1,
      }],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('[cn-1 @alice ins proposed: "make it bigger" | @dave: actually, keep it small]');
  });

  it('simple view: accepted substitution with reason, no thread turn', () => {
    const doc: ThreeZoneDocument = {
      view: 'simple',
      header: baseHeader,
      lines: [{
        margin: { lineNumber: 1, hash: 'b2', flags: ['A'] },
        content: [{ type: 'plain', text: 'GraphQL is better.' }],
        metadata: [{
          changeId: 'cn-2',
          author: 'bob',
          type: 'sub',
          status: 'accepted',
          reason: 'cleaner API',
        }],
        rawLineNumber: 1,
      }],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('[cn-2 @bob sub accepted: "cleaner API"]');
    expect(output).not.toContain('"cleaner API" |');
  });

  it('simple view: change without reason omits colon-reason segment', () => {
    const doc: ThreeZoneDocument = {
      view: 'simple',
      header: baseHeader,
      lines: [{
        margin: { lineNumber: 1, hash: 'c5', flags: ['P'] },
        content: [{ type: 'plain', text: 'Some text.' }],
        metadata: [{
          changeId: 'cn-3',
          author: 'alice',
          type: 'del',
          status: 'proposed',
        }],
        rawLineNumber: 1,
      }],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('[cn-3 @alice del proposed]');
    expect(output).not.toContain('[cn-3 @alice del proposed:');
  });

  it('formats decided view with clean text and no metadata', () => {
    const doc: ThreeZoneDocument = {
      view: 'decided',
      header: baseHeader,
      lines: [{
        margin: { lineNumber: 1, hash: 'a3', flags: [] },
        content: [{ type: 'plain', text: 'Use GraphQL.' }],
        metadata: [],
        rawLineNumber: 1,
      }],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('1:a3  |');
    expect(output).toContain('Use GraphQL.');
    expect(output).not.toContain('{>>');
  });

  it('formats header with status counts and authors', () => {
    const doc: ThreeZoneDocument = {
      view: 'working',
      header: { ...baseHeader, counts: { proposed: 2, accepted: 1, rejected: 0 }, authors: ['@alice', '@bob'] },
      lines: [],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('proposed: 2');
    expect(output).toContain('accepted: 1');
    expect(output).toContain('@alice');
  });

  it('formats multiple metadata entries on one line', () => {
    const doc: ThreeZoneDocument = {
      view: 'working',
      header: baseHeader,
      lines: [{
        margin: { lineNumber: 1, hash: 'b7', flags: ['P'] },
        content: [
          { type: 'plain', text: 'Hello ' },
          { type: 'delimiter', text: '{++' },
          { type: 'insertion', text: 'world' },
          { type: 'delimiter', text: '++}' },
          { type: 'anchor', text: '[^cn-1]' },
          { type: 'plain', text: ' ' },
          { type: 'delimiter', text: '{--' },
          { type: 'deletion', text: 'old' },
          { type: 'delimiter', text: '--}' },
          { type: 'anchor', text: '[^cn-2]' },
        ],
        metadata: [
          { changeId: 'cn-1', author: 'alice', reason: 'add greeting', status: 'proposed' },
          { changeId: 'cn-2', author: 'bob', reason: 'remove cruft', status: 'proposed' },
        ],
        rawLineNumber: 1,
      }],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('[cn-1 @alice proposed: "add greeting"]');
    expect(output).toContain('[cn-2 @bob proposed: "remove cruft"]');
  });

  it('includes thread count in header when nonzero', () => {
    const doc: ThreeZoneDocument = {
      view: 'working',
      header: { ...baseHeader, threadCount: 5 },
      lines: [],
    };
    const output = formatPlainText(doc);
    expect(output).toContain('threads: 5');
  });

  it('pads line numbers for multi-digit documents', () => {
    const doc: ThreeZoneDocument = {
      view: 'decided',
      header: baseHeader,
      lines: [
        {
          margin: { lineNumber: 1, hash: 'aa', flags: [] },
          content: [{ type: 'plain', text: 'First.' }],
          metadata: [],
          rawLineNumber: 1,
        },
        {
          margin: { lineNumber: 100, hash: 'bb', flags: [] },
          content: [{ type: 'plain', text: 'Last.' }],
          metadata: [],
          rawLineNumber: 100,
        },
      ],
    };
    const output = formatPlainText(doc);
    // Line 1 should be padded to 3 digits to match line 100
    expect(output).toContain('  1:aa  |');
    expect(output).toContain('100:bb  |');
  });

  it('handles empty document with no lines', () => {
    const doc: ThreeZoneDocument = {
      view: 'working',
      header: baseHeader,
      lines: [],
    };
    const output = formatPlainText(doc);
    // Should have header with counts and separator
    expect(output).toContain('proposed: 1');
    expect(output).toContain('---');
  });

});
