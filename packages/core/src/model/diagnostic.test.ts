import { describe, test, expect } from 'vitest';
import {
  UnresolvedChangesError,
  StructuralIntegrityError,
  type Diagnostic,
  type DiagnosticKind,
} from './diagnostic.js';

describe('diagnostic types', () => {
  test('UnresolvedChangesError carries diagnostics array', () => {
    const diags: Diagnostic[] = [
      { kind: 'coordinate_failed', changeId: 'cn-1', message: 'not found' },
    ];
    const err = new UnresolvedChangesError(diags);
    expect(err.name).toBe('UnresolvedChangesError');
    expect(err.diagnostics).toEqual(diags);
    expect(err.message).toContain('1 unresolved');
  });

  test('StructuralIntegrityError carries violations array', () => {
    const v: Diagnostic[] = [{ kind: 'structural_invalid', message: 'nested' }];
    const err = new StructuralIntegrityError(v);
    expect(err.name).toBe('StructuralIntegrityError');
    expect(err.violations).toEqual(v);
    expect(err.message).toContain('structural_invalid');
  });

  test('DiagnosticKind union covers exactly the six taxonomy members (compile-time)', () => {
    // satisfies enforces both directions at compile time:
    //   - every union member appears in the tuple (excess)
    //   - every tuple member is a valid DiagnosticKind (missing)
    // If either fails, this file fails to type-check.
    const all = [
      'coordinate_failed',
      'anchor_ambiguous',
      'anchor_missing',
      'record_orphaned',
      'surface_orphaned',
      'structural_invalid',
    ] as const satisfies readonly DiagnosticKind[];

    // Runtime sanity that the tuple isn't accidentally truncated.
    expect(all).toHaveLength(6);

    // Exhaustiveness witness: a switch over the union with `never` default.
    // If a new kind is added without updating this test, the assignment to
    // `_exhaustive` becomes a type error.
    function check(k: DiagnosticKind): string {
      switch (k) {
        case 'coordinate_failed': return 'cf';
        case 'anchor_ambiguous': return 'aa';
        case 'anchor_missing': return 'am';
        case 'record_orphaned': return 'ro';
        case 'surface_orphaned': return 'so';
        case 'structural_invalid': return 'si';
        default: {
          const _exhaustive: never = k;
          return _exhaustive;
        }
      }
    }
    for (const k of all) expect(check(k)).toMatch(/^[a-z]{2}$/);
  });
});
