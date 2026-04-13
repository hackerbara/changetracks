import { describe, it, expect, vi } from 'vitest';
import { BaseController } from '../../src/host/base-controller.js';
import type { EditorHost, DecorationPort, FormatAdapter } from '../../src/host/types.js';
import { EventEmitter } from '../../src/host/types.js';

function makeMocks() {
  const host: EditorHost = {
    onDidOpenDocument: new EventEmitter<{ uri: string; text: string }>().event,
    onDidCloseDocument: new EventEmitter<{ uri: string }>().event,
    onDidSaveDocument: new EventEmitter<{ uri: string }>().event,
    onDidChangeContent: new EventEmitter<{
      uri: string; text: string; version: number;
      changes: any[]; isEcho: boolean;
    }>().event,
    onDidChangeActiveDocument: new EventEmitter<{ uri: string; text?: string } | null>().event,
    onDidChangeCursorPosition: new EventEmitter<{ uri: string; offset: number }>().event,
    getDocumentText: (_uri: string) => '',
    applyEdits: async () => ({ applied: true, version: 1, text: '' }),
  } as any;
  const deco: DecorationPort = {
    update: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  };
  const formatAdapter: FormatAdapter = {
    promote: async (doc: any) => doc,
    demote: async (doc: any) => doc,
  } as any;
  return { host, deco, formatAdapter };
}

describe('BaseController _userDisplay layer', () => {
  it('defaultDisplay applies to initial _defaultView', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({
      host,
      decorationPort: deco,
      formatAdapter,
      defaultDisplay: { delimiters: 'show', authorColors: 'never' },
    });
    const view = controller.getView();
    expect(view.display.delimiters).toBe('show');
    expect(view.display.authorColors).toBe('never');
  });

  it('setView preserves user display override across preset swap', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({
      host,
      decorationPort: deco,
      formatAdapter,
      defaultDisplay: { delimiters: 'show' },
    });
    expect(controller.getView().name).toBe('working');
    expect(controller.getView().display.delimiters).toBe('show');

    controller.setView('simple');
    expect(controller.getView().name).toBe('simple');
    expect(controller.getView().display.delimiters).toBe('show');

    controller.setView('working');
    expect(controller.getView().display.delimiters).toBe('show');
  });

  it('setDisplay merges partial into _userDisplay and rebuilds effective view', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({ host, decorationPort: deco, formatAdapter });
    controller.setDisplay({ delimiters: 'hide' });
    expect(controller.getView().display.delimiters).toBe('hide');
    controller.setView('final');
    expect(controller.getView().display.delimiters).toBe('hide');
    controller.setView('working');
    expect(controller.getView().display.delimiters).toBe('hide');
  });

  it('setDisplay with undefined field clears the user override for that field', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({
      host,
      decorationPort: deco,
      formatAdapter,
      defaultDisplay: { authorColors: 'always' },
    });
    expect(controller.getView().display.authorColors).toBe('always');
    controller.setDisplay({ authorColors: undefined });
    expect(controller.getView().display.authorColors).toBe('auto');
  });

  it('user preferences win over preset hardcoded values (Q1)', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({
      host,
      decorationPort: deco,
      formatAdapter,
      defaultDisplay: { authorColors: 'always' },
    });
    controller.setView('final');
    expect(controller.getView().display.authorColors).toBe('always');
  });

  it('setDisplay fires onDidChangeView', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({ host, decorationPort: deco, formatAdapter });
    const listener = vi.fn();
    controller.onDidChangeView(listener);
    controller.setDisplay({ delimiters: 'hide' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].display.delimiters).toBe('hide');
  });
});
