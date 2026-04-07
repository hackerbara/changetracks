/**
 * View mode types and helpers for the VS Code extension.
 *
 * Canonical definitions (ViewMode, VIEW_MODES, VIEW_MODE_LABELS,
 * nextViewMode, resolveViewMode) live in @changedown/core. This module
 * re-exports them plus extension-specific helpers that don't belong in core.
 */

import type { ChangeNode, ViewMode } from '@changedown/core';
export type { ViewMode } from '@changedown/core';
export { VIEW_MODES, VIEW_MODE_LABELS, VIEW_MODE_ALIASES, nextViewMode, resolveViewMode } from '@changedown/core';
import { isTypeVisibleInMode } from '@changedown/core/host';
import type { BuiltinView } from '@changedown/core/host';

export const VIEW_LABELS: Record<BuiltinView, string> = {
    review: 'Review',
    simple: 'Simple',
    final: 'Final',
    original: 'Original',
    raw: 'Raw',
};

/**
 * Determine whether a change is user-visible in a given view mode.
 * Used by the navigation manager to filter navigable changes.
 *
 * Delegates to core's isTypeVisibleInMode for type-based visibility,
 * plus extension-specific showDelimiters gating for settled refs.
 */
export function isChangeVisibleInMode(
    change: ChangeNode,
    viewMode: ViewMode,
    showDelimiters: boolean,
): boolean {
    // Settled refs: visible only when showDelimiters is on
    if (change.decided && !showDelimiters) return false;
    return isTypeVisibleInMode(change.type, viewMode);
}
