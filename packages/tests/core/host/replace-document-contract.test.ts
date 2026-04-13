import { describe, it, expect } from 'vitest';
import type { EditorHost, ApplyEditResult } from '@changedown/core/host';

describe('EditorHost.replaceDocument port contract', () => {
  it('accepts format-conversion metadata with from and to', () => {
    // Type-only test: confirm a class implementing replaceDocument with
    // discriminated-union metadata compiles.
    class FakeHost implements Pick<EditorHost, 'replaceDocument'> {
      async replaceDocument(
        _uri: string,
        _newText: string,
        _metadata: { reason: 'format-conversion'; from: 'L2' | 'L3'; to: 'L2' | 'L3' }
                 | { reason: 'external' },
      ): Promise<ApplyEditResult> {
        return { applied: true, text: _newText, version: 1 };
      }
    }
    const host = new FakeHost();
    expect(host).toBeDefined();
  });

  it('rejects non-format-conversion with from/to (discriminated union narrows)', () => {
    // Compile-time verification: the 'external' branch must not accept from/to.
    // @ts-expect-error — 'from' does not exist on { reason: 'external' }
    const _invalid: { reason: 'external' } = { reason: 'external', from: 'L2' };

    // Runtime: verify the 'external' variant narrows without from/to
    type Metadata =
      | { reason: 'format-conversion'; from: 'L2' | 'L3'; to: 'L2' | 'L3' }
      | { reason: 'external' };
    const valid: Metadata = { reason: 'external' };
    expect(valid.reason).toBe('external');
    // After narrowing, 'from' should not be accessible
    if (valid.reason === 'external') {
      expect('from' in valid).toBe(false);
    }
  });
});
