// packages/tests/mcp/client-info-author.test.ts
import { describe, it, expect } from 'vitest';
import { synthesizeAuthorFromClientInfo } from '@changedown/mcp/internals';

describe('synthesizeAuthorFromClientInfo', () => {
  it('Claude Desktop → ai:claude-desktop', () => {
    expect(synthesizeAuthorFromClientInfo({ name: 'Claude Desktop', version: '1.0.0' }))
      .toBe('ai:claude-desktop');
  });

  it('cursor → ai:cursor', () => {
    expect(synthesizeAuthorFromClientInfo({ name: 'cursor' }))
      .toBe('ai:cursor');
  });

  it('vscode-copilot → ai:vscode-copilot', () => {
    expect(synthesizeAuthorFromClientInfo({ name: 'vscode-copilot', version: '0.9.0' }))
      .toBe('ai:vscode-copilot');
  });

  it('OpenCode 1.2 → ai:opencode-1.2 (spaces→hyphens; dots preserved)', () => {
    expect(synthesizeAuthorFromClientInfo({ name: 'OpenCode 1.2', version: '1.2.0' }))
      .toBe('ai:opencode-1.2');
  });

  it('undefined input → undefined', () => {
    expect(synthesizeAuthorFromClientInfo(undefined)).toBeUndefined();
  });

  it('empty name → undefined', () => {
    expect(synthesizeAuthorFromClientInfo({ name: '' })).toBeUndefined();
  });

  it('output matches /^[a-z][a-z0-9]*:[a-zA-Z0-9_.-]+$/', () => {
    const result = synthesizeAuthorFromClientInfo({ name: 'My Agent 2.1', version: '2.1.0' });
    expect(result).toBeDefined();
    expect(result).toMatch(/^[a-z][a-z0-9]*:[a-zA-Z0-9_.-]+$/);
  });

  it('returns undefined when name collapses to empty after stripping invalid chars', () => {
    expect(synthesizeAuthorFromClientInfo({ name: '!!!', version: '1.0.0' }))
      .toBeUndefined();
  });
});
