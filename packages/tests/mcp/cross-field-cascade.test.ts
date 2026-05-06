import { describe, it, expect } from 'vitest';
import { SessionState } from '@changedown/mcp/internals';

describe('resolveHash Stage 1 same-line cross-field fallback', () => {
  it('resolves via primary decided hash on decided view', () => {
    const state = new SessionState();
    state.recordAfterRead('/file.md', 'decided', [
      { line: 1, raw: 'r1', committed: 'c1', currentView: 'v1', rawLineNum: 1 },
      { line: 2, raw: 'r2', committed: 'c2', currentView: 'v2', rawLineNum: 2 },
    ], 'content');

    // Supplying the decided hash on a decided-view session should resolve at line 1
    const result = state.resolveHash('/file.md', 1, 'c1');
    expect(result?.match).toBe(true);
    if (result?.match) {
      expect(result.rawLineNum).toBe(1);
    }
  });

  it('does NOT cross-field scan in Stage 2', () => {
    const state = new SessionState();
    // Line 3 exists but its primary (committed) doesn't match 'ab'.
    // Lines 1 and 2 have 'ab' in non-primary fields (raw, currentView) — Stage 2 must not find them.
    // 'ab' does NOT appear in any line's committed field, so primary-only Stage 2 returns not-found.
    state.recordAfterRead('/file.md', 'decided', [
      { line: 1, raw: 'ab', committed: 'c1', currentView: 'v1', rawLineNum: 1 },
      { line: 2, raw: 'r2', committed: 'c2', currentView: 'ab', rawLineNum: 2 },
      { line: 3, raw: 'r3', committed: 'c3', currentView: 'v3', rawLineNum: 3 },
    ], 'content');

    const result = state.resolveHash('/file.md', 3, 'ab');
    // Stage 1: line 3's primary (committed=c3) != 'ab'. Same-line fallback: raw=r3, currentView=v3, neither matches. Fail.
    // Stage 2: content-addressed scan — primary-field-only — 'ab' is not any line's committed. Returns not-found.
    // Should NOT find the 'ab' values sitting in raw/currentView of other lines.
    expect(result?.match === false || result === undefined).toBe(true);
  });
});
