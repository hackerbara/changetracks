/**
 * Step definitions for FE1 — Format conversion error surfacing.
 *
 * Regression gate for the onDidConvertFormatError subscription wired in
 * extension.ts:170-179. Tests that a failed L2→L3 promotion fires
 * vscode.window.showErrorMessage with "Format conversion failed…" and that
 * the document rolls back to L2 (CriticMarkup delimiters still visible).
 *
 * Infrastructure requirements satisfied by bridge commands added in
 * packages/vscode-extension/src/commands/test-commands.ts (Task 17):
 *   - changedown._testFailNextConvert            — one-shot promote failure injector
 *   - changedown._testTriggerFormatConversionL3  — calls controller.setFormatPreference(uri,'L3')
 *   - changedown._testTriggerFormatConversionL2  — calls controller.setFormatPreference(uri,'L2')
 *
 * The "an error message appears saying {string}" step is defined in
 * sl-amend-supersede.steps.ts and is reused here.
 *
 * Fixture: packages/tests/vscode/fixtures/journeys/l3-promotion-test.md
 */

import { When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChangeDownWorld } from './world';
import {
    executeCommandViaBridge,
    getDocumentText,
} from '../../journeys/playwrightHarness';

// ── When: arm the failure injection ─────────────────────────────────────────

/**
 * Calls the _testFailNextConvert bridge command, which monkey-patches
 * controller.formatService.promote to throw exactly once.  The next call to
 * controller.convertFormat (targeting L3) will throw, triggering the
 * onDidConvertFormatError event and the vscode.window.showErrorMessage call
 * in extension.ts:174.
 */
When(
    'I arm the format-conversion failure injection',
    { timeout: 8000 },
    async function (this: ChangeDownWorld) {
        assert.ok(this.page, 'Page not available');

        const statePath = path.join(os.tmpdir(), 'changedown-test-fail-next-convert.json');
        // Clear stale state from previous scenarios
        try { fs.unlinkSync(statePath); } catch { /* ignore */ }

        await executeCommandViaBridge(this.page, 'changedown._testFailNextConvert');

        // Poll for the bridge command acknowledgement file
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            await this.page.waitForTimeout(100);
            if (fs.existsSync(statePath)) {
                const raw = fs.readFileSync(statePath, 'utf-8');
                const state = JSON.parse(raw);
                assert.ok(
                    state.ok,
                    `_testFailNextConvert reported failure: ${state.error ?? 'unknown'}`
                );
                return;
            }
        }
        assert.ok(false, '_testFailNextConvert did not write acknowledgement within 5 s');
    }
);

// ── Then: document body contains CriticMarkup delimiters ────────────────────

/**
 * After a failed L3 promotion the controller rolls the buffer back to L2.
 * The document should still contain raw CriticMarkup delimiters such as
 * {++…++}, {--…--}, or {~~…~~}, confirming it is in L2 format.
 *
 * Reads via the auto-synced temp-file IPC (same as getDocumentText) to avoid
 * Monaco renderer staleness after buffer replacement.
 */
Then(
    'the document body contains CriticMarkup delimiters',
    { timeout: 10000 },
    async function (this: ChangeDownWorld) {
        assert.ok(this.page, 'Page not available');

        // CriticMarkup L2 openers: insertion {++ deletion {-- substitution {~~
        const CRITICMARKUP_RE = /\{\+\+|\{--|\{~~/;

        const deadline = Date.now() + 8000;
        let lastText = '';

        while (Date.now() < deadline) {
            const text = await getDocumentText(this.page);
            lastText = text;
            if (CRITICMARKUP_RE.test(text)) {
                return;
            }
            await this.page.waitForTimeout(300);
        }

        assert.ok(
            false,
            `Expected document to contain CriticMarkup delimiters (L2 format) after rollback.\n` +
            `Last document text (first 300 chars):\n${lastText.slice(0, 300)}`
        );
    }
);
