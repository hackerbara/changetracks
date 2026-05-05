import { describe, test, expect } from 'vitest';
import { isGhostNode, type ChangeNode } from './types.js';

describe('isGhostNode after resolved-field migration', () => {
  test('returns true when resolved is false (regardless of level/anchored)', () => {
    const node = {
      anchored: true,
      resolved: false,
      level: 2,
    } as unknown as ChangeNode;
    expect(isGhostNode(node)).toBe(true);
  });

  test('returns false when resolved is true (default for L0/L1)', () => {
    const node = {
      anchored: false,
      resolved: true,
      level: 0,
    } as unknown as ChangeNode;
    expect(isGhostNode(node)).toBe(false);
  });

  test('returns false when resolved is undefined (cast for legacy/unknown nodes)', () => {
    const node = {
      anchored: true,
      // resolved omitted — only valid via explicit cast, never from the parser post-T4.5
      level: 2,
    } as unknown as ChangeNode;
    expect(isGhostNode(node)).toBe(false);
  });

  test('returns false when consumedBy is set even if resolved=false', () => {
    const node = {
      anchored: true,
      resolved: false,
      level: 2,
      consumedBy: 'cn-9',
    } as unknown as ChangeNode;
    expect(isGhostNode(node)).toBe(false);
  });
});
