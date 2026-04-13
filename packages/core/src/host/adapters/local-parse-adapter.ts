import { parseForFormat } from '../../format-aware-parse.js';
import type { ParseAdapter, Format } from '../types.js';
import type { ChangeNode } from '../../model/types.js';

/**
 * Local parse adapter — calls core parseForFormat directly.
 * For standalone SDK mode (no LSP). LocalFormatAdapter (for conversion) ships alongside.
 */
export class LocalParseAdapter implements ParseAdapter {
  // parseForFormat auto-detects L2/L3 from text content, so the format hint is unused.
  parse(_uri: string, text: string, _format: Format): ChangeNode[] {
    return parseForFormat(text).getChanges();
  }
}
