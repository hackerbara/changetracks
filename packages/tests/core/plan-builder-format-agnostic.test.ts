import { describe, it, expect } from 'vitest';
import { hideOrGhostDelimiters, createEmptyPlan, buildDecorationPlan, VIEW_PRESETS } from '@changedown/core/host';
import type { OffsetRange } from '@changedown/core/host';
import type { ChangeNode } from '@changedown/core';
import { ChangeType, ChangeStatus } from '@changedown/core';

describe('hideOrGhostDelimiters with hasInlineDelimiters parameter', () => {
  it('hides real delimiters when hasInlineDelimiters=true', () => {
    const plan = createEmptyPlan();
    const fullRange: OffsetRange = { start: 10, end: 25 };
    const contentRange: OffsetRange = { start: 13, end: 22 };  // inset by 3 chars
    hideOrGhostDelimiters(fullRange, contentRange, plan, true, false, '{++', '++}');
    expect(plan.hiddens.length).toBeGreaterThan(0);
    expect(plan.ghostDelimiters.length).toBe(0);
  });

  it('injects ghost delimiters when hasInlineDelimiters=false and showGhostDelimiters=true', () => {
    const plan = createEmptyPlan();
    const fullRange: OffsetRange = { start: 10, end: 20 };
    const contentRange: OffsetRange = { start: 10, end: 20 };  // equal — L3 shape
    hideOrGhostDelimiters(fullRange, contentRange, plan, false, true, '{++', '++}');
    expect(plan.ghostDelimiters.length).toBe(2);
    expect(plan.hiddens.length).toBe(0);
  });

  it('does nothing when hasInlineDelimiters=false and showGhostDelimiters=false', () => {
    const plan = createEmptyPlan();
    const fullRange: OffsetRange = { start: 10, end: 20 };
    const contentRange: OffsetRange = { start: 10, end: 20 };
    hideOrGhostDelimiters(fullRange, contentRange, plan, false, false, '{++', '++}');
    expect(plan.hiddens.length).toBe(0);
    expect(plan.ghostDelimiters.length).toBe(0);
  });
});

describe('buildDecorationPlan without format parameter', () => {
  it('accepts (changes, text, view, cursorOffset) — no format arg', () => {
    const changes: ChangeNode[] = [];
    const text = 'hello world';
    const view = VIEW_PRESETS.working;
    const cursorOffset = 0;
    const plan = buildDecorationPlan(changes, text, view, cursorOffset);
    expect(plan).toBeDefined();
    expect(plan.insertions).toEqual([]);
  });

  it('L2 inline insertion renders with hidden delimiters in working view', () => {
    const changes: ChangeNode[] = [{
      id: 'cn-1',
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: { start: 6, end: 17 },
      contentRange: { start: 9, end: 14 },
      level: 1,
      anchored: true,
      resolved: true,
      modifiedText: 'world',
    }];
    const text = 'hello {++world++}';
    const view = { ...VIEW_PRESETS.simple, display: { ...VIEW_PRESETS.simple.display, delimiters: 'hide' as const } };
    const plan = buildDecorationPlan(changes, text, view, 0);
    expect(plan.hiddens.length).toBeGreaterThan(0);
    expect(plan.insertions.length + Array.from(plan.authorDecorations.values()).reduce((s, e) => s + e.ranges.length, 0)).toBeGreaterThan(0);
  });

  it('L3 sidecar insertion renders with ghost delimiters when requested', () => {
    const changes: ChangeNode[] = [{
      id: 'cn-1',
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: { start: 6, end: 11 },
      contentRange: { start: 6, end: 11 },
      level: 2,
      anchored: true,
      resolved: true,
      modifiedText: 'world',
    }];
    const text = 'hello world';
    const view = { ...VIEW_PRESETS.working, display: { ...VIEW_PRESETS.working.display, delimiters: 'show' as const } };
    const plan = buildDecorationPlan(changes, text, view, 0);
    expect(plan.ghostDelimiters.length).toBeGreaterThan(0);
  });

  it('same logical change renders structurally equivalently across L2 and L3 shapes', () => {
    const l2Change: ChangeNode = {
      id: 'cn-1', type: ChangeType.Insertion, status: ChangeStatus.Proposed,
      range: { start: 6, end: 17 }, contentRange: { start: 9, end: 14 },
      level: 1, anchored: true, resolved: true, modifiedText: 'world',
    };
    const l3Change: ChangeNode = {
      id: 'cn-1', type: ChangeType.Insertion, status: ChangeStatus.Proposed,
      range: { start: 6, end: 11 }, contentRange: { start: 6, end: 11 },
      level: 2, anchored: true, resolved: true, modifiedText: 'world',
    };
    const l2Text = 'hello {++world++}';
    const l3Text = 'hello world';
    const view = VIEW_PRESETS.working;
    const l2Plan = buildDecorationPlan([l2Change], l2Text, view, 0);
    const l3Plan = buildDecorationPlan([l3Change], l3Text, view, 0);
    const l2InsertionCount = l2Plan.insertions.length + Array.from(l2Plan.authorDecorations.values()).reduce((s, e) => s + e.ranges.length, 0);
    const l3InsertionCount = l3Plan.insertions.length + Array.from(l3Plan.authorDecorations.values()).reduce((s, e) => s + e.ranges.length, 0);
    expect(l2InsertionCount).toBeGreaterThan(0);
    expect(l3InsertionCount).toBeGreaterThan(0);
  });
});

