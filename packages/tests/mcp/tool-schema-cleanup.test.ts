import { describe, it, expect } from 'vitest';
import { compactProposeChangeSchema, classicProposeChangeSchema } from '@changedown/mcp/internals';

describe('propose_change schema: compact mode', () => {
  const props = compactProposeChangeSchema.inputSchema.properties;

  it('has at param', () => expect(props.at).toBeDefined());
  it('has op param', () => expect(props.op).toBeDefined());
  it('has changes array with at/op items', () => {
    expect((props.changes as any).items.properties.at).toBeDefined();
    expect((props.changes as any).items.properties.op).toBeDefined();
  });
  it('has word-only old_text fallback', () => {
    expect(props.old_text).toBeDefined();
    expect((props.old_text as any).description).toMatch(/word:\/\//i);
  });
  it('has word-only new_text fallback', () => expect(props.new_text).toBeDefined());
  it('has reason param for word classic fallback', () => expect(props.reason).toBeDefined());
  it('has word-only insert_after fallback', () => expect(props.insert_after).toBeDefined());
  it('does NOT have start_line/start_hash', () => {
    expect(props.start_line).toBeUndefined();
    expect(props.start_hash).toBeUndefined();
  });
  it('does NOT have level', () => expect(props.level).toBeUndefined());
  it('op description mentions {>> annotation', () => {
    expect((props.op as any).description).toContain('{>>');
    expect((props.op as any).description).toContain('annotate');
  });
});

describe('propose_change schema: classic mode', () => {
  const props = classicProposeChangeSchema.inputSchema.properties;

  it('has old_text', () => expect(props.old_text).toBeDefined());
  it('has new_text', () => expect(props.new_text).toBeDefined());
  it('has reason', () => expect(props.reason).toBeDefined());
  it('has word-only at fallback', () => {
    expect(props.at).toBeDefined();
    expect((props.at as any).description).toMatch(/word:\/\//i);
  });
  it('has word-only op fallback', () => expect(props.op).toBeDefined());
  it('changes items have old_text/new_text, not at/op', () => {
    const itemProps = (props.changes as any).items.properties;
    expect(itemProps.old_text).toBeDefined();
    expect(itemProps.new_text).toBeDefined();
    expect(itemProps.at).toBeUndefined();
    expect(itemProps.op).toBeUndefined();
  });
});
