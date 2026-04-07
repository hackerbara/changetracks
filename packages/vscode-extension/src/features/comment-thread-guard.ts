import {
  EventEmitter,
  type Event, type Disposable,
} from '@changedown/core/host';

/**
 * Gates VsCodeEditorHost content-change event emission while a VS Code
 * comment thread is expanded. Prevents edits made inside comment widgets
 * from being tracked as user edits on the document.
 *
 * Consumers call setActive() as threads expand/collapse (programmatically,
 * from change-comments.ts). VS Code's comment API does not emit events for
 * manual UI expansion — this is a best-effort heuristic.
 *
 * VsCodeEditorHost reads isActive() before emitting onDidChangeContent.
 * When guard deactivates, fires onDidDeactivate so host can full-doc resync.
 */
export class CommentThreadGuard implements Disposable {
  private active = false;
  private readonly _onDidDeactivate = new EventEmitter<void>();
  readonly onDidDeactivate: Event<void> = this._onDidDeactivate.event;

  setActive(isActive: boolean): void {
    const wasActive = this.active;
    this.active = isActive;
    if (wasActive && !isActive) {
      this._onDidDeactivate.fire();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this._onDidDeactivate.dispose();
  }
}
