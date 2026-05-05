/**
 * Shared BuiltinView helpers for step definitions.
 */

import type { BuiltinView } from '@changedown/core/host';

/**
 * Cycle order walked by the production `changedown.toggleView` command.
 * Source of truth: `packages/vscode-extension/src/commands/change-commands.ts`
 *
 * This list must stay in lockstep with production; test harness toggle
 * counts depend on identical ordering.
 */
export const BUILTIN_VIEW_CYCLE_ORDER: readonly BuiltinView[] = [
    'working',
    'simple',
    'decided',
    'original',
    'raw',
];

/**
 * Normalize a step-parameter view-name string to a canonical BuiltinView.
 * Accepts canonical BuiltinView names plus legacy aliases used in existing
 * feature files:
 *   - 'all-markup' / 'allMarkup' → 'working' (the default "show all markup" view)
 *   - 'review' → 'working'  (old BuiltinView vocab)
 *   - 'changes' → 'simple'  (old ViewMode vocab)
 *   - 'settled' / 'final' → 'decided' (old ViewMode vocab)
 *   - 'bytes' → 'raw'       (old BuiltinView vocab)
 *
 * Throws on unknown names to surface drift rather than silently defaulting.
 */
export function toBuiltinView(name: string): BuiltinView {
    switch (name) {
        case 'working':
        case 'simple':
        case 'decided':
        case 'original':
        case 'raw':
            return name;
        case 'final':
            return 'decided';
        case 'all-markup':
        case 'allMarkup':
        case 'review':
            return 'working';
        case 'changes':
            return 'simple';
        case 'settled':
            return 'decided';
        case 'bytes':
            return 'raw';
        default:
            throw new Error(
                `Unknown view name: "${name}". Expected a BuiltinView ` +
                `(working, simple, decided, original, raw) or alias ` +
                `(all-markup, review, changes, settled, bytes).`,
            );
    }
}
