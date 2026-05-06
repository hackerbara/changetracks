import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock factories so they can be referenced by vi.mock
const mockReadFile = vi.hoisted(() => vi.fn());
const mockCreateServer = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: mockReadFile };
});

vi.mock('node:https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:https')>();
  return { ...actual, createServer: mockCreateServer };
});

describe('local pane server TLS chain', () => {
  beforeEach(() => {
    // Simulate three cert files: key, leaf, CA
    mockReadFile.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith('localhost.key')) return Buffer.from('-----KEY-----\n');
      if (p.endsWith('localhost.crt')) return Buffer.from('-----LEAF-----\n');
      if (p.endsWith('ca.crt')) return Buffer.from('-----CA-----\n');
      throw Object.assign(new Error(`ENOENT: no such file: ${p}`), { code: 'ENOENT' });
    });

    mockCreateServer.mockImplementation((opts: unknown) => {
      const fake: any = {
        listen: (_p: number, _h: string, cb: () => void) => cb(),
        once: () => {},
        off: () => {},
        close: (cb: any) => cb && cb(),
      };
      fake.__opts = opts;
      return fake;
    });
  });

  afterEach(() => {
    mockReadFile.mockReset();
    mockCreateServer.mockReset();
  });

  it('serves leaf+ca as a concatenated PEM bundle (WKWebView requires the chain)', async () => {
    vi.resetModules();
    const mod = await import('../../../packages/cli/src/word/pane-server.js');
    await mod.startLocalPaneServer(false);
    const opts = (mockCreateServer.mock.calls[0]?.[0]) as { cert: Buffer; key: Buffer };
    const certText = opts.cert.toString('utf8');
    expect(certText).toContain('-----LEAF-----');
    expect(certText).toContain('-----CA-----');
    expect((opts as any).ca).toBeUndefined();
  });
});
