import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionManager } from '@changedown/mcp/internals';

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager({ maxQueuedNotificationsPerSession: 3 });
  });

  it('subscribe registers interest; unsubscribe removes it', () => {
    manager.subscribe('session-A', 'word://sess-x');
    expect(manager.subscribersFor('word://sess-x')).toContain('session-A');

    manager.unsubscribe('session-A', 'word://sess-x');
    expect(manager.subscribersFor('word://sess-x')).not.toContain('session-A');
  });

  it('fan-out: three subscribed sessions all receive the notification', () => {
    const sinks: Array<{ sessionId: string; uri: string }> = [];
    manager.subscribe('session-A', 'word://sess-x');
    manager.subscribe('session-B', 'word://sess-x');
    manager.subscribe('session-C', 'word://sess-x');

    manager.fanOut('word://sess-x', (sessionId, notification) => {
      sinks.push({ sessionId, uri: notification.params.uri });
    });

    expect(sinks).toHaveLength(3);
    expect(sinks.map((s) => s.sessionId).sort()).toEqual(['session-A', 'session-B', 'session-C']);
    expect(sinks[0]!.uri).toBe('word://sess-x');
  });

  it('fan-out includes backend document version when supplied', () => {
    const versions: Array<string | undefined> = [];
    manager.subscribe('session-A', 'word://sess-x');

    manager.fanOut('word://sess-x', (_sessionId, notification) => {
      versions.push(notification.params.version);
    }, '42');

    expect(versions).toEqual(['42']);
  });

  it('fan-out: only subscribed sessions receive the notification; others do not', () => {
    const received = new Set<string>();
    manager.subscribe('session-A', 'word://sess-x');
    // session-B is NOT subscribed

    manager.fanOut('word://sess-x', (sessionId) => {
      received.add(sessionId);
    });

    expect(received.has('session-A')).toBe(true);
    expect(received.has('session-B')).toBe(false);
  });

  it('backpressure: when queue is full, oldest notification is dropped', () => {
    const dropped: string[] = [];
    manager.subscribe('session-slow', 'word://sess-x');
    manager.onDrop((sessionId, notification) => {
      dropped.push(`${sessionId}:${notification.params.uri}`);
    });

    // Simulate a session that is paused (its send buffer is "full")
    manager.markSessionPaused('session-slow');

    // Queue 4 notifications but max is 3 — oldest should be dropped
    for (let i = 0; i < 4; i++) {
      manager.enqueue('session-slow', {
        method: 'notifications/resources/updated',
        params: { uri: `word://sess-x`, version: `v${i}` },
      });
    }

    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain('session-slow');
  });

  it('unsubscribing all sessions for a URI leaves empty subscriber list', () => {
    manager.subscribe('session-A', 'word://sess-x');
    manager.subscribe('session-B', 'word://sess-x');
    manager.unsubscribe('session-A', 'word://sess-x');
    manager.unsubscribe('session-B', 'word://sess-x');
    expect(manager.subscribersFor('word://sess-x')).toHaveLength(0);
  });

  it('removeSession purges all subscriptions for a disconnected session', () => {
    manager.subscribe('session-A', 'word://sess-x');
    manager.subscribe('session-A', 'file:///tmp/doc.md');
    manager.removeSession('session-A');
    expect(manager.subscribersFor('word://sess-x')).not.toContain('session-A');
    expect(manager.subscribersFor('file:///tmp/doc.md')).not.toContain('session-A');
  });
});

// Separate test suite for the singleton backend-listener dedup (Defect 11 guard):
// These tests verify the *pattern* the controller in index.ts uses for dedup, not
// the controller directly — they reconstruct the uriBackendSubscriptions map inline.
// If dedup logic were ever moved into SubscriptionManager itself, revise these tests.
describe('SubscriptionManager — singleton backend listener dedup', () => {
  it('subscribing N sessions to one URI calls backend.subscribe exactly once', () => {
    const backendSubscribeSpy = vi.fn().mockReturnValue(() => {});
    const uriBackendSubscriptions = new Map<string, () => void>();

    function subscribeSession(sessionId: string, uri: string, manager: SubscriptionManager): void {
      manager.subscribe(sessionId, uri);
      if (!uriBackendSubscriptions.has(uri)) {
        const unsubscribe = backendSubscribeSpy(uri) as () => void;
        uriBackendSubscriptions.set(uri, unsubscribe);
      }
    }

    const manager = new SubscriptionManager({});
    subscribeSession('session-A', 'word://sess-x', manager);
    subscribeSession('session-B', 'word://sess-x', manager);
    subscribeSession('session-C', 'word://sess-x', manager);

    expect(backendSubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing all N sessions tears down the singleton listener exactly once', () => {
    const unsubscribeSpy = vi.fn();
    const backendSubscribeSpy = vi.fn().mockReturnValue(unsubscribeSpy);
    const uriBackendSubscriptions = new Map<string, () => void>();

    const manager = new SubscriptionManager({});
    const uri = 'word://sess-x';

    for (const sid of ['session-A', 'session-B']) {
      manager.subscribe(sid, uri);
      if (!uriBackendSubscriptions.has(uri)) {
        uriBackendSubscriptions.set(uri, backendSubscribeSpy(uri) as () => void);
      }
    }

    for (const sid of ['session-A', 'session-B']) {
      manager.unsubscribe(sid, uri);
      if (manager.subscribersFor(uri).length === 0) {
        uriBackendSubscriptions.get(uri)?.();
        uriBackendSubscriptions.delete(uri);
      }
    }

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(uriBackendSubscriptions.has(uri)).toBe(false);
  });
});
