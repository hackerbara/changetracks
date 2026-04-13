import { describe, it, expect, beforeEach } from 'vitest';
import { ChangedownServer } from '@changedown/lsp-server/internals';
import type { InitializeParams } from '@changedown/lsp-server/internals';
import { createMockConnection } from './mock-connection.js';

describe('Browser-mode ChangedownServer', () => {
  let server: ChangedownServer;
  let mockConnection: any;

  beforeEach(() => {
    mockConnection = createMockConnection();
    server = new ChangedownServer(mockConnection);
  });

  it('creates without options (browser default)', () => {
    expect(server).toBeTruthy();
    expect(server.workspace).toBeTruthy();
  });

  it('git stubs return undefined by default', async () => {
    const root = await server._gitGetWorkspaceRoot('/some/path');
    expect(root).toBeUndefined();

    const prev = await server._gitGetPreviousVersion('/some/path', '/root');
    expect(prev).toBeUndefined();
  });

  it('handleAnnotate returns null when no document is open', async () => {
    // No document opened — currentText will be undefined, returns null immediately
    const result = await server.handleAnnotate({ textDocument: { uri: 'file:///test.md' } });
    expect(result).toBeNull();
  });

  it('handleAnnotate returns null when git stubs are no-ops', async () => {
    // Use handleDocumentOpen to register document text through the server's public API
    await server.handleDocumentOpen('file:///test.md', 'Hello world', 'markdown');

    // With default git stubs returning undefined, _gitGetWorkspaceRoot returns undefined
    // and handleAnnotate returns null at the workspace-root check
    const result = await server.handleAnnotate({ textDocument: { uri: 'file:///test.md' } });
    expect(result).toBeNull();
  });

  it('loadProjectConfig uses defaults when no loadConfig provided', async () => {
    const result = await server.handleInitialize({
      capabilities: {},
      rootUri: 'file:///root',
    } as InitializeParams);

    // Server should have capabilities (init succeeded) and use default config
    expect(result.capabilities).toBeTruthy();
    expect(result.capabilities.hoverProvider).toBe(true);
  });

  it('loadProjectConfig uses provided callback', async () => {
    let callbackCalled = false;
    const customServer = new ChangedownServer(createMockConnection() as any, {
      loadConfig: () => {
        callbackCalled = true;
        return undefined;
      },
    });

    // Initialize with rootUri so workspaceRoot is set, then handleInitialized triggers loadProjectConfig
    await customServer.handleInitialize({
      capabilities: {},
      rootUri: 'file:///root',
    } as InitializeParams);
    customServer.handleInitialized();

    expect(callbackCalled).toBe(true);
  });
});