describe('buildDecorationPlan structural equivalence across formats', () => {
  function l2Insertion(bodyText: string, insertText: string, anchorOffset: number): { change: ChangeNode; text: string } {
    const before = bodyText.slice(0, anchorOffset);
    const after = bodyText.slice(anchorOffset);
    const text = `${before}{++${insertText}++}${after}`;
    const fullStart = anchorOffset;
    const fullEnd = anchorOffset + insertText.length + 6;
    const change: ChangeNode = {
      id: 'cn-1', type: ChangeType.Insertion, status: ChangeStatus.Proposed,
      range: { start: fullStart, end: fullEnd },
      contentRange: { start: fullStart + 3, end: fullEnd - 3 },
      level: 1, anchored: true, resolved: true, modifiedText: insertText,
    };
    return { change, text };
  }

  function l3Insertion(bodyText: string, insertText: string, anchorOffset: number): { change: ChangeNode; text: string } {
    const before = bodyText.slice(0, anchorOffset);
    const after = bodyText.slice(anchorOffset);
    const text = `${before}${insertText}${after}\n\n[^cn-1]: @alice | 2026-04-08 | ins | proposed\n    1:aa {++${insertText}++}\n`;
    const fullStart = anchorOffset;
    const fullEnd = anchorOffset + insertText.length;
    const change: ChangeNode = {
      id: 'cn-1', type: ChangeType.Insertion, status: ChangeStatus.Proposed,
      range: { start: fullStart, end: fullEnd },
      contentRange: { start: fullStart, end: fullEnd },
      level: 2, anchored: true, resolved: true, modifiedText: insertText,
    };
    return { change, text };
  }

  it('insertion: working view produces decoration in both shapes', () => {
    const l2 = l2Insertion('hello  world', 'quick ', 6);
    const l3 = l3Insertion('hello  world', 'quick ', 6);
    const view = VIEW_PRESETS.working;
    const l2Plan = buildDecorationPlan([l2.change], l2.text, view, 0);
    const l3Plan = buildDecorationPlan([l3.change], l3.text, view, 0);
    const l2Count = l2Plan.insertions.length + Array.from(l2Plan.authorDecorations.values()).reduce((s, e) => s + e.ranges.length, 0);
    const l3Count = l3Plan.insertions.length + Array.from(l3Plan.authorDecorations.values()).reduce((s, e) => s + e.ranges.length, 0);
    expect(l2Count).toBeGreaterThan(0);
    expect(l3Count).toBeGreaterThan(0);
  });

  it('insertion: working view with delimiters:show injects ghost delimiters for L3 only', () => {
    const l2 = l2Insertion('hello  world', 'quick ', 6);
    const l3 = l3Insertion('hello  world', 'quick ', 6);
    const view = { ...VIEW_PRESETS.working, display: { ...VIEW_PRESETS.working.display, delimiters: 'show' as const } };
    const l2Plan = buildDecorationPlan([l2.change], l2.text, view, 0);
    const l3Plan = buildDecorationPlan([l3.change], l3.text, view, 0);
    expect(l2Plan.ghostDelimiters.length).toBe(0);
    expect(l3Plan.ghostDelimiters.length).toBeGreaterThan(0);
  });

  it('insertion: simple view hides delimiters in both shapes without ghost injection', () => {
    const l2 = l2Insertion('hello  world', 'quick ', 6);
    const l3 = l3Insertion('hello  world', 'quick ', 6);
    const view = VIEW_PRESETS.simple;
    const l2Plan = buildDecorationPlan([l2.change], l2.text, view, 0);
    const l3Plan = buildDecorationPlan([l3.change], l3.text, view, 0);
    expect(l2Plan.hiddens.length).toBeGreaterThan(0);
    expect(l3Plan.hiddens.length).toBe(0);
    expect(l3Plan.ghostDelimiters.length).toBe(0);
  });

  it('insertion: L3 produces ghost ref, L2 with footnoteRefStart does not', () => {
    const l2 = l2Insertion('hello  world', 'quick ', 6);
    l2.change.footnoteRefStart = l2.change.range.end;
    const l3 = l3Insertion('hello  world', 'quick ', 6);
    const view = VIEW_PRESETS.working;
    const l2Plan = buildDecorationPlan([l2.change], l2.text, view, 0);
    const l3Plan = buildDecorationPlan([l3.change], l3.text, view, 0);
    expect(l2Plan.ghostRefs.length).toBe(0);
    expect(l3Plan.ghostRefs.length).toBe(1);
  });
});
