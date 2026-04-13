import { describe, it, expect } from 'vitest';
import type { FormatAdapter } from '@changedown/core/host';
import type { L2Document, L3Document } from '@changedown/core';

describe('FormatAdapter interface shape', () => {
  it('defines promote and demote taking typed Documents', () => {
    // Type-only test: confirm a class implementing the new interface compiles.
    class FakeAdapter implements FormatAdapter {
      async promote(doc: L2Document): Promise<L3Document> {
        return { format: 'L3', body: doc.text, footnotes: doc.footnotes };
      }
      async demote(doc: L3Document): Promise<L2Document> {
        return { format: 'L2', text: doc.body, footnotes: doc.footnotes };
      }
    }
    const adapter = new FakeAdapter();
    expect(adapter).toBeDefined();
  });
});
