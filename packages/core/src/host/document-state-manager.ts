// packages/core/src/host/document-state-manager.ts
import type { ChangeNode } from '../model/types.js';
import type { DocumentState } from './types.js';
import { transformRange, type OffsetContentChange } from './range-transform.js';

export class DocumentStateManager {
  private states = new Map<string, DocumentState>();

  ensureState(uri: string, text: string, version: number): DocumentState {
    const existing = this.states.get(uri);
    if (existing) return existing;

    const state: DocumentState = {
      uri,
      version,
      text,
      cachedChanges: [],
      cacheVersion: -1,
    };
    this.states.set(uri, state);
    return state;
  }

  getState(uri: string): DocumentState | undefined {
    return this.states.get(uri);
  }

  removeState(uri: string): void {
    this.states.delete(uri);
  }

  setCachedDecorations(uri: string, changes: ChangeNode[], version: number): boolean {
    const state = this.states.get(uri);
    if (!state) return false;
    if (version < state.cacheVersion) return false;
    state.cachedChanges = changes;
    state.cacheVersion = version;
    return true;
  }

  getCachedDecorations(uri: string, currentVersion: number): ChangeNode[] | null {
    const state = this.states.get(uri);
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
    const state = this.states.get(uri);
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
    const state = this.states.get(uri);
    if (state) {
      state.cachedChanges = [];
      state.cacheVersion = -1;
    }
  }

  migrateState(oldUri: string, newUri: string): void {
    const state = this.states.get(oldUri);
    if (state) {
      state.uri = newUri;
      this.states.set(newUri, state);
      this.states.delete(oldUri);
    }
  }
}
