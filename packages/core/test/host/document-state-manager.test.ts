import { describe, it, expect } from 'vitest';
import { DocumentStateManager } from '../../src/host/document-state-manager.js';

describe('DocumentStateManager.getAllUris', () => {
  it('returns empty array when no state', () => {
    const mgr = new DocumentStateManager();
    expect(mgr.getAllUris()).toEqual([]);
  });

  it('returns a snapshot of all URIs with state', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'a', 1);
    mgr.ensureState('file:///b.md', 'b', 1);
    const uris = mgr.getAllUris();
    expect(uris).toHaveLength(2);
    expect(uris).toContain('file:///a.md');
    expect(uris).toContain('file:///b.md');
  });

  it('snapshot is not a live view — closing a URI after capture does not mutate the returned array', () => {
    const mgr = new DocumentStateManager();
    mgr.ensureState('file:///a.md', 'a', 1);
    mgr.ensureState('file:///b.md', 'b', 1);
    const uris = mgr.getAllUris();
    mgr.removeState('file:///a.md');
    expect(uris).toHaveLength(2);
    expect(uris).toContain('file:///a.md');
  });
});
