// packages/core/src/host/decoration-scheduler.ts
import type { Disposable } from './types.js';

export class DecorationScheduler implements Disposable {
  static readonly DEBOUNCE_MS = 50;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private performUpdate: (uri: string) => void) {}

  schedule(uri: string): void {
    const existing = this.timers.get(uri);
    if (existing !== undefined) clearTimeout(existing);
    this.timers.set(uri, setTimeout(() => {
      this.timers.delete(uri);
      this.performUpdate(uri);
    }, DecorationScheduler.DEBOUNCE_MS));
  }

  updateNow(uri: string): void {
    const existing = this.timers.get(uri);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.timers.delete(uri);
    }
    this.performUpdate(uri);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
