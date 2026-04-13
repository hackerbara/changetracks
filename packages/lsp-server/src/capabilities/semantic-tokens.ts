/**
 * Semantic Tokens Capability
 *
 * Thin shim over core's plan-builder. Post-Shift-5 (2026-04-09 cleanup),
 * view-mode visibility filtering lives in exactly one place — the plan
 * builder — and token generation is derived from the plan.
 *
 * See docs/superpowers/specs/2026-04-09-vscode-sdk-consumer-cleanup-design-v2.md §3 Shift 5.
 */

import { SemanticTokens, SemanticTokensLegend } from 'vscode-languageserver/node';
import type { ChangeNode } from '@changedown/core';
import {
  buildDecorationPlan,
  planToSemanticTokens,
  NO_CURSOR,
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  VIEW_PRESETS,
  type BuiltinView,
} from '@changedown/core/host';

/**
 * Get the semantic tokens legend.
 *
 * Declares the token types and modifiers used by the server. Must be
 * declared in server capabilities during initialization.
 */
export function getSemanticTokensLegend(): SemanticTokensLegend {
  return {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [...TOKEN_MODIFIERS],
  };
}

/**
 * Build semantic tokens for a document.
 *
 * Delegates to plan-builder and derives tokens from the resulting plan.
 * The plan's projection branches own all view-mode filtering logic.
 *
 * @param changes   Parsed change nodes
 * @param text      Document text
 * @param viewMode  Active view preset (defaults to review)
 * @returns         LSP SemanticTokens
 */
export function buildSemanticTokens(
  changes: ChangeNode[],
  text: string,
  viewMode: BuiltinView = 'working',
): SemanticTokens {
  const view = VIEW_PRESETS[viewMode];
  const plan = buildDecorationPlan(changes, text, view, NO_CURSOR);
  const { data } = planToSemanticTokens(plan, changes, text);
  return { data };
}
