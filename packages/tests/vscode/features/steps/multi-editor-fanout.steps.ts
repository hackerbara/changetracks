/**
 * Step definitions for D-multi-editor-fanout feature.
 *
 * Tests that setView and setDisplay fan out to all visible editors in a
 * split-view layout (BaseController Shift 2 regression gate).
 *
 * Split-view setup uses `workbench.action.splitEditorRight` via the bridge,
 * then opens a second fixture in the new group with Quick Open.
 *
 * NOTE: These steps are @wip — split-view plumbing is new. The assertions
 * rely on querying decoration/hidden-span state per editor group container,
 * which is structurally sound but requires a live VS Code run to validate.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'assert';
import type { Page } from 'playwright';
import type { ChangeDownWorld } from './world';
import {
    executeCommandViaBridge,
    updateSettingDirect,
    getEditorGroupCount,
} from '../../journeys/playwrightHarness';
import { instanceViewMode, getInstanceKey } from './decoration.steps';

// ── Per-editor-group helpers ─────────────────────────────────────────

/**
 * Check whether any spans inside a specific editor group (0-based index)
 * have computed display:none. Returns true if hidden spans exist.
 *
 * VS Code renders each editor group in a `.editor-group-container`.
 * Each group has exactly one `.monaco-editor .view-lines` when a file is open.
 */
async function editorGroupHasHiddenSpans(page: Page, groupIndex: number): Promise<boolean> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        const result = await page.evaluate(`((idx) => {
            var groups = Array.from(document.querySelectorAll('.editor-group-container')).filter(function(el) {
                var style = getComputedStyle(el);
                return style.display !== 'none' && !!el.querySelector('.editor-container');
            });
            var group = groups[idx];
            if (!group) return null; // group not found
            var viewLines = group.querySelector('.monaco-editor .view-lines');
            if (!viewLines) return false;
            var spans = viewLines.querySelectorAll('span');
            for (var i = 0; i < spans.length; i++) {
                if (getComputedStyle(spans[i]).display === 'none') return true;
            }
            return false;
        })(${groupIndex})`).catch(() => null);
        if (result !== null) return result as boolean;
        await page.waitForTimeout(200);
    }
    return false;
}

/**
 * Count visible (non-hidden) editor groups.
 */
async function waitForEditorGroupCount(page: Page, expected: number, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const count = await getEditorGroupCount(page);
        if (count >= expected) return;
        await page.waitForTimeout(300);
    }
    const count = await getEditorGroupCount(page);
    assert.ok(
        count >= expected,
        `Expected at least ${expected} editor groups, got ${count} after ${timeoutMs}ms`
    );
}

// ── Given steps ──────────────────────────────────────────────────────

/**
 * Open the same fixture in a split-right editor pane.
 *
 * Uses `workbench.action.splitEditorRight` to duplicate the active editor
 * into a second group, giving us two editors with the same document.
 * This is the simplest split that exercises fan-out without needing
 * a second fixture file.
 */
Given(
    'a second tracked markdown is open in the right editor split',
    { timeout: 20000 },
    async function (this: ChangeDownWorld) {
        assert.ok(this.page, 'Page not available');

        // Split the current editor to the right
        await executeCommandViaBridge(this.page, 'workbench.action.splitEditorRight');
        await this.page.waitForTimeout(1500);

        // Verify both groups are present
        await waitForEditorGroupCount(this.page, 2, 8000);

        const count = await getEditorGroupCount(this.page);
        assert.ok(count >= 2, `Expected 2 editor groups after split, got ${count}`);
    }
);

// ── When steps ───────────────────────────────────────────────────────

When(
    'I set {string} to false',
    { timeout: 10000 },
    async function (this: ChangeDownWorld, settingKey: string) {
        assert.ok(this.page, 'Page not available');
        await updateSettingDirect(this.page, `changedown.${settingKey}`, false);
        // Give VS Code's file watcher time to process the change
        await this.page.waitForTimeout(1200);
    }
);

// ── Then steps ───────────────────────────────────────────────────────

/**
 * Assert that the left editor group (index 0) has hidden-delimiter spans.
 * Simple view mode and showDelimiters=false both produce display:none spans
 * on CriticMarkup delimiter tokens via the hiddenObj decoration type.
 */
Then(
    'the left editor has hidden delimiters',
    { timeout: 10000 },
    async function (this: ChangeDownWorld) {
        assert.ok(this.page, 'Page not available');
        await this.page.waitForTimeout(800); // allow decoration batch to settle
        const hidden = await editorGroupHasHiddenSpans(this.page, 0);
        assert.ok(hidden, 'Left editor (group 0) has no display:none spans — delimiters not hidden');
    }
);

/**
 * Assert that the right editor group (index 1) has hidden-delimiter spans.
 * This is the key fan-out assertion: if BaseController does not push
 * snapshots to all URIs, this group will still show delimiters.
 */
Then(
    'the right editor has hidden delimiters',
    { timeout: 10000 },
    async function (this: ChangeDownWorld) {
        assert.ok(this.page, 'Page not available');
        await this.page.waitForTimeout(800);
        const hidden = await editorGroupHasHiddenSpans(this.page, 1);
        assert.ok(hidden, 'Right editor (group 1) has no display:none spans — fan-out did not reach this editor');
    }
);
