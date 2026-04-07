// packages/core/src/host/document-state-manager.ts
import type { ChangeNode } from '../model/types.js';
import type { DocumentState } from './types.js';
import { EventEmitter } from './types.js';
import { transformRange, type OffsetContentChange } from './range-transform.js';
import { UriMap, type DocumentUri } from './uri.js';

const NOTIFY_CHANGES_DEBOUNCE_MS = 120;

export class DocumentStateManager {
  private states = new UriMap<DocumentState>();
  private pendingNotifyUris = new Set<string>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _onDidChangeChanges = new EventEmitter<string[]>();
  readonly onDidChangeChanges = this._onDidChangeChanges.event;

  ensureState(uri: string, text: string, version: number): DocumentState {
    const key = uri as DocumentUri;
    const existing = this.states.get(key);
    if (existing) return existing;

    const state: DocumentState = {
      uri,
      version,
      text,
      cachedChanges: [],
      cacheVersion: -1,
      format: 'L2',
    };
    this.states.set(key, state);
    return state;
  }

  getState(uri: string): DocumentState | undefined {
    return this.states.get(uri as DocumentUri);
  }

  removeState(uri: string): void {
    this.states.delete(uri as DocumentUri);
    this.pendingNotifyUris.delete(uri);
  }

  setCachedDecorations(uri: string, changes: ChangeNode[], version: number): boolean {
    const state = this.states.get(uri as DocumentUri);
    if (!state) return false;
    if (version < state.cacheVersion) return false;

    const prev = state.cachedChanges;
    state.cachedChanges = changes;
    state.cacheVersion = version;

    // Dedup: skip notify if change set is structurally identical.
    if (this.changesEqual(prev, changes)) return true;

    this.scheduleNotify(uri);
    return true;
  }

  private changesEqual(a: ChangeNode[], b: ChangeNode[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const ca = a[i], cb = b[i];
      if (ca.id !== cb.id) return false;
      if (ca.range.start !== cb.range.start) return false;
      if (ca.range.end !== cb.range.end) return false;
      if (ca.status !== cb.status) return false;
      if (ca.modifiedText !== cb.modifiedText) return false;
      if (ca.consumedBy !== cb.consumedBy) return false;
      if ((ca.replyCount ?? 0) !== (cb.replyCount ?? 0)) return false;
      if ((ca.metadata?.approvals?.length ?? 0) !== (cb.metadata?.approvals?.length ?? 0)) return false;
      if ((ca.metadata?.rejections?.length ?? 0) !== (cb.metadata?.rejections?.length ?? 0)) return false;
      if ((ca.metadata?.discussion?.length ?? 0) !== (cb.metadata?.discussion?.length ?? 0)) return false;
    }
    return true;
  }

  private scheduleNotify(uri: string): void {
    this.pendingNotifyUris.add(uri);
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      const uris = Array.from(this.pendingNotifyUris);
      this.pendingNotifyUris.clear();
      this._onDidChangeChanges.fire(uris);
    }, NOTIFY_CHANGES_DEBOUNCE_MS);
  }

  dispose(): void {
    if (this.notifyTimer !== null) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.pendingNotifyUris.clear();
    this._onDidChangeChanges.dispose();
  }

  getCachedDecorations(uri: string, currentVersion: number): ChangeNode[] | null {
    const state = this.states.get(uri as DocumentUri);
    if (!state) return null;
    if (state.cacheVersion < currentVersion) return null;
    return state.cachedChanges;
  }

  applyContentChange(
    uri: string,
    text: string,
    version: number,
    contentChanges: OffsetContentChange[],
  ): boolean {
    const state = this.states.get(uri as DocumentUri);
    if (!state) return false;

    const hadChanges = state.cachedChanges.length > 0;

    if (hadChanges) {
      for (const change of contentChanges) {
        const editStart = change.rangeOffset;
        const editEnd = change.rangeOffset + change.rangeLength;
        const delta = change.text.length - change.rangeLength;

        for (const node of state.cachedChanges) {
          transformRange(node.range, editStart, editEnd, delta);
          transformRange(node.contentRange, editStart, editEnd, delta);
          if (node.originalRange) {
            transformRange(node.originalRange, editStart, editEnd, delta);
          }
          if (node.modifiedRange) {
            transformRange(node.modifiedRange, editStart, editEnd, delta);
          }
        }
      }

      state.cachedChanges = state.cachedChanges.filter(
        n => n.range.end >= n.range.start && n.range.start >= 0,
      );
    }

    state.text = text;
    state.version = version;
    state.cacheVersion = version;
    return hadChanges;
  }

  invalidateCache(uri: string): void {
    const state = this.states.get(uri as DocumentUri);
    if (state) {
      state.cachedChanges = [];
      state.cacheVersion = -1;
    }
  }

  migrateState(oldUri: string, newUri: string): void {
    const state = this.states.get(oldUri as DocumentUri);
    if (state) {
      state.uri = newUri;
      this.states.set(newUri as DocumentUri, state);
      this.states.delete(oldUri as DocumentUri);
    }
  }

  /** Convenience: return cached changes for a URI, or empty array. */
  getChangesForUri(uri: string): ChangeNode[] {
    return this.states.get(uri as DocumentUri)?.cachedChanges ?? [];
  }
}
