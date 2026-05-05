import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeDocumentTarget } from '@changedown/mcp/internals';

describe('normalizeDocumentTarget', () => {
  const baseDir = '/Users/example/project';

  it('preserves word session URIs', () => {
    expect(normalizeDocumentTarget('word://sess-abc', baseDir)).toEqual({
      uri: 'word://sess-abc',
      filePath: undefined,
    });
  });

  it('normalizes absolute paths to file URIs and file paths', () => {
    const input = '/Users/example/project/ARCHITECTURE.md';
    expect(normalizeDocumentTarget(input, baseDir)).toEqual({
      uri: pathToFileURL(input).href,
      filePath: input,
    });
  });

  it('resolves relative paths against the base directory', () => {
    const expectedPath = path.resolve(baseDir, 'ARCHITECTURE.md');
    expect(normalizeDocumentTarget('ARCHITECTURE.md', baseDir)).toEqual({
      uri: pathToFileURL(expectedPath).href,
      filePath: expectedPath,
    });
  });

  it('converts file URIs to file paths without treating relative names as hosts', () => {
    const filePath = '/Users/example/project/ARCHITECTURE.md';
    expect(normalizeDocumentTarget(pathToFileURL(filePath).href, baseDir)).toEqual({
      uri: pathToFileURL(filePath).href,
      filePath,
    });
  });
});
