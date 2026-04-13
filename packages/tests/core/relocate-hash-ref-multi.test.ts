import { describe, it, expect, beforeAll } from 'vitest';
import { initHashline, relocateHashRefMulti, computeLineHash } from '@changedown/core';
import type { HashStrategy } from '@changedown/core';

describe('relocateHashRefMulti', () => {
  beforeAll(async () => {
    await initHashline();
  });

  it('finds a unique raw-hash match across fileLines', () => {
    const fileLines = ['alpha', 'beta', 'gamma'];
    const targetHash = computeLineHash(1, 'beta', fileLines); // line index 1 (beta)

    const result = relocateHashRefMulti(
      { line: 99, hash: targetHash }, // wrong stated line
      fileLines,
      [{ name: 'raw', fn: (i, line) => computeLineHash(i, line, fileLines) }],
    );

    expect(result).not.toBeNull();
    expect(result!.newLine).toBe(2); // 1-indexed beta position
    expect(result!.strategy).toBe('raw');
  });

  it('returns null when multiple strategies produce different unique matches', () => {
    // Construct a scenario where strategy A matches at line 2 uniquely
    // and strategy B matches at line 5 uniquely — ambiguous across strategies.
    const fileLines = ['a', 'b', 'c', 'd', 'e'];
    const strategies: HashStrategy[] = [
      { name: 'strat-a', fn: (i: number, _line: string) => i === 1 ? 'ab' : 'xx' },
      { name: 'strat-b', fn: (i: number, _line: string) => i === 4 ? 'ab' : 'yy' },
    ];

    const result = relocateHashRefMulti(
      { line: 99, hash: 'ab' },
      fileLines,
      strategies,
    );
    expect(result).toBeNull();
  });

  it('returns null when no strategy finds a unique match', () => {
    const fileLines = ['a', 'b', 'c'];
    const result = relocateHashRefMulti(
      { line: 99, hash: 'zz' },
      fileLines,
      [{ name: 'raw', fn: (i, line) => computeLineHash(i, line, fileLines) }],
    );
    expect(result).toBeNull();
  });
});
