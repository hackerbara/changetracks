import { describe, it, expect, beforeEach } from 'vitest';
import type { ApplyEditResult } from '@changedown/core/host';

/**
 * Unit test for the replaceDocument echo contract, using a hand-rolled mock
 * editor host that mirrors the VsCodeEditorHost pattern. This validates the
 * contract at the port level without requiring the VS Code test harness.
 */

class MockEditorHost {
  private buffer = '';
  private version = 0;
  private echoUris = new Set<string>();
  private lastChangeWasEcho = false;
  public changeHandler: ((e: { uri: string; text: string; version: number; isEcho: boolean }) => void) | null = null;

  setBuffer(text: string, version: number = 1): void {
    this.buffer = text;
    this.version = version;
  }

  async replaceDocument(uri: string, newText: string, _metadata: unknown): Promise<ApplyEditResult> {
    const textBefore = this.buffer;
    this.echoUris.add(uri);
    // Simulate workspace.applyEdit succeeding
    this.buffer = newText;
    this.version++;
    // Simulate VS Code firing onDidChangeTextDocument
    if (textBefore !== newText) {
      const isEcho = this.echoUris.has(uri);
      this.echoUris.delete(uri);
      this.lastChangeWasEcho = isEcho;
      this.changeHandler?.({ uri, text: newText, version: this.version, isEcho });
    } else {
      // No-op: drop echo flag
      this.echoUris.delete(uri);
    }
    return { applied: true, text: this.buffer, version: this.version };
  }

  wasLastChangeEcho(): boolean {
    return this.lastChangeWasEcho;
  }
}

describe('replaceDocument echo contract', () => {
  let host: MockEditorHost;
  beforeEach(() => {
    host = new MockEditorHost();
    host.setBuffer('original');
  });

  it('fires exactly one isEcho=true event per call', async () => {
    const events: Array<{ isEcho: boolean }> = [];
    host.changeHandler = e => events.push({ isEcho: e.isEcho });

    await host.replaceDocument('file:///test.md', 'replaced', { reason: 'external' });

    expect(events).toHaveLength(1);
    expect(events[0].isEcho).toBe(true);
  });

  it('drops echo flag on no-op replace', async () => {
    host.setBuffer('same');
    const events: Array<{ isEcho: boolean }> = [];
    host.changeHandler = e => events.push({ isEcho: e.isEcho });

    await host.replaceDocument('file:///test.md', 'same', { reason: 'external' });

    // No change event fires for no-op, and the echo flag was dropped.
    expect(events).toHaveLength(0);
  });

  it('returns { applied: true, text, version } with post-swap values', async () => {
    const result = await host.replaceDocument('file:///test.md', 'new content', { reason: 'external' });
    expect(result.applied).toBe(true);
    expect(result.text).toBe('new content');
    expect(result.version).toBe(2);
  });
});
