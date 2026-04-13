import { describe, it, expect, vi } from 'vitest';
import { BaseController } from '../../src/host/base-controller.js';
import type { EditorHost, DecorationPort, FormatAdapter } from '../../src/host/types.js';

function makeMocks() {
  const host: EditorHost = {
    onDidOpenDocument: (_cb: any) => ({ dispose: () => {} }),
    onDidCloseDocument: (_cb: any) => ({ dispose: () => {} }),
    onDidSaveDocument: (_cb: any) => ({ dispose: () => {} }),
    onDidChangeContent: (_cb: any) => ({ dispose: () => {} }),
    onDidChangeActiveDocument: (_cb: any) => ({ dispose: () => {} }),
    onDidChangeCursorPosition: (_cb: any) => ({ dispose: () => {} }),
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

describe('BaseController fan-out', () => {
  it('setDisplay without URI pushes snapshots for every URI in state', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({ host, decorationPort: deco, formatAdapter });
    controller.stateManager.ensureState('file:///a.md', 'a', 1);
    controller.stateManager.ensureState('file:///b.md', 'b', 1);
    controller.stateManager.ensureState('file:///c.md', 'c', 1);
    (deco.update as any).mockClear();

    controller.setDisplay({ delimiters: 'hide' });

    const pushedUris = (deco.update as any).mock.calls.map((call: any[]) => call[0].uri);
    expect(pushedUris).toContain('file:///a.md');
    expect(pushedUris).toContain('file:///b.md');
    expect(pushedUris).toContain('file:///c.md');
  });

  it('setView without URI pushes snapshots for every URI in state', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({ host, decorationPort: deco, formatAdapter });
    controller.stateManager.ensureState('file:///a.md', 'a', 1);
    controller.stateManager.ensureState('file:///b.md', 'b', 1);
    (deco.update as any).mockClear();

    controller.setView('simple');

    const pushedUris = (deco.update as any).mock.calls.map((call: any[]) => call[0].uri);
    expect(pushedUris).toContain('file:///a.md');
    expect(pushedUris).toContain('file:///b.md');
  });

  it('setView with explicit URI pushes only that URI', () => {
    const { host, deco, formatAdapter } = makeMocks();
    const controller = new BaseController({ host, decorationPort: deco, formatAdapter });
    controller.stateManager.ensureState('file:///a.md', 'a', 1);
    controller.stateManager.ensureState('file:///b.md', 'b', 1);
    (deco.update as any).mockClear();

    controller.setView('simple', 'file:///a.md' as any);

    const pushedUris = (deco.update as any).mock.calls.map((call: any[]) => call[0].uri);
    expect(pushedUris).toEqual(['file:///a.md']);
  });

  it('fan-out continues past a single URI that throws', () => {
    const { host, formatAdapter } = makeMocks();
    let callCount = 0;
    const deco: DecorationPort = {
      update: vi.fn().mockImplementation((snap: any) => {
        callCount++;
        if (snap.uri === 'file:///b.md') throw new Error('boom');
      }),
      clear: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = new BaseController({ host, decorationPort: deco, formatAdapter });
    controller.stateManager.ensureState('file:///a.md', 'a', 1);
    controller.stateManager.ensureState('file:///b.md', 'b', 1);
    controller.stateManager.ensureState('file:///c.md', 'c', 1);

    expect(() => controller.setDisplay({ delimiters: 'hide' })).not.toThrow();
    expect(callCount).toBe(3);
  });
});
