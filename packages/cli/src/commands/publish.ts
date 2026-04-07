import { computeCurrentText } from '@changedown/core';

/**
 * Produces clean text with all changes applied (accept-all semantics).
 * Strips all CriticMarkup, footnote definitions, and footnote refs.
 *
 * This is a thin wrapper around core's computeCurrentText.
 * Pure function: no I/O, no side effects.
 */
export function publishSettled(content: string): string {
  return computeCurrentText(content);
}
