import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { initHashline } from '@changedown/core/internals';
import { makeController } from './mock-editor-host.js';

beforeAll(async () => { await initHashline(); });

describe('BaseController.convertFormat', () => {
  let controllerEnv: ReturnType<typeof makeController>;

  beforeEach(() => { controllerEnv = makeController('L3'); });

  const L2_TEXT = [
    'The {++quick ++}brown fox.[^cn-1]',
    '',
    '[^cn-1]: @alice | 2026-04-08 | ins | proposed',
    '',
  ].join('\n');

  it('auto-promotes L2 → L3 on open: swaps buffer, fires event', async () => {
    const events: Array<{ uri: string; from: string; to: string }> = [];
    controllerEnv.controller.onDidConvertFormat(e => events.push({ uri: e.uri, from: e.from, to: e.to }));

    controllerEnv.mockHost.fireOpen('file:///test.md', L2_TEXT);
    // Let the async convertFormat complete
    await new Promise(r => setTimeout(r, 50));

    expect(controllerEnv.mockHost.replaceDocumentCalls).toHaveLength(1);
    expect(controllerEnv.mockHost.replaceDocumentCalls[0].metadata).toMatchObject({
      reason: 'format-conversion',
      from: 'L2',
      to: 'L3',
    });
    expect(events).toHaveLength(1);
    expect(events[0].from).toBe('L2');
    expect(events[0].to).toBe('L3');
  });

  it('rolls back state on host rejection', async () => {
    controllerEnv.mockHost.setRejectReplace(true);
    const errors: unknown[] = [];
    controllerEnv.controller.onDidConvertFormatError(e => errors.push(e));

    controllerEnv.mockHost.fireOpen('file:///test.md', L2_TEXT);
    await new Promise(r => setTimeout(r, 50));

    expect(errors).toHaveLength(1);
    // state.text should still be the original L2 text (host rejected the swap)
    const state = controllerEnv.controller.stateManager.getState('file:///test.md');
    expect(state?.text).toBe(L2_TEXT);
    expect(state?.format).toBe('L2');
  });

  it('fires onDidConvertFormat AFTER state is updated', async () => {
    let stateAtFireTime: { text: string; format: string } | null = null;
    controllerEnv.controller.onDidConvertFormat(() => {
      const state = controllerEnv.controller.stateManager.getState('file:///test.md');
      if (state) {
        stateAtFireTime = { text: state.text, format: state.format };
      }
    });

    controllerEnv.mockHost.fireOpen('file:///test.md', L2_TEXT);
    await new Promise(r => setTimeout(r, 50));

    expect(stateAtFireTime).not.toBeNull();
    expect(stateAtFireTime!.format).toBe('L3');
    // L3 body text should have clean prose (no inline CriticMarkup).
    // The footnote block (definition + continuation lines) may still contain
    // {++...++} as part of the op-dsl line-refs, so exclude those lines.
    // Footnote definitions start with [^, continuation lines start with spaces.
    const inFootnoteBlock = (line: string) => line.startsWith('[^') || /^\s+\S/.test(line);
    const bodyLines = stateAtFireTime!.text.split('\n').filter(l => !inFootnoteBlock(l));
    expect(bodyLines.join('\n')).not.toContain('{++');
  });
});
