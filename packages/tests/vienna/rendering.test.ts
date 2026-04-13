import { describe, it, expect } from 'vitest';
import { renderProjection } from '@changedown/vienna-plugin';

const TRACKED_DOC = `# Test Document

This has {++an insertion++} and {--a deletion--} in it.
`;

describe('renderProjection', () => {
  it('renders working mode with change HTML', () => {
    const result = renderProjection(TRACKED_DOC, 'working', 'dark');
    expect(result.html).toContain('cn-ins');
    expect(result.html).toContain('cn-del');
    expect(result.html).toContain('data-change-id');
    expect(result.css).toContain('.cn-ins');
    expect(result.changes.length).toBe(2);
  });

  it('renders final mode without change markup', () => {
    const result = renderProjection(TRACKED_DOC, 'final', 'dark');
    expect(result.html).not.toContain('cn-ins');
    expect(result.html).not.toContain('cn-del');
    expect(result.html).toContain('an insertion');
    expect(result.html).not.toContain('a deletion');
  });

  it('returns serialized changes with IDs and offsets', () => {
    const result = renderProjection(TRACKED_DOC, 'working', 'dark');
    for (const change of result.changes) {
      expect(change.id).toBeTruthy();
      expect(change.kind).toBeTruthy();
      expect(typeof change.sourceOffset).toBe('number');
    }
  });

  it('includes CSS for both themes', () => {
    const dark = renderProjection(TRACKED_DOC, 'working', 'dark');
    const light = renderProjection(TRACKED_DOC, 'working', 'light');
    expect(dark.css).not.toBe(light.css);
  });
});
