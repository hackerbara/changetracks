import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readWordSession: vi.fn(),
  clearWordSession: vi.fn(async () => {}),
  runOfficeDebugStop: vi.fn(async () => 0),
  resolveManifest: vi.fn(),
  kill: vi.fn(),
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

describe('word stop pane cleanup', () => {
  let originalKill: typeof process.kill;

  beforeEach(() => {
    vi.clearAllMocks();
    originalKill = process.kill;
    process.kill = mocks.kill as any;
  });

  afterEach(() => {
    process.kill = originalKill;
  });

  it('SIGTERMs the recorded startPid before un-sideload', async () => {
    mocks.readWordSession.mockResolvedValue({
      manifestPath: '/tmp/manifest.xml',
      startedAt: '2026-05-05T00:00:00Z',
      startPid: 99999,
      panePort: 3000,
      paneMode: 'local',
    });

    vi.resetModules();
    const { runWordStop } = await import('../../../packages/cli/src/word/stop.js');
    await runWordStop({ cwd: '/repo' }, {});

    expect(mocks.kill).toHaveBeenCalledWith(99999, 'SIGTERM');
    const sigtermOrder = mocks.kill.mock.invocationCallOrder[0];
    const stopOrder = mocks.runOfficeDebugStop.mock.invocationCallOrder[0];
    expect(sigtermOrder).toBeLessThan(stopOrder);
  });

  it('tolerates ESRCH when startPid already exited', async () => {
    mocks.readWordSession.mockResolvedValue({
      manifestPath: '/tmp/manifest.xml',
      startedAt: '2026-05-05T00:00:00Z',
      startPid: 88888,
    });
    mocks.kill.mockImplementation(() => {
      const err: NodeJS.ErrnoException = new Error('No such process');
      err.code = 'ESRCH';
      throw err;
    });

    vi.resetModules();
    const { runWordStop } = await import('../../../packages/cli/src/word/stop.js');
    const code = await runWordStop({ cwd: '/repo' }, {});
    expect(code).toBe(0);
  });
});
