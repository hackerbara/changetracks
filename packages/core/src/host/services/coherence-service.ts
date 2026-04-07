import { EventEmitter, type Event, type Disposable } from '../types.js';
import { UriKeyedStore } from '../uri-keyed-store.js';

export interface CoherenceState {
  rate: number;
  unresolvedCount: number;
  threshold: number;
}

export class CoherenceService extends UriKeyedStore<CoherenceState> implements Disposable {
  private readonly _onDidChangeCoherence = new EventEmitter<{
    uri: string; rate: number; unresolvedCount: number; threshold: number;
  }>();
  readonly onDidChangeCoherence: Event<{
    uri: string; rate: number; unresolvedCount: number; threshold: number;
  }> = this._onDidChangeCoherence.event;

  update(uri: string, rate: number, unresolvedCount: number, threshold: number): void {
    const prev = this.get(uri);
    if (prev && prev.rate === rate && prev.unresolvedCount === unresolvedCount && prev.threshold === threshold) return;
    this.set(uri, { rate, unresolvedCount, threshold });
    this._onDidChangeCoherence.fire({ uri, rate, unresolvedCount, threshold });
  }

  getCoherence(uri: string): CoherenceState | undefined {
    return this.get(uri);
  }

  remove(uri: string): void {
    this.delete(uri);
  }

  dispose(): void {
    this.clear();
    this._onDidChangeCoherence.dispose();
  }
}
