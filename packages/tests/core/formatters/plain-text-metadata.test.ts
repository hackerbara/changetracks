import { describe, it, expect } from 'vitest';
import { formatMetadata } from '@changedown/core/internals';
import type { LineMetadata } from '@changedown/core/internals';

describe('formatMetadata bracket format', () => {
  it('emits full format with all fields', () => {
    const meta: LineMetadata[] = [{
      changeId: 'cn-1',
      author: 'alice',
      type: 'sub',
      status: 'proposed',
      reason: 'make it bigger',
      latestThreadTurn: { author: 'dave', text: 'counter-argument here' },
    }];
    expect(formatMetadata(meta)).toBe(
      '[cn-1 @alice sub proposed: "make it bigger" | @dave: counter-argument here]',
    );
  });

  it('omits author segment when missing', () => {
    const meta: LineMetadata[] = [{
      changeId: 'cn-1',
      type: 'ins',
      status: 'proposed',
    }];
    expect(formatMetadata(meta)).toBe('[cn-1 ins proposed]');
  });

  it('handles author value already containing @ prefix (no double-@)', () => {
    const meta: LineMetadata[] = [{
      changeId: 'cn-1',
      author: '@alice',
      type: 'ins',
      status: 'proposed',
      latestThreadTurn: { author: '@dave', text: 'hi' },
    }];
    expect(formatMetadata(meta)).toBe('[cn-1 @alice ins proposed | @dave: hi]');
  });

  it('omits type segment when missing', () => {
    const meta: LineMetadata[] = [{
      changeId: 'cn-1',
      author: 'alice',
      status: 'accepted',
    }];
    expect(formatMetadata(meta)).toBe('[cn-1 @alice accepted]');
  });

  it('omits reason when missing', () => {
    const meta: LineMetadata[] = [{
      changeId: 'cn-1',
      author: 'alice',
      type: 'del',
      status: 'proposed',
    }];
    expect(formatMetadata(meta)).toBe('[cn-1 @alice del proposed]');
  });

  it('omits latestThreadTurn when absent', () => {
    const meta: LineMetadata[] = [{
      changeId: 'cn-1',
      author: 'alice',
      type: 'ins',
      status: 'proposed',
      reason: 'add header',
    }];
    expect(formatMetadata(meta)).toBe('[cn-1 @alice ins proposed: "add header"]');
  });

  it('truncates thread turn at 60 code points with ellipsis', () => {
    const longText = 'a'.repeat(120);
    const meta: LineMetadata[] = [{
      changeId: 'cn-1',
      author: 'alice',
      type: 'ins',
      status: 'proposed',
      latestThreadTurn: { author: 'dave', text: longText },
    }];
    const result = formatMetadata(meta);
    expect(result).toContain('@dave: ' + 'a'.repeat(60) + '…');
    expect(result).not.toContain('a'.repeat(61));
  });

  it('truncates by code points, not bytes, for multi-byte chars', () => {
    const longText = '🌊'.repeat(80);
    const meta: LineMetadata[] = [{
      changeId: 'cn-1',
      author: 'alice',
      type: 'com',
      status: 'proposed',
      latestThreadTurn: { author: 'dave', text: longText },
    }];
    const result = formatMetadata(meta);
    expect(result).toBe('[cn-1 @alice com proposed | @dave: ' + '🌊'.repeat(60) + '…]');
  });

  it('joins multiple changes on one line with spaces', () => {
    const meta: LineMetadata[] = [
      { changeId: 'cn-1', author: 'alice', type: 'ins', status: 'proposed' },
      { changeId: 'cn-2', author: 'bob', type: 'del', status: 'accepted' },
    ];
    expect(formatMetadata(meta)).toBe(
      '[cn-1 @alice ins proposed] [cn-2 @bob del accepted]',
    );
  });

  it('returns empty string for empty metadata array', () => {
    expect(formatMetadata([])).toBe('');
  });
});
