import { describe, it, expect } from 'vitest';
import { buildDecorationPlan, NO_CURSOR } from '../../../src/host/decorations/plan-builder.js';
import type { View } from '../../../src/host/types.js';

describe('buildDecorationPlan NO_CURSOR sentinel', () => {
  const text = 'hello world';
  const insertionChange = {
    id: 'cn-1',
    type: 'Insertion' as any,
    status: 'Proposed' as any,
    range: { start: 6, end: 17 },
    contentRange: { start: 9, end: 14 },
  } as any;

  it('NO_CURSOR is -1', () => {
    expect(NO_CURSOR).toBe(-1);
  });

  it('buildDecorationPlan with NO_CURSOR does not emit active highlights', () => {
    const view: View = {
      name: 'working',
      projection: 'current',
      display: { delimiters: 'show', deletions: 'inline', highlights: 'inline', comments: 'inline-marker' },
    };
    const plan = buildDecorationPlan([insertionChange], text, view, NO_CURSOR);
    expect(plan.activeHighlights).toHaveLength(0);
  });

  it('buildDecorationPlan with cursor inside the change DOES emit active highlight', () => {
    const view: View = {
      name: 'working',
      projection: 'current',
      display: { delimiters: 'show', deletions: 'inline', highlights: 'inline', comments: 'inline-marker' },
    };
    const plan = buildDecorationPlan([insertionChange], text, view, 11);
    expect(plan.activeHighlights.length).toBeGreaterThan(0);
  });

  it('buildDecorationPlan with NO_CURSOR disables cursorRevealMode in simple view', () => {
    const viewWithCursorReveal: View = {
      name: 'custom',
      projection: 'current',
      display: {
        delimiters: 'show', deletions: 'hide', highlights: 'inline', comments: 'inline-marker', cursorReveal: true,
      },
    };
    const plan = buildDecorationPlan([insertionChange], text, viewWithCursorReveal, NO_CURSOR);
    expect(plan.unfoldedDelimiters).toHaveLength(0);
  });
});
