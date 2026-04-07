import { describe, it, expect } from 'vitest';
import { VIEW_MODE_VISIBILITY, DECORATION_STYLES, buildDecorationPlan, VIEW_PRESETS, type VisibilityRule } from '@changedown/core/host';
import { CriticMarkupParser } from '@changedown/core';
import { generateViewModeCSS } from '@changedown/preview';

describe('VIEW_MODE_VISIBILITY', () => {
  it('exports VIEW_MODE_VISIBILITY with all four view modes', () => {
    expect(VIEW_MODE_VISIBILITY).toHaveProperty('review');
    expect(VIEW_MODE_VISIBILITY).toHaveProperty('changes');
    expect(VIEW_MODE_VISIBILITY).toHaveProperty('settled');
    expect(VIEW_MODE_VISIBILITY).toHaveProperty('raw');
  });

  it('review mode has no overrides (all visible by default)', () => {
    expect(Object.keys(VIEW_MODE_VISIBILITY.review)).toHaveLength(0);
  });

  it('changes mode hides deletions, comments, and structural elements', () => {
    const c = VIEW_MODE_VISIBILITY.changes;
    expect(c.deletion).toBe('hidden');
    expect(c.substitutionOriginal).toBe('hidden');
    expect(c.moveFrom).toBe('hidden');
    expect(c.comment).toBe('hidden');
  });

  it('changes mode hides move labels, anchor meta, and footnote blocks', () => {
    const c = VIEW_MODE_VISIBILITY.changes;
    expect(c.moveLabel).toBe('hidden');
    expect(c.anchorMeta).toBe('hidden');
    expect(c.footnoteBlock).toBe('hidden');
  });

  it('changes mode uses plain rule for highlights (keeps text, removes styling)', () => {
    expect(VIEW_MODE_VISIBILITY.changes.highlight).toBe('plain');
  });

  it('every type ID in VIEW_MODE_VISIBILITY exists in DECORATION_STYLES', () => {
    for (const [_mode, overrides] of Object.entries(VIEW_MODE_VISIBILITY)) {
      for (const typeId of Object.keys(overrides)) {
        expect(DECORATION_STYLES).toHaveProperty(typeId,
          expect.anything(),
        );
      }
    }
  });

  it('only uses valid VisibilityRule values', () => {
    const valid: VisibilityRule[] = ['visible', 'hidden', 'dimmed', 'plain'];
    for (const [_mode, overrides] of Object.entries(VIEW_MODE_VISIBILITY)) {
      for (const rule of Object.values(overrides)) {
        expect(valid).toContain(rule);
      }
    }
  });
});

describe('Snapshot consistency: decoration plan ↔ preview CSS', () => {
  const text = 'Hello {++world++} and {--removed--} plus {~~old~>new~~}';
  const parser = new CriticMarkupParser();
  const changes = parser.parse(text).getChanges();
  // Cursor past end: offsetToLine guard puts it on lineStarts.length, never "on" any change line
  const cursorPastEnd = text.length + 1;

  it('changes mode: decoration plan omits deletions AND CSS hides .cn-del', () => {
    const plan = buildDecorationPlan(changes, text, VIEW_PRESETS.simple, 'L2', cursorPastEnd);
    // In changes mode with cursor off all lines, deletions are hidden (go to plan.hiddens, not plan.deletions)
    expect(plan.deletions).toHaveLength(0);

    // CSS should hide deletions in simple (changes) mode
    const css = generateViewModeCSS();
    expect(css).toContain('[data-view-name="simple"]');
    expect(css).toContain('.cn-del');
    expect(css).toContain('display: none');
  });

  it('review mode: decoration plan includes all change types AND CSS has no review overrides', () => {
    const plan = buildDecorationPlan(changes, text, VIEW_PRESETS.review, 'L2', cursorPastEnd);
    // In review mode, all change types (insertions, deletions, substitutionOriginals) are decorated
    expect(
      plan.deletions.length + plan.insertions.length + plan.substitutionOriginals.length
    ).toBeGreaterThan(0);

    // review mode has empty overrides, so generateViewModeCSS emits no [data-view-mode="review"] rules
    const css = generateViewModeCSS();
    expect(css).not.toContain('[data-view-mode="review"]');
  });
});
