import type { FormatAdapter, LspConnection } from '../types.js';

/**
 * FormatAdapter v1: proxies format conversion to LSP server
 * via `changedown/convertFormat` request.
 *
 * Ships first to avoid double-implementation bugs.
 * LocalFormatAdapter (for standalone mode) ships later.
 */
export class LspFormatAdapter implements FormatAdapter {
  constructor(private readonly lsp: LspConnection) {}

  async convertL2ToL3(uri: string, l2Text: string): Promise<string> {
    return this.convert(uri, l2Text, 'L3');
  }

  async convertL3ToL2(uri: string, l3Text: string): Promise<string> {
    return this.convert(uri, l3Text, 'L2');
  }

  private async convert(uri: string, text: string, targetFormat: 'L2' | 'L3'): Promise<string> {
    const result = await this.lsp.sendRequest('changedown/convertFormat', {
      uri,
      text,
      targetFormat,
    });
    return (result as { convertedText: string }).convertedText;
  }
}
