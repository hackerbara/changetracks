import { describe, it, expect } from 'vitest';
import {
  VIEW_LABELS,
  isChangeVisibleInView,
  isTypeVisibleInView,
} from '@changedown/core/host';
import { VIEW_PRESETS } from '@changedown/core/host';
import { ChangeType, ChangeStatus } from '@changedown/core';
import type { ChangeNode } from '@changedown/core';

describe('VIEW_LABELS', () => {
  it('has an entry for every BuiltinView', () => {
    expect(VIEW_LABELS.working).toBe('Working');
    expect(VIEW_LABELS.simple).toBe('Simple');
    expect(VIEW_LABELS.decided).toBe('Decided');
    expect(VIEW_LABELS.original).toBe('Original');
    expect(VIEW_LABELS.raw).toBe('Raw');
  });
});

describe('isTypeVisibleInView', () => {
  it('working view shows all types', () => {
    const view = VIEW_PRESETS.working;
    expect(isTypeVisibleInView(ChangeType.Insertion, view)).toBe(true);
    expect(isTypeVisibleInView(ChangeType.Deletion, view)).toBe(true);
    expect(isTypeVisibleInView(ChangeType.Substitution, view)).toBe(true);
    expect(isTypeVisibleInView(ChangeType.Highlight, view)).toBe(true);
    expect(isTypeVisibleInView(ChangeType.Comment, view)).toBe(true);
  });

  it('simple view hides deletions and comments', () => {
    const view = VIEW_PRESETS.simple;
    expect(isTypeVisibleInView(ChangeType.Deletion, view)).toBe(false);
    expect(isTypeVisibleInView(ChangeType.Comment, view)).toBe(false);
    expect(isTypeVisibleInView(ChangeType.Insertion, view)).toBe(true);
  });
});

describe('isChangeVisibleInView', () => {
  function makeChange(overrides: Partial<ChangeNode>): ChangeNode {
    return {
      id: 'cn-1',
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: { start: 0, end: 5 },
      contentRange: { start: 0, end: 5 },
      level: 1,
      anchored: true,
      resolved: true,
      ...overrides,
    };
  }

  it('proposed changes visible in working view', () => {
    const change = makeChange({});
    expect(isChangeVisibleInView(change, VIEW_PRESETS.working)).toBe(true);
  });

  it('decided changes hidden when delimiters are hidden', () => {
    const change = makeChange({ decided: true });
    const view = { ...VIEW_PRESETS.working, display: { ...VIEW_PRESETS.working.display, delimiters: 'hide' as const } };
    expect(isChangeVisibleInView(change, view)).toBe(false);
  });

  it('accepted and rejected changes hidden in projected views', () => {
    const accepted = makeChange({ status: ChangeStatus.Accepted });
    const rejected = makeChange({ status: ChangeStatus.Rejected });
    expect(isChangeVisibleInView(accepted, VIEW_PRESETS.decided)).toBe(false);
    expect(isChangeVisibleInView(rejected, VIEW_PRESETS.decided)).toBe(false);
    expect(isChangeVisibleInView(accepted, VIEW_PRESETS.original)).toBe(false);
    expect(isChangeVisibleInView(rejected, VIEW_PRESETS.original)).toBe(false);
  });

  it('deletions hidden in simple view (type-visibility)', () => {
    const deletion = makeChange({ type: ChangeType.Deletion });
    expect(isChangeVisibleInView(deletion, VIEW_PRESETS.simple)).toBe(false);
  });
});
