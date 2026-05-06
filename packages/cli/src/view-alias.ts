/**
 * Canonical view vocabulary and resolution.
 *
 * One function, one map, one truth. All code paths that accept a view name
 * string call resolveView(). Legacy names (from config files on disk, old
 * MCP sessions, VS Code settings) are silently normalized to canonical
 * BuiltinView values.
 *
 * resolveView is defined in @changedown/core/host so it can be shared with
 * the LSP server (which cannot depend on the CLI package).
 */

export { resolveView } from '@changedown/core/host';

/** The canonical list of BuiltinView names, for help text and schema enums. */
import type { BuiltinView } from '@changedown/core/host';
export const CANONICAL_VIEWS: BuiltinView[] = ['working', 'simple', 'decided', 'original', 'raw'];
export const READ_VIEWS: Array<Exclude<BuiltinView, 'original'>> = ['working', 'simple', 'decided', 'raw'];
