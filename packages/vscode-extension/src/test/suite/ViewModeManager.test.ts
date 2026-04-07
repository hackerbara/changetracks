import * as assert from 'assert';
import { nextViewMode } from '../../view-mode';
import type { ViewMode } from '../../view-mode';

suite('ViewModeManager (view-mode helpers)', () => {
    test('cycleViewMode advances through modes: review → changes → settled → raw → review', () => {
        let mode: ViewMode = 'review';
        mode = nextViewMode(mode);
        assert.strictEqual(mode, 'changes');
        mode = nextViewMode(mode);
        assert.strictEqual(mode, 'settled');
        mode = nextViewMode(mode);
        assert.strictEqual(mode, 'raw');
        mode = nextViewMode(mode);
        assert.strictEqual(mode, 'review');
    });

    test('nextViewMode wraps from last to first', () => {
        const mode = nextViewMode('raw');
        assert.strictEqual(mode, 'review');
    });

    test('nextViewMode handles each mode independently', () => {
        assert.strictEqual(nextViewMode('review'), 'changes');
        assert.strictEqual(nextViewMode('changes'), 'settled');
        assert.strictEqual(nextViewMode('settled'), 'raw');
        assert.strictEqual(nextViewMode('raw'), 'review');
    });
});
