import { Location, Position } from 'vscode-languageserver/node';
import type { ChangeNode } from '@changedown/core';

/**
 * Find the change node at a given offset, and return the location
 * of its footnote definition if one exists.
 */
export function getDefinitionForOffset(
  uri: string,
  offset: number,
  changes: ChangeNode[],
): Location | null {
  for (const change of changes) {
    const range = change.contentRange ?? change.range;
    if (offset < range.start || offset > range.end) continue;

    if (change.footnoteLineRange) {
      const startLine = change.footnoteLineRange.startLine;
      return Location.create(uri, {
        start: Position.create(startLine, 0),
        end: Position.create(startLine, 0),
      });
    }
  }
  return null;
}
