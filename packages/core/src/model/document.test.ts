import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { VirtualDocument, assertResolved } from './document.js';
import { UnresolvedChangesError, type Diagnostic } from './diagnostic.js';

describe('VirtualDocument diagnostics', () => {
  test('starts with no diagnostics', () => {
    const doc = new VirtualDocument();
    expect(doc.getDiagnostics()).toEqual([]);
  });

  test('addDiagnostic appends; getDiagnostics reflects the addition', () => {
    const doc = new VirtualDocument();
    const d: Diagnostic = { kind: 'coordinate_failed', changeId: 'cn-1', message: 'x' };
    doc.addDiagnostic(d);
    expect(doc.getDiagnostics()).toHaveLength(1);
    expect(doc.getDiagnostics()[0]).toEqual(d);
  });

  test('removeDiagnosticsForChange removes only entries for that changeId', () => {
    const doc = new VirtualDocument();
    doc.addDiagnostic({ kind: 'coordinate_failed', changeId: 'cn-1', message: 'a' });
    doc.addDiagnostic({ kind: 'anchor_missing',    changeId: 'cn-2', message: 'b' });
    doc.addDiagnostic({ kind: 'record_orphaned',   changeId: 'cn-1', message: 'c' });
    doc.removeDiagnosticsForChange('cn-1');
    expect(doc.getDiagnostics()).toHaveLength(1);
    expect(doc.getDiagnostics()[0]?.changeId).toBe('cn-2');
  });

  test('removeDiagnosticsForChange is a no-op for an unknown changeId', () => {
    const doc = new VirtualDocument();
    doc.addDiagnostic({ kind: 'coordinate_failed', changeId: 'cn-1', message: 'x' });
    doc.removeDiagnosticsForChange('cn-99');
    expect(doc.getDiagnostics()).toHaveLength(1);
  });

  test('removeDiagnosticsForChange leaves diagnostics with no changeId untouched', () => {
    const doc = new VirtualDocument();
    doc.addDiagnostic({ kind: 'structural_invalid', message: 'nested markup at line 81' });
    doc.addDiagnostic({ kind: 'coordinate_failed', changeId: 'cn-1', message: 'x' });
    doc.removeDiagnosticsForChange('cn-1');
    expect(doc.getDiagnostics()).toHaveLength(1);
    expect(doc.getDiagnostics()[0]?.kind).toBe('structural_invalid');
    expect(doc.getDiagnostics()[0]?.changeId).toBeUndefined();
  });
});

describe('assertResolved', () => {

  test('passes when document has no diagnostics', () => {
    const doc = new VirtualDocument();
    expect(() => assertResolved(doc)).not.toThrow();
  });

  test('throws UnresolvedChangesError when document has coordinate_failed diagnostic', () => {
    const doc = new VirtualDocument();
    doc.addDiagnostic({ kind: 'coordinate_failed', changeId: 'cn-1', message: 'not found' });
    expect(() => assertResolved(doc)).toThrow(UnresolvedChangesError);
  });

  test('throws when document has anchor_ambiguous, anchor_missing, or structural_invalid', () => {
    for (const kind of ['anchor_ambiguous', 'anchor_missing', 'structural_invalid'] as const) {
      const doc = new VirtualDocument();
      doc.addDiagnostic({ kind, changeId: 'cn-1', message: 'x' });
      expect(() => assertResolved(doc), `kind=${kind}`).toThrow(UnresolvedChangesError);
    }
  });

  test('passes when only non-blocking diagnostics present (record_orphaned, surface_orphaned)', () => {
    const doc = new VirtualDocument();
    doc.addDiagnostic({ kind: 'record_orphaned', changeId: 'cn-1', message: 'x' });
    doc.addDiagnostic({ kind: 'surface_orphaned', changeId: 'cn-2', message: 'y' });
    expect(() => assertResolved(doc)).not.toThrow();
  });

  test('respects allow option to whitelist a specific kind', () => {
    const doc = new VirtualDocument();
    doc.addDiagnostic({ kind: 'coordinate_failed', changeId: 'cn-1', message: 'x' });
    expect(() => assertResolved(doc, { allow: ['coordinate_failed'] })).not.toThrow();
  });

  test('UnresolvedChangesError carries the violations that triggered it', () => {
    const doc = new VirtualDocument();
    doc.addDiagnostic({ kind: 'coordinate_failed', changeId: 'cn-1', message: 'a' });
    doc.addDiagnostic({ kind: 'record_orphaned',   changeId: 'cn-2', message: 'b' });  // non-blocking; should NOT be in violations
    doc.addDiagnostic({ kind: 'anchor_missing',    changeId: 'cn-3', message: 'c' });
    try {
      assertResolved(doc);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnresolvedChangesError);
      const e = err as UnresolvedChangesError;
      expect(e.diagnostics).toHaveLength(2);
      expect(e.diagnostics.map(d => d.kind).sort()).toEqual(['anchor_missing', 'coordinate_failed'].sort());
    }
  });

});
