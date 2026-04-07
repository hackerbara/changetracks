import type { ChangeNode } from '../../model/types.js';
import { EventEmitter, type Disposable } from '../types.js';
import type { DocumentStateManager } from '../document-state-manager.js';

export class NavigationService implements Disposable {
  private lastChangeId: string | null = null;

  readonly onDidChangeCursorContext = new EventEmitter<{
    uri: string;
    change: ChangeNode | null;
  }>();

  constructor(private stateManager: DocumentStateManager) {}

  nextChange(uri: string, currentOffset: number, filter?: (c: ChangeNode) => boolean): ChangeNode | null {
    const changes = filter ? this.getChanges(uri).filter(filter) : this.getChanges(uri);
    for (const change of changes) {
      if (change.range.start > currentOffset) return change;
      if (change.range.start <= currentOffset && change.range.end > currentOffset) continue;
    }
    return null;
  }

  previousChange(uri: string, currentOffset: number, filter?: (c: ChangeNode) => boolean): ChangeNode | null {
    const changes = filter ? this.getChanges(uri).filter(filter) : this.getChanges(uri);
    // Find the last change whose start <= currentOffset.
    let idx = -1;
    for (let i = changes.length - 1; i >= 0; i--) {
      if (changes[i].range.start <= currentOffset) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return null;
    const change = changes[idx];
    // If the cursor is inside this change and there are later changes in the
    // array (i.e. this is not the rightmost change), skip it and return the
    // one before it. This matches the "skip change containing offset" semantic
    // while still returning the last change when the cursor is inside it and
    // nothing follows.
    if (change.range.end > currentOffset && idx < changes.length - 1) {
      return idx > 0 ? changes[idx - 1] : null;
    }
    return change;
  }

  getChangeAtOffset(uri: string, offset: number): ChangeNode | null {
    const changes = this.getChanges(uri);
    for (const change of changes) {
      if (offset >= change.range.start && offset < change.range.end) return change;
      if (change.range.start > offset) break;
    }
    return null;
  }

  updateCursorContext(uri: string, offset: number): void {
    const change = this.getChangeAtOffset(uri, offset);
    const changeId = change?.id ?? null;
    if (changeId !== this.lastChangeId) {
      this.lastChangeId = changeId;
      this.onDidChangeCursorContext.fire({ uri, change });
    }
  }

  private getChanges(uri: string): ChangeNode[] {
    return this.stateManager.getState(uri)?.cachedChanges ?? [];
  }

  dispose(): void {
    this.onDidChangeCursorContext.dispose();
  }
}
