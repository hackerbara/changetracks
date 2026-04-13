import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FormatService } from '@changedown/core/host';
import type { FormatAdapter } from '@changedown/core/host';
import type { L2Document, L3Document } from '@changedown/core/host';

function mockAdapter(): FormatAdapter {
  return {
    promote: vi.fn(async (doc: L2Document): Promise<L3Document> => ({
      format: 'L3',
      body: doc.text,
      footnotes: doc.footnotes,
    })),
    demote: vi.fn(async (doc: L3Document): Promise<L2Document> => ({
      format: 'L2',
      text: doc.body,
      footnotes: doc.footnotes,
    })),
  };
}

describe('FormatService', () => {
  let service: FormatService;
  let adapter: FormatAdapter;

  beforeEach(() => {
    adapter = mockAdapter();
    service = new FormatService(adapter);
  });

  it('detects L2 format for plain text', () => {
    expect(service.getDetectedFormat('file:///a.md', 'hello world')).toBe('L2');
  });

  it('stores and retrieves per-URI format preference', () => {
    service.setPreferredFormat('file:///a.md', 'L3');
    expect(service.getPreferredFormat('file:///a.md')).toBe('L3');
  });

  it('returns undefined for unset preference', () => {
    expect(service.getPreferredFormat('file:///a.md')).toBeUndefined();
  });

  it('fires onDidChangePreferredFormat when preference set', () => {
    const handler = vi.fn();
    service.onDidChangePreferredFormat(handler);
    service.setPreferredFormat('file:///a.md', 'L3');
    expect(handler).toHaveBeenCalledWith({ uri: 'file:///a.md', format: 'L3' });
  });

  it('promote delegates to adapter', async () => {
    const l2Doc: L2Document = { format: 'L2', text: 'l2 text', footnotes: [] };
    const result = await service.promote(l2Doc);
    expect(adapter.promote).toHaveBeenCalledWith(l2Doc);
    expect(result.format).toBe('L3');
  });

  it('demote delegates to adapter', async () => {
    const l3Doc: L3Document = { format: 'L3', body: 'l3 text', footnotes: [] };
    const result = await service.demote(l3Doc);
    expect(adapter.demote).toHaveBeenCalledWith(l3Doc);
    expect(result.format).toBe('L2');
  });

  it('fires onDidCompleteTransition after promote with uri context', async () => {
    const handler = vi.fn();
    service.onDidCompleteTransition(handler);
    const l2Doc: L2Document = { format: 'L2', text: 'text', footnotes: [] };
    await service.promote(l2Doc, { uri: 'file:///a.md' });
    expect(handler).toHaveBeenCalledWith({ uri: 'file:///a.md', from: 'L2', to: 'L3' });
  });

  it('does not fire onDidCompleteTransition when no uri provided', async () => {
    const handler = vi.fn();
    service.onDidCompleteTransition(handler);
    const l2Doc: L2Document = { format: 'L2', text: 'text', footnotes: [] };
    await service.promote(l2Doc);
    expect(handler).not.toHaveBeenCalled();
  });

  it('cleans up per-URI state on remove', () => {
    service.setPreferredFormat('file:///a.md', 'L3');
    service.remove('file:///a.md');
    expect(service.getPreferredFormat('file:///a.md')).toBeUndefined();
  });

  it('does not fire onDidCompleteTransition if adapter throws', async () => {
    const handler = vi.fn();
    const failAdapter: FormatAdapter = {
      ...adapter,
      promote: vi.fn().mockRejectedValue(new Error('fail')),
    };
    const svc = new FormatService(failAdapter);
    svc.onDidCompleteTransition(handler);
    const l2Doc: L2Document = { format: 'L2', text: 'text', footnotes: [] };
    await expect(svc.promote(l2Doc, { uri: 'file:///a.md' })).rejects.toThrow('fail');
    expect(handler).not.toHaveBeenCalled();
  });
});
