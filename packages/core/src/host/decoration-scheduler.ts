// packages/core/src/host/decoration-scheduler.ts
import type { Disposable } from './types.js';
import { UriMap, type DocumentUri } from './uri.js';

export class DecorationScheduler implements Disposable {
  static readonly DEBOUNCE_MS = 50;
  private timers = new UriMap<ReturnType<typeof setTimeout>>();

  constructor(private performUpdate: (uri: string) => void) {}

  schedule(uri: string): void {
    const key = uri as DocumentUri;
    const existing = this.timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      this.performUpdate(uri);
    }, DecorationScheduler.DEBOUNCE_MS));
  }

  updateNow(uri: string): void {
    const key = uri as DocumentUri;
    const existing = this.timers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
    this.performUpdate(uri);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
