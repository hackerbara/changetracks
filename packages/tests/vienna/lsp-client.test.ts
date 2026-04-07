import { describe, it, expect, vi } from 'vitest';
import { ChangedownLspClient } from '@changedown/vienna-plugin';

describe('ChangedownLspClient', () => {
  it('sends initialize on connect', async () => {
    const mockSend = vi.fn().mockResolvedValue({ capabilities: {} });
    const client = ChangedownLspClient.__createForTest(mockSend);
    await client.initialize('/tmp/test-vault');
    expect(mockSend).toHaveBeenCalledWith('initialize', expect.objectContaining({
      rootUri: 'file:///tmp/test-vault',
    }));
  });

  it('sends didOpen notification', () => {
    const mockSend = vi.fn().mockResolvedValue({});
    const mockNotify = vi.fn();
    const client = ChangedownLspClient.__createForTest(mockSend, mockNotify);
    client.didOpen('file:///test.md', '# Hello');
    expect(mockNotify).toHaveBeenCalledWith('textDocument/didOpen', {
      textDocument: { uri: 'file:///test.md', languageId: 'markdown', version: 1, text: '# Hello' },
    });
  });

  it('sends reviewChange request', async () => {
    const mockSend = vi.fn().mockResolvedValue({ edits: [] });
    const client = ChangedownLspClient.__createForTest(mockSend);
    const result = await client.reviewChange('file:///test.md', 'cn-1', 'accept');
    // Client translates 'accept' → 'approve' to match the LSP server's Decision enum.
    expect(mockSend).toHaveBeenCalledWith('changedown/reviewChange', {
      uri: 'file:///test.md', changeId: 'cn-1', decision: 'approve',
    });
    expect(result).toEqual({ edits: [] });
  });

  it('sends annotate request', async () => {
    const mockSend = vi.fn().mockResolvedValue({ edits: [] });
    const client = ChangedownLspClient.__createForTest(mockSend);
    await client.annotate('file:///test.md', 'cn-1', 'looks good');
    expect(mockSend).toHaveBeenCalledWith('changedown/annotate', {
      uri: 'file:///test.md', changeId: 'cn-1', text: 'looks good',
    });
  });

  it('increments version on repeated didOpen', () => {
    const mockNotify = vi.fn();
    const client = ChangedownLspClient.__createForTest(vi.fn().mockResolvedValue({}), mockNotify);
    client.didOpen('file:///test.md', 'v1');
    client.didOpen('file:///test.md', 'v2');
    expect(mockNotify).toHaveBeenCalledTimes(2);
    const firstCall = mockNotify.mock.calls[0][1];
    const secondCall = mockNotify.mock.calls[1][1];
    expect(firstCall.textDocument.version).toBe(1);
    expect(secondCall.textDocument.version).toBe(2);
  });
});
