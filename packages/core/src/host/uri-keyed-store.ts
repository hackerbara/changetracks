import { normalizeUri, type DocumentUri } from './uri.js';

/**
 * Generic base class for per-URI keyed state stores.
 * Used by TrackingService, CoherenceService, and any future per-URI service.
 * Handles URI normalization, ensure-or-create, delete, clear, iteration.
 */
export class UriKeyedStore<T> {
  private readonly entries = new Map<DocumentUri, T>();

  ensure(uri: string, factory: () => T): T {
    const key = normalizeUri(uri);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = factory();
      this.entries.set(key, entry);
    }
    return entry;
  }

  get(uri: string): T | undefined {
    return this.entries.get(normalizeUri(uri));
  }

  has(uri: string): boolean {
    return this.entries.has(normalizeUri(uri));
  }

  set(uri: string, entry: T): void {
    this.entries.set(normalizeUri(uri), entry);
  }

  delete(uri: string): boolean {
    return this.entries.delete(normalizeUri(uri));
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  [Symbol.iterator](): IterableIterator<[DocumentUri, T]> {
    return this.entries[Symbol.iterator]();
  }
}
