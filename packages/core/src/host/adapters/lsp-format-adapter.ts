import type { FormatAdapter, LspConnection } from '../types.js';
import type { L2Document, L3Document } from '../../model/document.js';
import { parseL2, parseL3, serializeL2, serializeL3 } from '../../operations/parse-document.js';

/**
 * LSP format adapter — proxies format conversion to the LSP server
 * via `changedown/convertFormat` request.
 *
 * Wire format: the LSP protocol is string-based. The adapter serializes the
 * input Document before sending and parses the response string back into a
 * typed Document before returning.
 */
export class LspFormatAdapter implements FormatAdapter {
  constructor(private readonly lsp: LspConnection) {}

  async promote(doc: L2Document): Promise<L3Document> {
    const l2Text = serializeL2(doc);
    const l3Text = await this.convert(l2Text, 'L3');
    return parseL3(l3Text);
  }

  async demote(doc: L3Document): Promise<L2Document> {
    const l3Text = serializeL3(doc);
    const l2Text = await this.convert(l3Text, 'L2');
    return parseL2(l2Text);
  }

  private async convert(text: string, targetFormat: 'L2' | 'L3'): Promise<string> {
    // The LSP request no longer needs a URI — the server is stateless for
    // conversion. Send a stable placeholder URI for compatibility with servers
    // that still require the field in the payload.
    const result = await this.lsp.sendRequest('changedown/convertFormat', {
      uri: 'inmemory://format-adapter',
      text,
      targetFormat,
    });
    return (result as { convertedText: string }).convertedText;
  }
}
