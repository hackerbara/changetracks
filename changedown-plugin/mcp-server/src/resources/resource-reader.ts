// changedown-plugin/mcp-server/src/resources/resource-reader.ts
import type { BackendRegistry } from '@changedown/core/backend';
import type { DocumentSnapshot } from '@changedown/core/backend';

export interface ReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
}

export class ResourceReader {
  constructor(
    private readonly registry: BackendRegistry,
    private readonly formatSnapshot?: (uri: string, snapshot: DocumentSnapshot) => Promise<string>,
  ) {}

  async read(uri: string): Promise<ReadResourceResult> {
    const backend = this.registry.resolve(uri);
    const ref = { uri };
    const snapshot = await backend.read(ref);
    const text = this.formatSnapshot
      ? await this.formatSnapshot(uri, snapshot)
      : snapshot.text;
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text,
      }],
    };
  }
}
