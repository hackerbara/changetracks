import { describe, it, expect } from 'vitest';
import { getListedTools, getListedToolsWithConfig } from '@changedown/mcp/internals';
import type { ChangeDownConfig } from '@changedown/mcp/internals';

describe('getListedTools (MCP tool surface)', () => {
  it('returns exactly 7 tools (final surface)', () => {
    const tools = getListedTools();
    expect(tools).toHaveLength(7);
  });

  it('does not include deprecated/internal tools in the list', () => {
    const hidden = [
      'get_change',
      'begin_change_group', 'end_change_group', 'review_change',
      'propose_batch', 'respond_to_thread', 'list_open_threads',
      'raw_edit', 'get_tracking_status',
    ];
    const names = getListedTools().map((t) => t.name);
    for (const name of hidden) {
      expect(names).not.toContain(name);
    }
  });

  it('includes propose_change and other public tools', () => {
    const names = getListedTools().map((t) => t.name);
    expect(names).toContain('propose_change');
    expect(names).toContain('review_changes');
    expect(names).toContain('read_tracked_file');
    expect(names).toContain('amend_change');
    expect(names).toContain('list_changes');
    expect(names).toContain('supersede_change');
    expect(names).toContain('resolve_thread');
  });

  it('keeps tool descriptions concise for context-window efficiency', () => {
    const tools = getListedTools();
    const maxLen = Math.max(...tools.map((t) => (t.description ?? '').length));
    expect(maxLen).toBeLessThanOrEqual(400);
  });

  it('classic mode returns old_text/new_text schemas for propose_change and documents word compact fallback', () => {
    const tools = getListedTools('classic');
    const pc = tools.find(t => t.name === 'propose_change');
    expect(pc).toBeDefined();
    const props = (pc!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty('old_text');
    expect(props).toHaveProperty('new_text');
    expect(props).toHaveProperty('at');
    expect(props).toHaveProperty('op');
  });

  it('compact mode returns at/op schemas for propose_change and documents word classic fallback', () => {
    const tools = getListedTools('compact');
    const pc = tools.find(t => t.name === 'propose_change');
    expect(pc).toBeDefined();
    const props = (pc!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty('at');
    expect(props).toHaveProperty('op');
    expect(props).toHaveProperty('old_text');
    expect(props).toHaveProperty('new_text');
  });

  it('non-editing tools are the same in both modes', () => {
    const classic = getListedTools('classic');
    const compact = getListedTools('compact');
    const classicReview = classic.find(t => t.name === 'review_changes');
    const compactReview = compact.find(t => t.name === 'review_changes');
    expect(classicReview).toEqual(compactReview);
  });

  it('defaults to classic when no mode provided', () => {
    const tools = getListedTools();
    const pc = tools.find(t => t.name === 'propose_change');
    const props = (pc!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty('old_text');
  });
});

describe('getListedToolsWithConfig', () => {
  it('when author enforcement is optional, returns same author description as getListedTools', () => {
    const config: ChangeDownConfig = {
      tracking: { include: [], exclude: [], default: 'tracked', auto_header: true },
      author: { default: '', enforcement: 'optional' },
      hooks: { enforcement: 'warn', exclude: [] },
      matching: { mode: 'normalized' },
      hashline: { enabled: false, auto_remap: false },
      settlement: { auto_on_approve: true, auto_on_reject: true },
      policy: { mode: 'safety-net', creation_tracking: 'footnote' },
      protocol: { mode: 'classic', level: 2, reasoning: 'required', batch_reasoning: 'required' },
    };
    const withConfig = getListedToolsWithConfig(config);
    const base = getListedTools();
    const proposeChangeBase = base.find((t) => t.name === 'propose_change');
    const proposeChangeWithConfig = withConfig.find((t) => t.name === 'propose_change');
    const baseDesc = (proposeChangeBase!.inputSchema as { properties?: { author?: { description?: string } } }).properties?.author?.description ?? '';
    const withConfigDesc = (proposeChangeWithConfig!.inputSchema as { properties?: { author?: { description?: string } } }).properties?.author?.description ?? '';
    expect(withConfigDesc).toBe(baseDesc);
    expect(withConfigDesc).not.toContain('In this project author is required');
  });

  it('when author enforcement is required, appends hint to author param description', () => {
    const config: ChangeDownConfig = {
      tracking: { include: [], exclude: [], default: 'tracked', auto_header: true },
      author: { default: 'ai:composer', enforcement: 'required' },
      hooks: { enforcement: 'warn', exclude: [] },
      matching: { mode: 'normalized' },
      hashline: { enabled: false, auto_remap: false },
      settlement: { auto_on_approve: true, auto_on_reject: true },
      policy: { mode: 'safety-net', creation_tracking: 'footnote' },
      protocol: { mode: 'classic', level: 2, reasoning: 'required', batch_reasoning: 'required' },
    };
    const withConfig = getListedToolsWithConfig(config);
    const proposeChange = withConfig.find((t) => t.name === 'propose_change');
    const authorDesc = (proposeChange!.inputSchema as { properties?: { author?: { description?: string } } }).properties?.author?.description ?? '';
    expect(authorDesc).toContain('In this project author is required');
  });
});


describe('word-aware propose_change schema', () => {
  it('compact mode still prefers at/op and documents word classic fallback', () => {
    const tools = getListedTools('compact');
    const pc = tools.find((t) => t.name === 'propose_change');
    expect(pc).toBeDefined();
    const schema = pc!.inputSchema as { properties: Record<string, { description?: string }> };
    expect(schema.properties).toHaveProperty('at');
    expect(schema.properties).toHaveProperty('op');
    expect(schema.properties).toHaveProperty('old_text');
    expect(schema.properties.old_text!.description).toMatch(/word:\/\//i);
    expect(schema.properties.old_text!.description).toMatch(/classic/i);
  });

  it('classic mode still prefers old_text/new_text and documents word compact fallback', () => {
    const tools = getListedTools('classic');
    const pc = tools.find((t) => t.name === 'propose_change');
    expect(pc).toBeDefined();
    const schema = pc!.inputSchema as { properties: Record<string, { description?: string }> };
    expect(schema.properties).toHaveProperty('old_text');
    expect(schema.properties).toHaveProperty('new_text');
    expect(schema.properties).toHaveProperty('at');
    expect(schema.properties.at!.description).toMatch(/word:\/\//i);
    expect(schema.properties.at!.description).toMatch(/compact/i);
  });
});
