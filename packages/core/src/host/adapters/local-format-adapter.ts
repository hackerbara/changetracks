import { convertL2ToL3 } from '../../operations/l2-to-l3.js';
import { convertL3ToL2 } from '../../operations/l3-to-l2.js';
import { parseL2, parseL3, serializeL2, serializeL3 } from '../../operations/parse-document.js';
import type { FormatAdapter } from '../types.js';
import type { L2Document, L3Document } from '../../model/document.js';

/**
 * Local format adapter — calls core conversion functions directly.
 * For standalone SDK mode (no LSP). Both functions are async (WASM hashline init).
 *
 * Takes typed Documents and returns typed Documents. Internally:
 *  promote(l2) = parseL3(convertL2ToL3(serializeL2(l2)))
 *  demote(l3) = parseL2(convertL3ToL2(serializeL3(l3)))
 */
export class LocalFormatAdapter implements FormatAdapter {
  async promote(doc: L2Document): Promise<L3Document> {
    const l2Text = serializeL2(doc);
    const l3Text = await convertL2ToL3(l2Text);
    return parseL3(l3Text);
  }

  async demote(doc: L3Document): Promise<L2Document> {
    const l3Text = serializeL3(doc);
    const l2Text = await convertL3ToL2(l3Text);
    return parseL2(l2Text);
  }
}
