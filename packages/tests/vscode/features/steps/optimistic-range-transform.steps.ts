/**
 * Step definitions for ORT-1: Optimistic range transform.
 *
 * TIER: @fast (pure functions, no VS Code required)
 */

// ── MUST be first: install vscode mock before any vscode-dependent imports ──
import { installVscodeMock } from './vscode-mock';
installVscodeMock();

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'assert';
import type { ChangeDownWorld } from './world';

// transformRange is re-exported from core/host via the internals barrel.
// The cache-level helpers (setCachedDecorations, getCachedDecorations, etc.)
// now live on the core DocumentStateManager class.
import { transformRange } from 'changedown-vscode/internals';
import { DocumentStateManager as CoreDocumentStateManager } from '@changedown/core/host';

/** Shared core DSM instance for cache integration tests. */
const coreDsm = new CoreDocumentStateManager();

// ---------------------------------------------------------------------------
// State for transformRange unit tests
// ---------------------------------------------------------------------------
declare module './world' {
    interface ChangeDownWorld {
        ortRange?: { start: number; end: number };
        ortTransformResult?: boolean;
    }
}

Given(
    'a range from offset {int} to {int}',
    function (this: ChangeDownWorld, start: number, end: number) {
        this.ortRange = { start, end };
    }
);

When(
    'an edit inserts {int} characters at offset {int}',
    function (this: ChangeDownWorld, count: number, offset: number) {
        assert.ok(this.ortRange, 'Range not set');
        // Insert: rangeLength=0, text.length=count → delta=count
        transformRange(this.ortRange!, offset, offset, count);
    }
);

When(
    'an edit deletes {int} characters at offset {int}',
    function (this: ChangeDownWorld, count: number, offset: number) {
        assert.ok(this.ortRange, 'Range not set');
        // Delete: rangeLength=count, text.length=0 → delta=-count
        const editEnd = offset + count;
        transformRange(this.ortRange!, offset, editEnd, -count);
    }
);

Then(
    'the range is from offset {int} to {int}',
    function (this: ChangeDownWorld, expectedStart: number, expectedEnd: number) {
        assert.ok(this.ortRange, 'Range not set');
        assert.strictEqual(this.ortRange!.start, expectedStart,
            `start: expected ${expectedStart}, got ${this.ortRange!.start}`);
        assert.strictEqual(this.ortRange!.end, expectedEnd,
            `end: expected ${expectedEnd}, got ${this.ortRange!.end}`);
    }
);

// ---------------------------------------------------------------------------
// transformCachedDecorations integration
// ---------------------------------------------------------------------------

Given(
    'cached decoration data for {string} with ranges {int}-{int} and {int}-{int}',
    function (this: ChangeDownWorld, uri: string, s1: number, e1: number, s2: number, e2: number) {
        const nodes = [
            { id: 'test-1', type: 0, status: 0, range: { start: s1, end: e1 }, contentRange: { start: s1, end: e1 }, level: 0 as const, anchored: false },
            { id: 'test-2', type: 0, status: 0, range: { start: s2, end: e2 }, contentRange: { start: s2, end: e2 }, level: 0 as const, anchored: false },
        ] as any[];
        coreDsm.ensureState(uri, 'x'.repeat(Math.max(e1, e2)), 1);
        coreDsm.setCachedDecorations(uri, nodes, 1);
    }
);

Given(
    'no cached decoration data for {string}',
    function (this: ChangeDownWorld, uri: string) {
        coreDsm.invalidateCache(uri);
    }
);

When(
    'transformCachedDecorations is called with an insert of {int} chars at offset {int}',
    function (this: ChangeDownWorld, count: number, offset: number) {
        const uri = 'file:///test.md';
        const contentChanges = [{
            rangeOffset: offset,
            rangeLength: 0,
            text: 'x'.repeat(count),
        }];
        const state = coreDsm.getState(uri);
        const currentText = state?.text ?? '';
        const newText = currentText.substring(0, offset) + 'x'.repeat(count) + currentText.substring(offset);
        this.ortTransformResult = coreDsm.applyContentChange(uri, newText, 2, contentChanges);
    }
);

When(
    'transformCachedDecorations is called with a delete of {int} chars at offset {int}',
    function (this: ChangeDownWorld, count: number, offset: number) {
        const uri = 'file:///test.md';
        const contentChanges = [{
            rangeOffset: offset,
            rangeLength: count,
            text: '',
        }];
        const state = coreDsm.getState(uri);
        const currentText = state?.text ?? '';
        const newText = currentText.substring(0, offset) + currentText.substring(offset + count);
        this.ortTransformResult = coreDsm.applyContentChange(uri, newText, 2, contentChanges);
    }
);

Then(
    'the cached ranges are {int}-{int} and {int}-{int}',
    function (this: ChangeDownWorld, s1: number, e1: number, s2: number, e2: number) {
        const state = coreDsm.getState('file:///test.md');
        assert.ok(state, 'No state for URI');
        const changes = state!.cachedChanges;
        assert.strictEqual(changes.length, 2, `Expected 2 nodes, got ${changes.length}`);
        assert.strictEqual(changes[0].range.start, s1);
        assert.strictEqual(changes[0].range.end, e1);
        assert.strictEqual(changes[1].range.start, s2);
        assert.strictEqual(changes[1].range.end, e2);
    }
);

Then(
    'transformCachedDecorations returns false',
    function (this: ChangeDownWorld) {
        assert.strictEqual(this.ortTransformResult, false);
    }
);
