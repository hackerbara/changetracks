import * as assert from 'assert';
import { VIEW_PRESETS, type View, type DocumentSnapshot } from '@changedown/core/host';

suite('VsCodePreviewAdapter', () => {
    function makeAdapter() {
        const { VsCodePreviewAdapter } = require('../../preview-adapter');
        return new VsCodePreviewAdapter();
    }

    function makeSnapshot(projection: 'current' | 'decided' | 'original' = 'current', delimiters: 'show' | 'hide' = 'show'): DocumentSnapshot {
        const viewName: 'working' | 'simple' | 'decided' | 'original' =
            projection === 'decided' ? 'decided'
            : projection === 'original' ? 'original'
            : delimiters === 'show' ? 'working'
            : 'simple';
        const view: View = {
            ...VIEW_PRESETS[viewName],
            display: { ...VIEW_PRESETS[viewName].display, delimiters },
        };
        return {
            uri: 'file:///test.md',
            text: '# Hello',
            sourceVersion: 0,
            changes: [],
            format: 'L2',
            view,
            cursorOffset: 0,
        };
    }

    test('getPluginConfig returns working mode by default', () => {
        const adapter = makeAdapter();
        const config = adapter.getPluginConfig();
        assert.strictEqual(config.viewName, 'working');
        assert.strictEqual(config.showFootnotes, true);
    });

    test('getPluginConfig reflects updated viewName', () => {
        const adapter = makeAdapter();
        // 'current' projection with delimiters shown → working
        adapter.update(makeSnapshot('current', 'show'));
        const config = adapter.getPluginConfig();
        assert.strictEqual(config.viewName, 'working');
        assert.strictEqual(config.showFootnotes, true);
    });

    test('effectiveViewName: working + delimiters=hide → simple', () => {
        const adapter = makeAdapter();
        adapter.update(makeSnapshot('current', 'hide'));
        const config = adapter.getPluginConfig();
        assert.strictEqual(config.viewName, 'simple');
    });

    test('effectiveViewName: decided projection → decided', () => {
        const adapter = makeAdapter();
        adapter.update(makeSnapshot('decided', 'hide'));
        const config = adapter.getPluginConfig();
        assert.strictEqual(config.viewName, 'decided');
    });

    test('clear resets to default config', () => {
        const adapter = makeAdapter();
        adapter.update(makeSnapshot('decided'));
        adapter.clear();
        const config = adapter.getPluginConfig();
        assert.strictEqual(config.viewName, 'working');
    });
});
