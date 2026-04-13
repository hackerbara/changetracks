import { describe, it, expect, beforeAll } from 'vitest';
import { initHashline } from '@changedown/core/internals';
import { makeController } from './mock-editor-host.js';

beforeAll(async () => { await initHashline(); });

describe('handleOpenDocument synchronous promotion', () => {
  const L2_TEXT = [
    'The {++quick ++}brown fox.[^cn-1]',
    '',
    '[^cn-1]: @alice | 2026-04-08 | ins | proposed',
    '',
  ].join('\n');

  it('does not push a snapshot at L2 before L3 conversion lands', async () => {
    const { mockHost, decorationUpdates } = makeController('L3');

    mockHost.fireOpen('file:///test.md', L2_TEXT);
    await new Promise(r => setTimeout(r, 100));

    // Exactly ONE decoration update should have fired: the post-conversion L3 snapshot.
    expect(decorationUpdates.length).toBe(1);
    const snapshot = decorationUpdates[0] as { text: string; format: string };
    expect(snapshot.format).toBe('L3');
    // L3 body prose should not contain inline CriticMarkup (the {++ is in the footnote block's op-dsl, not the body).
    const inFootnoteBlock = (line: string) => line.startsWith('[^') || /^\s+\S/.test(line);
    const bodyLines = snapshot.text.split('\n').filter(l => !inFootnoteBlock(l));
    expect(bodyLines.join('\n')).not.toContain('{++');
  });

  it('still pushes a snapshot on open when no conversion is needed', async () => {
    // Use defaultFormat: 'L2' with L2 text — no conversion needed
    const { mockHost, decorationUpdates } = makeController('L2');

    mockHost.fireOpen('file:///test.md', L2_TEXT);
    await new Promise(r => setTimeout(r, 50));

    expect(decorationUpdates.length).toBeGreaterThanOrEqual(1);
  });
});
