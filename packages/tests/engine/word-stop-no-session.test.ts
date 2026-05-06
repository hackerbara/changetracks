import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readWordSession: vi.fn(),
  clearWordSession: vi.fn(async () => {}),
  runOfficeDebugStop: vi.fn(async () => 0),
  resolveManifest: vi.fn(async () => '/should-not-be-called'),
}));

vi.mock('../../../packages/cli/src/word/state.js', () => ({
  readWordSession: mocks.readWordSession,
  clearWordSession: mocks.clearWordSession,
}));
vi.mock('../../../packages/cli/src/word/office-tools.js', () => ({
  runOfficeDebugStop: mocks.runOfficeDebugStop,
}));
vi.mock('../../../packages/cli/src/word/manifest.js', () => ({
  resolveManifest: mocks.resolveManifest,
}));

describe('word stop with no recorded session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT fetch hosted manifest when session is missing', async () => {
    mocks.readWordSession.mockResolvedValue(undefined);
    vi.resetModules();
    const { runWordStop } = await import('../../../packages/cli/src/word/stop.js');
    const code = await runWordStop({ cwd: '/repo' }, {});
    expect(code).toBe(0);
    expect(mocks.resolveManifest).not.toHaveBeenCalled();
    expect(mocks.runOfficeDebugStop).not.toHaveBeenCalled();
  });

  it('uses --manifest when passed even with no session', async () => {
    mocks.readWordSession.mockResolvedValue(undefined);
    vi.resetModules();
    const { runWordStop } = await import('../../../packages/cli/src/word/stop.js');
    await runWordStop({ cwd: '/repo' }, { manifest: '/explicit/manifest.xml' });
    expect(mocks.runOfficeDebugStop).toHaveBeenCalledWith('/explicit/manifest.xml', expect.any(Object));
    expect(mocks.resolveManifest).not.toHaveBeenCalled();
  });
});
