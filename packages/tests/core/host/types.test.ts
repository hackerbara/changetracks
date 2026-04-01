// packages/tests/core/host/types.test.ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from '@changedown/core/host';

describe('EventEmitter', () => {
  it('fires listeners in order', () => {
    const emitter = new EventEmitter<number>();
    const calls: number[] = [];
    emitter.event((n) => calls.push(n * 1));
    emitter.event((n) => calls.push(n * 10));
    emitter.fire(5);
    expect(calls).toEqual([5, 50]);
  });

  it('dispose removes a single listener', () => {
    const emitter = new EventEmitter<string>();
    const calls: string[] = [];
    const sub = emitter.event((s) => calls.push(s));
    emitter.fire('a');
    sub.dispose();
    emitter.fire('b');
    expect(calls).toEqual(['a']);
  });

  it('dispose() on emitter removes all listeners', () => {
    const emitter = new EventEmitter<string>();
    const calls: string[] = [];
    emitter.event((s) => calls.push(s));
    emitter.event((s) => calls.push(s));
    emitter.dispose();
    emitter.fire('x');
    expect(calls).toEqual([]);
  });
});
