import { convertL2ToL3 } from '../../operations/l2-to-l3.js';
import { convertL3ToL2 } from '../../operations/l3-to-l2.js';
import type { FormatAdapter } from '../types.js';

/**
 * Local format adapter — calls core conversion functions directly.
 * For standalone SDK mode (no LSP). Both functions are async (WASM hashline init).
 */
export class LocalFormatAdapter implements FormatAdapter {
  async convertL2ToL3(_uri: string, l2Text: string): Promise<string> {
    return convertL2ToL3(l2Text);
  }

  async convertL3ToL2(_uri: string, l3Text: string): Promise<string> {
    return convertL3ToL2(l3Text);
  }
}
