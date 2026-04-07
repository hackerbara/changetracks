import * as assert from 'assert';
import { CommentThreadGuard } from '../../features/comment-thread-guard';

suite('CommentThreadGuard', () => {
    let guard: CommentThreadGuard;

    setup(() => {
        guard = new CommentThreadGuard();
    });

    teardown(() => {
        guard.dispose();
    });

    test('is inactive by default', () => {
        assert.strictEqual(guard.isActive(), false);
    });

    test('reports active after setActive(true)', () => {
        guard.setActive(true);
        assert.strictEqual(guard.isActive(), true);
    });

    test('fires onDidDeactivate on active→inactive transition', () => {
        let callCount = 0;
        guard.onDidDeactivate(() => { callCount++; });
        guard.setActive(true);
        assert.strictEqual(callCount, 0);
        guard.setActive(false);
        assert.strictEqual(callCount, 1);
    });

    test('does not fire on redundant setActive(true)', () => {
        let callCount = 0;
        guard.onDidDeactivate(() => { callCount++; });
        guard.setActive(true);
        guard.setActive(true);
        guard.setActive(false);
        assert.strictEqual(callCount, 1);
    });

    test('does not fire on inactive→inactive transition', () => {
        let callCount = 0;
        guard.onDidDeactivate(() => { callCount++; });
        guard.setActive(false);
        assert.strictEqual(callCount, 0);
    });

    test('dispose releases event emitter', () => {
        assert.doesNotThrow(() => guard.dispose());
    });
});
