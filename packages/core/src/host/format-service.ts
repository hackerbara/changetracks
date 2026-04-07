import { EventEmitter, type Event, type Disposable, type FormatAdapter } from './types.js';
import { UriKeyedStore } from './uri-keyed-store.js';
import { isL3Format } from '../footnote-patterns.js';
import { normalizeUri } from './uri.js';

export interface FormatTransitionResult {
  readonly convertedText: string;
  readonly previousFormat: 'L2' | 'L3';
  readonly newFormat: 'L2' | 'L3';
}

export class FormatService implements Disposable {
  private readonly preferences = new UriKeyedStore<{ format: 'L2' | 'L3' }>();
  private readonly _onDidChangePreferredFormat = new EventEmitter<{ uri: string; format: 'L2' | 'L3' }>();
  private readonly _onDidCompleteTransition = new EventEmitter<{ uri: string; from: 'L2' | 'L3'; to: 'L2' | 'L3' }>();

  readonly onDidChangePreferredFormat: Event<{ uri: string; format: 'L2' | 'L3' }> = (listener) =>
    this._onDidChangePreferredFormat.event(listener);
  readonly onDidCompleteTransition: Event<{ uri: string; from: 'L2' | 'L3'; to: 'L2' | 'L3' }> = (listener) =>
    this._onDidCompleteTransition.event(listener);

  constructor(private readonly adapter: FormatAdapter) {}

  getDetectedFormat(_uri: string, text: string): 'L2' | 'L3' {
    return isL3Format(text) ? 'L3' : 'L2';
  }

  getPreferredFormat(uri: string): 'L2' | 'L3' | undefined {
    return this.preferences.get(normalizeUri(uri))?.format;
  }

  setPreferredFormat(uri: string, format: 'L2' | 'L3'): void {
    const normalized = normalizeUri(uri);
    this.preferences.set(normalized, { format });
    this._onDidChangePreferredFormat.fire({ uri: normalized, format });
  }

  async promoteToL3(uri: string, l2Text: string): Promise<FormatTransitionResult> {
    const normalized = normalizeUri(uri);
    const convertedText = await this.adapter.convertL2ToL3(normalized, l2Text);
    const result: FormatTransitionResult = { convertedText, previousFormat: 'L2', newFormat: 'L3' };
    this._onDidCompleteTransition.fire({ uri: normalized, from: 'L2', to: 'L3' });
    return result;
  }

  async demoteToL2(uri: string, l3Text: string): Promise<FormatTransitionResult> {
    const normalized = normalizeUri(uri);
    const convertedText = await this.adapter.convertL3ToL2(normalized, l3Text);
    const result: FormatTransitionResult = { convertedText, previousFormat: 'L3', newFormat: 'L2' };
    this._onDidCompleteTransition.fire({ uri: normalized, from: 'L3', to: 'L2' });
    return result;
  }

  remove(uri: string): void {
    this.preferences.delete(normalizeUri(uri));
  }

  dispose(): void {
    this.preferences.clear();
    this._onDidChangePreferredFormat.dispose();
    this._onDidCompleteTransition.dispose();
  }
}
