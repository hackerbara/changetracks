import * as assert from 'assert';
import { MoveTracker } from '../../features/move-tracker';

suite('MoveTracker', () => {
    const BASE_TIME = 1_000_000;

    test('records cut text — hasPendingCut() is true after prepareCut', () => {
        const tracker = new MoveTracker(() => {}, 60_000, () => BASE_TIME);
        tracker.prepareCut('hello world');
        assert.strictEqual(tracker.hasPendingCut(), true);
    });

    test('sends moveMetadata on paste within timeout', () => {
        const calls: Array<{ uri: string; cutText: string }> = [];
        const send = (uri: string, cutText: string) => calls.push({ uri, cutText });

        let t = BASE_TIME;
        const tracker = new MoveTracker(send, 60_000, () => t);

        tracker.prepareCut('moved text');
        t += 30_000; // 30s — within 60s timeout
        tracker.preparePaste('file:///doc.md');

        assert.strictEqual(calls.length, 1);
        assert.deepStrictEqual(calls[0], { uri: 'file:///doc.md', cutText: 'moved text' });
    });

    test('clears pending cut after preparePaste', () => {
        const tracker = new MoveTracker(() => {}, 60_000, () => BASE_TIME);
        tracker.prepareCut('hello');
        tracker.preparePaste('file:///doc.md');
        assert.strictEqual(tracker.hasPendingCut(), false);
    });

    test('does not send moveMetadata after timeout expires', () => {
        const calls: Array<{ uri: string; cutText: string }> = [];
        const send = (uri: string, cutText: string) => calls.push({ uri, cutText });

        let t = BASE_TIME;
        const tracker = new MoveTracker(send, 60_000, () => t);

        tracker.prepareCut('stale text');
        t += 60_001; // 1ms past the 60s timeout
        tracker.preparePaste('file:///doc.md');

        assert.strictEqual(calls.length, 0);
        assert.strictEqual(tracker.hasPendingCut(), false);
    });

    test('only sends once per cut — second preparePaste is a no-op', () => {
        const calls: Array<{ uri: string; cutText: string }> = [];
        const send = (uri: string, cutText: string) => calls.push({ uri, cutText });

        const tracker = new MoveTracker(send, 60_000, () => BASE_TIME);
        tracker.prepareCut('text');
        tracker.preparePaste('file:///doc.md');
        tracker.preparePaste('file:///doc.md'); // second call — cut already cleared

        assert.strictEqual(calls.length, 1);
    });

    test('no-op preparePaste with no pending cut', () => {
        const calls: Array<{ uri: string; cutText: string }> = [];
        const send = (uri: string, cutText: string) => calls.push({ uri, cutText });

        const tracker = new MoveTracker(send, 60_000, () => BASE_TIME);
        tracker.preparePaste('file:///doc.md'); // no prior cut

        assert.strictEqual(calls.length, 0);
    });

    test('sends moveMetadata at exact timeout boundary (inclusive)', () => {
        const calls: Array<{ uri: string; cutText: string }> = [];
        const send = (uri: string, cutText: string) => calls.push({ uri, cutText });

        let t = BASE_TIME;
        const tracker = new MoveTracker(send, 60_000, () => t);

        tracker.prepareCut('some text');
        t += 60_000; // exactly at boundary — elapsed === timeoutMs, strict > means still fires
        tracker.preparePaste('file:///a.md');

        assert.strictEqual(calls.length, 1);
    });
});
