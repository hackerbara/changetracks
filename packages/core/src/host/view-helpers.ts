/**
 * Typed view helpers for per-change and per-type visibility.
 */

import { ChangeType, ChangeStatus } from '../model/types.js';
import type { ChangeNode } from '../model/types.js';
import type { BuiltinView, View } from './types.js';

/**
 * Map from any known view name (canonical or legacy alias) to its canonical
 * BuiltinView value. Used by resolveView() — the single source of truth for
 * view name resolution shared by CLI, LSP, config loader, and MCP handler.
 */
const VIEW_KNOWN_NAMES = new Map<string, BuiltinView>([
  // Canonical (identity)
  ['working', 'working'],
  ['simple', 'simple'],
  ['decided', 'decided'],
  ['original', 'original'],
  ['raw', 'raw'],
  // Legacy config compat (silent normalization)
  ['review', 'working'],
  ['bytes', 'raw'],
  ['changes', 'simple'],
  ['final', 'decided'],
  ['settled', 'decided'],
  // Legacy MCP aliases
  ['full', 'raw'],
  ['all', 'working'],
  ['content', 'raw'],
  ['meta', 'working'],
  ['committed', 'simple'],
  // VS Code settings compat
  ['all-markup', 'working'],
  ['markup', 'working'],
]);

/**
 * Resolve any known view name to its canonical BuiltinView.
 * Returns null for unknown names — caller decides error behavior.
 *
 * This is the single source of truth for view name resolution, shared by the
 * CLI, LSP server, config loader, and MCP handler.
 */
export function resolveView(input: string): BuiltinView | null {
  return VIEW_KNOWN_NAMES.get(input) ?? null;
}

/**
 * Human-readable label strings for each BuiltinView preset.
 * Used by status bars, command palettes, and any UI that displays the
 * active view name to the user.
 */
export const VIEW_LABELS: Record<BuiltinView, string> = {
  working: 'Working',
  simple: 'Simple',
  decided: 'Decided',
  original: 'Original',
  raw: 'Raw',
};

/**
 * Per-change-type visibility given the view's display options.
 *
 * Substitutions are visible if EITHER insertions OR deletions are visible —
 * a substitution is logically both.
 */
export function isTypeVisibleInView(type: ChangeType, view: View): boolean {
  const d = view.display;
  switch (type) {
    case ChangeType.Insertion:
      return d.insertions !== 'hide';
    case ChangeType.Deletion:
      return d.deletions !== 'hide';
    case ChangeType.Substitution:
      return d.substitutions !== 'hide' || d.insertions !== 'hide';
    case ChangeType.Highlight:
      return d.highlights !== 'hide';
    case ChangeType.Comment:
      return d.comments !== 'hide';
    case ChangeType.Move:
      // Move spans both halves (from = deletion-like, to = insertion-like) — visible
      // if either side is shown. Mirrors Substitution's pattern.
      return d.insertions !== 'hide' || d.deletions !== 'hide';
  }
}

/**
 * Should a change be visible given a view's projection + display policy?
 *
 * Rules:
 * - Decided changes are hidden when delimiters are hidden.
 * - In projected views (decided / original / none), accepted and rejected
 *   changes are already baked into/out of the text — only proposed changes
 *   remain visible.
 * - In current-projection views, visibility delegates to type-visibility.
 */
export function isChangeVisibleInView(change: ChangeNode, view: View): boolean {
  // Decided changes hidden when delimiters are hidden — matches old behavior.
  if (change.decided && view.display.delimiters !== 'show') return false;

  // In projected views, accepted and rejected changes are baked into text —
  // neither should render as a decoration.
  if (view.projection !== 'current' && change.status !== ChangeStatus.Proposed) {
    return false;
  }

  // Otherwise, type-visibility rules.
  return isTypeVisibleInView(change.type, view);
}
