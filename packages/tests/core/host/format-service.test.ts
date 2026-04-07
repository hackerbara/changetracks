import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FormatService } from '@changedown/core/host';
import type { FormatAdapter } from '@changedown/core/host';

function mockAdapter(): FormatAdapter {
  return {
    convertL2ToL3: vi.fn(async (_uri, text) => `L3(${text})`),
    convertL3ToL2: vi.fn(async (_uri, text) => `L2(${text})`),
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

  it('promoteToL3 delegates to adapter', async () => {
    const result = await service.promoteToL3('file:///a.md', 'l2 text');
    expect(adapter.convertL2ToL3).toHaveBeenCalledWith('file:///a.md', 'l2 text');
    expect(result.convertedText).toBe('L3(l2 text)');
  });

  it('demoteToL2 delegates to adapter', async () => {
    const result = await service.demoteToL2('file:///a.md', 'l3 text');
    expect(adapter.convertL3ToL2).toHaveBeenCalledWith('file:///a.md', 'l3 text');
    expect(result.convertedText).toBe('L2(l3 text)');
  });

  it('fires onDidCompleteTransition after promotion', async () => {
    const handler = vi.fn();
    service.onDidCompleteTransition(handler);
    await service.promoteToL3('file:///a.md', 'text');
    expect(handler).toHaveBeenCalledWith({ uri: 'file:///a.md', from: 'L2', to: 'L3' });
  });

  it('cleans up per-URI state on remove', () => {
    service.setPreferredFormat('file:///a.md', 'L3');
    service.remove('file:///a.md');
    expect(service.getPreferredFormat('file:///a.md')).toBeUndefined();
  });

  it('does not fire onDidCompleteTransition if adapter throws', async () => {
    const handler = vi.fn();
    const failAdapter = { ...adapter, convertL2ToL3: vi.fn().mockRejectedValue(new Error('fail')) };
    const svc = new FormatService(failAdapter);
    svc.onDidCompleteTransition(handler);
    await expect(svc.promoteToL3('file:///a.md', 'text')).rejects.toThrow('fail');
    expect(handler).not.toHaveBeenCalled();
  });
});
