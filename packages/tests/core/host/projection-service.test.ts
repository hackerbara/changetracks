import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectionService } from '@changedown/core/host';
import type { ProjectionSource } from '@changedown/core/host';

function makeSource(text: string, format: 'L2' | 'L3' = 'L2'): ProjectionSource {
  return { uri: 'file:///test.md', text, changes: [], sourceVersion: 1, sourceFormat: format };
}

describe('ProjectionService', () => {
  let service: ProjectionService;

  beforeEach(() => {
    service = new ProjectionService();
  });

  it('returns current projection for L2 text with no changes', () => {
    const source = makeSource('hello world');
    const result = service.getPreset(source, 'current');
    expect(result.text).toBe('hello world');
    expect(result.sourceVersion).toBe(1);
  });

  it('returns original projection for L2 text with no changes', () => {
    const source = makeSource('hello world');
    const result = service.getPreset(source, 'original');
    expect(result.text).toBe('hello world');
  });

  it('returns decided projection for L2 text with no changes', () => {
    const source = makeSource('hello world');
    const result = service.getPreset(source, 'decided');
    expect(result.text).toBe('hello world');
  });

  it('caches results by uri + sourceVersion + selector', () => {
    const source = makeSource('hello');
    const r1 = service.getPreset(source, 'current');
    const r2 = service.getPreset(source, 'current');
    expect(r1).toBe(r2); // same object reference = cached
  });

  it('invalidates cache for uri', () => {
    const source = makeSource('hello');
    const r1 = service.getPreset(source, 'current');
    service.invalidate('file:///test.md');
    const r2 = service.getPreset(source, 'current');
    expect(r1).not.toBe(r2); // different object = cache was cleared
  });

  it('returns identical text for different projections when no changes', () => {
    const source = makeSource('hello world');
    const current = service.getPreset(source, 'current');
    const original = service.getPreset(source, 'original');
    expect(current.text).toBe(original.text);
  });
});
