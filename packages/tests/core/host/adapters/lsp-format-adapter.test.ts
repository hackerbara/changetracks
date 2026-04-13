import { describe, it, expect, vi } from 'vitest';
import { LspFormatAdapter } from '@changedown/core/host';
import { parseL2, parseL3 } from '@changedown/core';
import type { LspConnection } from '@changedown/core/host';

function makeMockConnection(response: { convertedText: string }): LspConnection {
  return {
    sendRequest: vi.fn(async () => response),
    sendNotification: vi.fn(),
    onNotification: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as LspConnection;
}

describe('LspFormatAdapter (typed)', () => {
  it('promote: serializes L2Document, parses L3 response', async () => {
    const l3ResponseText = [
      'Hello world.',
      '',
      '[^cn-1]: @ai:test | 2026-01-01 | ins | proposed',
      '    1:ab {++world',
      '',
    ].join('\n');
    const conn = makeMockConnection({ convertedText: l3ResponseText });
    const adapter = new LspFormatAdapter(conn);

    const l2Input = parseL2('Hello world.[^cn-1]\n\n[^cn-1]: @ai:test | 2026-01-01 | ins | proposed\n');
    const l3Output = await adapter.promote(l2Input);

    expect(conn.sendRequest).toHaveBeenCalledWith(
      'changedown/convertFormat',
      expect.objectContaining({ targetFormat: 'L3', text: expect.any(String) }),
    );
    expect(l3Output.format).toBe('L3');
    expect(l3Output.footnotes).toHaveLength(1);
    expect(l3Output.footnotes[0].id).toBe('cn-1');
  });

  it('demote: serializes L3Document, parses L2 response', async () => {
    const l2ResponseText = 'Hello world.[^cn-1]\n\n[^cn-1]: @ai:test | 2026-01-01 | ins | proposed\n';
    const conn = makeMockConnection({ convertedText: l2ResponseText });
    const adapter = new LspFormatAdapter(conn);

    const l3Input = parseL3([
      'Hello world.',
      '',
      '[^cn-1]: @ai:test | 2026-01-01 | ins | proposed',
      '    1:ab world',
      '',
    ].join('\n'));
    const l2Output = await adapter.demote(l3Input);

    expect(conn.sendRequest).toHaveBeenCalledWith(
      'changedown/convertFormat',
      expect.objectContaining({ targetFormat: 'L2' }),
    );
    expect(l2Output.format).toBe('L2');
  });
});
