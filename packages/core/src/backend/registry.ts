// packages/core/src/backend/registry.ts
import { parseUri } from './types.js';
import type { DocumentBackend, DocumentResourceDescriptor } from './types.js';

/** Entry returned by `BackendRegistry.list()`. */
export interface BackendEntry {
  /** URI scheme (e.g. "file", "word"). */
  scheme: string;
  /** The backend instance. */
  backend: DocumentBackend;
}

/**
 * BackendRegistry — scheme → backend map.
 *
 * Dispatch is scheme-only: `resolve("file:///foo.md")` finds the backend
 * registered for "file". No fallback; throws `BackendNotFoundError` for
 * unknown schemes.
 *
 * Consumers subscribe to `onDidChange` to react when a backend is added or
 * replaced (e.g. a Word pane connects after startup).
 *
 * Note: BackendRegistry deliberately hand-rolls its listener list rather
 * than reusing `EventEmitter<T>` from `@changedown/core/host`. Registry
 * change events fan out to consumers whose one misbehaving listener
 * should not block the rest, and `fireChange` catches per-listener
 * exceptions to enforce that invariant. The host `EventEmitter` does
 * not offer per-listener isolation; if it ever grows that guarantee,
 * migrate.
 */
export class BackendRegistry {
  private readonly backends = new Map<string, DocumentBackend>();
  private readonly changeListeners: Array<() => void> = [];

  /**
   * Register a backend for all schemes it declares.
   * If a scheme is already registered, the new backend replaces it and
   * `onDidChange` fires.
   */
  register(backend: DocumentBackend): void {
    for (const scheme of backend.schemes) {
      this.backends.set(scheme, backend);
    }
    this.fireChange();
  }

  /**
   * Resolve a URI to its backend. Throws with
   * "BackendNotFoundError: no backend for scheme '<scheme>'" when the scheme
   * is not registered.
   */
  resolve(uri: string): DocumentBackend {
    const { scheme } = parseUri(uri);
    const backend = this.backends.get(scheme);
    if (!backend) {
      throw new Error(`BackendNotFoundError: no backend for scheme '${scheme}'`);
    }
    return backend;
  }

  /**
   * Snapshot of all registered backends as `{scheme, backend}` pairs.
   * Used by diagnostics. See `listResources()` for the MCP-facing equivalent.
   */
  list(): BackendEntry[] {
    return Array.from(this.backends.entries()).map(([scheme, backend]) => ({
      scheme,
      backend,
    }));
  }

  /**
   * Aggregate `DocumentResourceDescriptor[]` from every registered backend.
   * Called by `ResourceLister` to build the `resources/list` response.
   *
   * Deduplicates by backend instance (not by scheme): when multiple scheme
   * keys map to the same backend object, `list()` is called only once.
   */
  listResources(): DocumentResourceDescriptor[] {
    const seen = new Set<DocumentBackend>();
    const result: DocumentResourceDescriptor[] = [];
    for (const backend of this.backends.values()) {
      if (seen.has(backend)) continue;
      seen.add(backend);
      result.push(...backend.list());
    }
    return result;
  }

  /**
   * Remove the backend registered for `scheme`. No-op if the scheme is not
   * registered. Fires `onDidChange` when a backend is actually removed.
   */
  unregister(scheme: string): void {
    if (this.backends.delete(scheme)) {
      this.fireChange();
    }
  }

  /**
   * Subscribe to change notifications. Fires whenever `register()` is called.
   * Returns a disposal function.
   */
  onDidChange(listener: () => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      const idx = this.changeListeners.indexOf(listener);
      if (idx !== -1) this.changeListeners.splice(idx, 1);
    };
  }

  private fireChange(): void {
    for (const l of this.changeListeners) {
      try {
        l();
      } catch (err) {
        console.error(
          '[BackendRegistry] change listener threw:',
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}
