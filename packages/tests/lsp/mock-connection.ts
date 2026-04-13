// Shared mock connection for LSP tests.
//
// Must stub every handler `ChangedownServer.setupHandlers` registers plus
// runtime-path methods (`sendRequest`, `sendNotification`, `client.register`,
// `workspace.applyEdit`, `onDidChangeWatchedFiles`, etc.) so that no realistic
// code path will throw during construction or handler invocation.
//
// Update this file when new handlers are added to ChangedownServer.

import { vi, type Mock } from 'vitest';

/**
 * Returned mock shape — exposes the internal handler/notification maps so
 * tests can drive the server through registered handlers, and types the
 * vi.fn() stubs as `Mock` so tests can read `.mock.calls` etc.
 *
 * Not declared as `Connection` because matching the full upstream interface
 * (including RemoteConsole, Languages, Workspace) would prevent `.mock`
 * access. Tests pass this as `mockConnection as any` to `new ChangedownServer`.
 */
export interface MockConnection {
  // Lifecycle
  onInitialize: (handler: any) => void;
  onInitialized: (handler: any) => void;
  onShutdown: (handler: any) => void;
  onExit: (handler: any) => void;

  // TextDocuments listener targets
  onDidOpenTextDocument: (handler: any) => void;
  onDidChangeTextDocument: (handler: any) => void;
  onDidCloseTextDocument: (handler: any) => void;
  onWillSaveTextDocument: (handler: any) => void;
  onWillSaveTextDocumentWaitUntil: (handler: any) => void;
  onDidSaveTextDocument: (handler: any) => void;

  // Language features
  onHover: (handler: any) => void;
  onCodeLens: (handler: any) => void;
  onFoldingRanges: (handler: any) => void;
  onCodeAction: (handler: any) => void;
  onDocumentLinks: (handler: any) => void;
  onDefinition: (handler: any) => void;

  // Generic request/notification registration
  onRequest: (method: string, handler: any) => void;
  onNotification: (method: string, handler: any) => void;
  onDidChangeWatchedFiles: (handler: any) => void;

  // Outbound — typed as Mock so tests can read .mock.calls
  sendDiagnostics: (params: any) => void;
  sendNotification: (method: string, params: any) => void;
  sendRequest: Mock;

  // Sub-namespaces
  languages: { semanticTokens: { on: (handler: any) => void; refresh: Mock } };
  client: { register: Mock };
  workspace: { applyEdit: Mock };
  console: { log: Mock; error: Mock; warn: Mock; info: Mock };

  // Connection control
  listen: () => void;

  /** Captured handlers keyed by short name (initialize, hover, codeLens, ...).
   *  Request handlers are also keyed as `request:${method}`. */
  _handlers: Record<string, any>;
  /** Captured onRequest handlers keyed by full LSP method name. */
  _requestHandlers: Record<string, (params: any) => any>;
  /** All outbound notifications (sendDiagnostics + sendNotification). */
  _notifications: Array<{ method: string; params: any }>;
}

/**
 * Create a fully-stubbed mock LSP Connection.
 *
 * Covers every method ChangedownServer.setupHandlers calls plus the
 * runtime-path methods exercised by handler bodies.
 */
export function createMockConnection(): MockConnection {
  const handlers: Record<string, any> = {};
  const requestHandlers: Record<string, (params: any) => any> = {};
  const notifications: Array<{ method: string; params: any }> = [];

  const conn = {
    // Lifecycle
    onInitialize: (handler: any) => { handlers.initialize = handler; },
    onInitialized: (handler: any) => { handlers.initialized = handler; },
    onShutdown: (handler: any) => { handlers.shutdown = handler; },
    onExit: (handler: any) => { handlers.exit = handler; },

    // TextDocuments listener targets
    onDidOpenTextDocument: (handler: any) => { handlers.didOpen = handler; },
    onDidChangeTextDocument: (handler: any) => { handlers.didChange = handler; },
    onDidCloseTextDocument: (handler: any) => { handlers.didClose = handler; },
    onWillSaveTextDocument: (handler: any) => { handlers.willSave = handler; },
    onWillSaveTextDocumentWaitUntil: (handler: any) => { handlers.willSaveWaitUntil = handler; },
    onDidSaveTextDocument: (handler: any) => { handlers.didSave = handler; },

    // Language features
    onHover: (handler: any) => { handlers.hover = handler; },
    onCodeLens: (handler: any) => { handlers.codeLens = handler; },
    onFoldingRanges: (handler: any) => { handlers.foldingRanges = handler; },
    onCodeAction: (handler: any) => { handlers.codeAction = handler; },
    onDocumentLinks: (handler: any) => { handlers.documentLinks = handler; },
    onDefinition: (handler: any) => { handlers.definition = handler; },

    // Generic request/notification registration
    onRequest: (method: string, handler: any) => {
      handlers[`request:${method}`] = handler;
      requestHandlers[method] = handler;
    },
    onNotification: (method: string, handler: any) => {
      handlers[`notification:${method}`] = handler;
    },

    // Watched files (registered after initialized)
    onDidChangeWatchedFiles: (_handler: any) => {},

    // Outbound
    sendDiagnostics: (params: any) => {
      notifications.push({ method: 'textDocument/publishDiagnostics', params });
    },
    sendNotification: (method: string, params: any) => {
      notifications.push({ method, params });
    },
    sendRequest: vi.fn().mockResolvedValue(undefined),

    // Sub-namespaces
    languages: {
      semanticTokens: {
        on: (handler: any) => { handlers.semanticTokens = handler; },
        refresh: vi.fn().mockResolvedValue(undefined),
      },
    },
    client: {
      register: vi.fn().mockResolvedValue(undefined),
    },
    workspace: {
      applyEdit: vi.fn().mockResolvedValue({ applied: true }),
    },
    // Use vi.fn() so tests can inspect call history (e.g. write-back warnings).
    console: {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },

    // Connection control
    listen: () => {},

    // Test access
    _handlers: handlers,
    _requestHandlers: requestHandlers,
    _notifications: notifications,
  };

  return conn as unknown as MockConnection;
}
