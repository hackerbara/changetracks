// packages/tests/core/backend/registry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BackendRegistry } from '@changedown/core/backend';
import type { DocumentBackend, DocumentRef, DocumentSnapshot, BackendEvent, Unsubscribe } from '@changedown/core/backend';

function makeStubBackend(scheme: string): DocumentBackend {
  return {
    schemes: [scheme],
    read: vi.fn(async (_ref: DocumentRef): Promise<DocumentSnapshot> => ({
      text: 'stub',
      format: 'L2',
      version: '1',
    })),
    applyChange: vi.fn(async () => ({ applied: true })),
    listChanges: vi.fn(async () => []),
    subscribe: vi.fn((_ref: DocumentRef, _listener: (e: BackendEvent) => void): Unsubscribe => {
      return () => {};
    }),
  };
}

describe('BackendRegistry', () => {
  it('register() + resolve() returns the backend for its scheme', () => {
    const registry = new BackendRegistry();
    const backend = makeStubBackend('file');
    registry.register(backend);
    expect(registry.resolve('file:///foo.md')).toBe(backend);
  });

  it('resolve() throws BackendNotFoundError for unknown scheme', () => {
    const registry = new BackendRegistry();
    expect(() => registry.resolve('unknown://foo')).toThrow('BackendNotFoundError');
  });

  it('list() returns scheme + capability entries for all registered backends', () => {
    const registry = new BackendRegistry();
    registry.register(makeStubBackend('file'));
    registry.register(makeStubBackend('word'));
    const entries = registry.list();
    const schemes = entries.map((e) => e.scheme);
    expect(schemes).toContain('file');
    expect(schemes).toContain('word');
    expect(entries).toHaveLength(2);
  });

  it('re-registering same scheme replaces the prior backend', () => {
    const registry = new BackendRegistry();
    const first = makeStubBackend('file');
    const second = makeStubBackend('file');
    registry.register(first);
    registry.register(second);
    expect(registry.resolve('file:///any')).toBe(second);
  });

  it('onDidChange fires when a backend is registered', () => {
    const registry = new BackendRegistry();
    const listener = vi.fn();
    registry.onDidChange(listener);
    registry.register(makeStubBackend('file'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('onDidChange fires on replacement too', () => {
    const registry = new BackendRegistry();
    const listener = vi.fn();
    registry.register(makeStubBackend('file'));
    registry.onDidChange(listener);
    registry.register(makeStubBackend('file'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('onDidChange disposer stops future notifications', () => {
    const registry = new BackendRegistry();
    const listener = vi.fn();
    const dispose = registry.onDidChange(listener);
    registry.register(makeStubBackend('file'));
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    registry.register(makeStubBackend('word'));
    expect(listener).toHaveBeenCalledTimes(1); // not re-called after dispose
  });

  it('a listener throwing does not block other listeners', () => {
    const registry = new BackendRegistry();
    const throwing = vi.fn(() => { throw new Error('oops'); });
    const healthy = vi.fn();
    registry.onDidChange(throwing);
    registry.onDidChange(healthy);
    // Silence the expected console.error from the throwing listener for this test.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.register(makeStubBackend('file'));
    errSpy.mockRestore();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('list() returns empty array when no backends registered', () => {
    const registry = new BackendRegistry();
    expect(registry.list()).toEqual([]);
  });

  it('unregister removes the scheme and fires onDidChange', () => {
    const reg = new BackendRegistry();
    const backend = makeStubBackend('word');
    reg.register(backend);
    const spy = vi.fn();
    reg.onDidChange(spy);
    reg.unregister('word');
    expect(() => reg.resolve('word://sess-x')).toThrow('BackendNotFoundError');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('unregister is a no-op for an unregistered scheme', () => {
    const reg = new BackendRegistry();
    const spy = vi.fn();
    reg.onDidChange(spy);
    reg.unregister('word'); // nothing registered — must not throw
    expect(spy).not.toHaveBeenCalled();
  });
});
