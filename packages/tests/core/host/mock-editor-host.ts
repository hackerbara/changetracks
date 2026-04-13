import { BaseController, LocalFormatAdapter, EventEmitter } from '@changedown/core/host';
import type { EditorHost, ContentChange } from '@changedown/core/host';

export function makeMockHost() {
  const openEmitter = new EventEmitter<{ uri: string; text: string }>();
  const closeEmitter = new EventEmitter<{ uri: string }>();
  const saveEmitter = new EventEmitter<{ uri: string }>();
  const contentEmitter = new EventEmitter<{
    uri: string; text: string; version: number; changes: ContentChange[]; isEcho: boolean;
  }>();
  const activeEmitter = new EventEmitter<{ uri: string; text?: string } | null>();
  const cursorEmitter = new EventEmitter<{ uri: string; offset: number }>();

  const buffers = new Map<string, { text: string; version: number }>();
  const replaceDocumentCalls: Array<{ uri: string; newText: string; metadata: unknown }> = [];
  let rejectReplace = false;

  const host: EditorHost = {
    onDidOpenDocument: openEmitter.event,
    onDidCloseDocument: closeEmitter.event,
    onDidSaveDocument: saveEmitter.event,
    onDidChangeContent: contentEmitter.event,
    onDidChangeActiveDocument: activeEmitter.event,
    onDidChangeCursorPosition: cursorEmitter.event,
    getDocumentText: (uri) => buffers.get(uri)?.text ?? '',
    applyEdits: async () => ({ applied: true, text: '', version: 0 }),
    replaceDocument: async (uri, newText, metadata) => {
      replaceDocumentCalls.push({ uri, newText, metadata });
      if (rejectReplace) {
        return { applied: false, text: '', version: 0 };
      }
      const buf = buffers.get(uri);
      if (!buf) return { applied: false, text: '', version: 0 };
      const oldText = buf.text;
      buf.text = newText;
      buf.version++;
      // Simulate the echo
      if (oldText !== newText) {
        contentEmitter.fire({ uri, text: newText, version: buf.version, changes: [], isEcho: true });
      }
      return { applied: true, text: newText, version: buf.version };
    },
  };

  return {
    host,
    buffers,
    replaceDocumentCalls,
    setRejectReplace: (v: boolean) => { rejectReplace = v; },
    fireOpen: (uri: string, text: string) => {
      buffers.set(uri, { text, version: 1 });
      openEmitter.fire({ uri, text });
    },
    fireContent: (e: { uri: string; text: string; version: number; changes: ContentChange[]; isEcho: boolean }) => {
      contentEmitter.fire(e);
    },
  };
}

export function makeController(defaultFormat: 'L2' | 'L3' = 'L2') {
  const mockHost = makeMockHost();
  const decorationUpdates: unknown[] = [];
  const decorationPort = {
    update: (snapshot: unknown) => { decorationUpdates.push(snapshot); },
    clear: () => {},
    dispose: () => {},
  };
  const controller = new BaseController({
    host: mockHost.host,
    decorationPort,
    formatAdapter: new LocalFormatAdapter(),
    defaultFormat,
  });
  return { controller, mockHost, decorationUpdates };
}
