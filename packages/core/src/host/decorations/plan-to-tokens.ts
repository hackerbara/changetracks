// packages/core/src/host/decorations/plan-to-tokens.ts
/**
 * Project a DecorationPlan + ChangeNode[] into LSP semantic-tokens wire format.
 *
 * Visibility comes from the plan (plan-builder is the single source of truth
 * for what is visible in which view). Metadata modifier bits (HasThread,
 * Proposed/Accepted, author slots) come from re-correlating each visible
 * range back to its originating ChangeNode.
 *
 * Pure function. No LSP types leak into core — the return type is a neutral
 * `SemanticTokensData` wrapper.
 */

import type { ChangeNode } from '../../model/types.js';
import { ChangeStatus } from '../../model/types.js';
import type { DecorationPlan, OffsetDecoration } from './types.js';
import { computeLineStarts, offsetToLine } from './helpers.js';

/** 8 custom token types, in index order. Matches LSP protocol. */
export const TOKEN_TYPES = [
  'changedown-insertion',
  'changedown-deletion',
  'changedown-highlight',
  'changedown-comment',
  'changedown-subOriginal',
  'changedown-subModified',
  'changedown-moveFrom',
  'changedown-moveTo',
] as const;

/** 8 token modifier bits, in bit-position order. */
export const TOKEN_MODIFIERS = [
  'modification',
  'deprecated',
  'proposed',
  'accepted',
  'hasThread',
  'authorSlot0',
  'authorSlot1',
  'authorSlot2',
] as const;

export const enum TokenType {
  Insertion = 0,
  Deletion = 1,
  Highlight = 2,
  Comment = 3,
  SubOriginal = 4,
  SubModified = 5,
  MoveFrom = 6,
  MoveTo = 7,
}

export const enum TokenModifier {
  Modification = 1 << 0,
  Deprecated = 1 << 1,
  Proposed = 1 << 2,
  Accepted = 1 << 3,
  HasThread = 1 << 4,
  AuthorSlot0 = 1 << 5,
  AuthorSlot1 = 1 << 6,
  AuthorSlot2 = 1 << 7,
}

export interface SemanticTokensData {
  data: number[];
}

interface Position {
  line: number;
  character: number;
}

function offsetToPosition(lineStarts: number[], offset: number): Position {
  const line = offsetToLine(lineStarts, offset);
  return { line, character: offset - lineStarts[line] };
}

function calculateLength(text: string, start: number, end: number): number {
  if (start >= end) return 0;
  const content = text.substring(start, end);
  if (content.includes('\n')) return 0;  // Multi-line tokens need per-line handling; skip.
  return end - start;
}

/**
 * Compute modifier bits from ChangeNode metadata. Author palette uses
 * first-seen ordering: first author → slot 0, second → slot 1, third → slot 2,
 * then cycles back to slot 0.
 */
function getMetadataModifiers(change: ChangeNode, authorMap: Map<string, number>): number {
  let mods = 0;

  const effectiveStatus = change.metadata?.status ?? change.inlineMetadata?.status ?? change.status;
  if (effectiveStatus === ChangeStatus.Proposed || effectiveStatus === 'proposed') {
    mods |= TokenModifier.Proposed;
  } else if (effectiveStatus === ChangeStatus.Accepted || effectiveStatus === 'accepted') {
    mods |= TokenModifier.Accepted;
  }
  if (change.metadata?.discussion && change.metadata.discussion.length > 0) {
    mods |= TokenModifier.HasThread;
  }
  if (change.consumedBy) {
    mods |= TokenModifier.Deprecated;
  }

  const author = change.metadata?.author ?? change.inlineMetadata?.author;
  if (author) {
    if (!authorMap.has(author)) {
      authorMap.set(author, authorMap.size);
    }
    const slot = authorMap.get(author)! % 3;
    if (slot === 0) mods |= TokenModifier.AuthorSlot0;
    else if (slot === 1) mods |= TokenModifier.AuthorSlot1;
    else mods |= TokenModifier.AuthorSlot2;
  }

  return mods;
}

/**
 * Find the ChangeNode whose full range covers the given decoration's range.
 * Used to re-correlate a plan entry back to its metadata source.
 */
function findChangeForRange(
  decoration: OffsetDecoration,
  changes: readonly ChangeNode[],
): ChangeNode | undefined {
  const s = decoration.range.start;
  const e = decoration.range.end;
  return changes.find(c =>
    c.range.start <= s && s <= c.range.end && c.range.start <= e && e <= c.range.end
  );
}

interface CategoryWalk {
  entries: readonly OffsetDecoration[];
  tokenType: TokenType;
  /** Additional modifier bits always set for this category (e.g., Modification for insertions). */
  extraMods: number;
}

/**
 * Project a DecorationPlan into semantic tokens.
 */
export function planToSemanticTokens(
  plan: DecorationPlan,
  changes: readonly ChangeNode[],
  text: string,
): SemanticTokensData {
  const data: number[] = [];
  const authorMap = new Map<string, number>();
  const lineStarts = computeLineStarts(text);
  let previousPosition: Position = { line: 0, character: 0 };

  const categories: CategoryWalk[] = [
    { entries: plan.insertions, tokenType: TokenType.Insertion, extraMods: TokenModifier.Modification },
    { entries: plan.deletions, tokenType: TokenType.Deletion, extraMods: TokenModifier.Deprecated },
    { entries: plan.substitutionOriginals, tokenType: TokenType.SubOriginal, extraMods: TokenModifier.Deprecated },
    { entries: plan.substitutionModifieds, tokenType: TokenType.SubModified, extraMods: TokenModifier.Modification },
    { entries: plan.highlights, tokenType: TokenType.Highlight, extraMods: 0 },
    { entries: plan.comments, tokenType: TokenType.Comment, extraMods: 0 },
    { entries: plan.moveFroms, tokenType: TokenType.MoveFrom, extraMods: TokenModifier.Deprecated },
    { entries: plan.moveTos, tokenType: TokenType.MoveTo, extraMods: TokenModifier.Modification },
  ];

  // Also walk authorDecorations — same category mapping by role name.
  for (const [, authorEntry] of plan.authorDecorations) {
    const role = authorEntry.role;
    let tokenType: TokenType;
    let extraMods: number;
    switch (role) {
      case 'insertion': tokenType = TokenType.Insertion; extraMods = TokenModifier.Modification; break;
      case 'deletion': tokenType = TokenType.Deletion; extraMods = TokenModifier.Deprecated; break;
      case 'substitution-original': tokenType = TokenType.SubOriginal; extraMods = TokenModifier.Deprecated; break;
      case 'substitution-modified': tokenType = TokenType.SubModified; extraMods = TokenModifier.Modification; break;
      case 'move-from': tokenType = TokenType.MoveFrom; extraMods = TokenModifier.Deprecated; break;
      case 'move-to': tokenType = TokenType.MoveTo; extraMods = TokenModifier.Modification; break;
      default: continue;
    }
    categories.push({ entries: authorEntry.ranges, tokenType, extraMods });
  }

  interface SortedEntry {
    decoration: OffsetDecoration;
    tokenType: TokenType;
    extraMods: number;
  }
  const sorted: SortedEntry[] = [];
  for (const cat of categories) {
    for (const entry of cat.entries) {
      sorted.push({ decoration: entry, tokenType: cat.tokenType, extraMods: cat.extraMods });
    }
  }
  sorted.sort((a, b) => a.decoration.range.start - b.decoration.range.start);

  for (const entry of sorted) {
    const { decoration, tokenType, extraMods } = entry;
    const length = calculateLength(text, decoration.range.start, decoration.range.end);
    if (length === 0) continue;

    const change = findChangeForRange(decoration, changes);
    const metadataMods = change ? getMetadataModifiers(change, authorMap) : 0;
    const modifiers = extraMods | metadataMods;

    const position = offsetToPosition(lineStarts, decoration.range.start);
    const deltaLine = position.line - previousPosition.line;
    const deltaStartChar = deltaLine === 0
      ? position.character - previousPosition.character
      : position.character;

    data.push(deltaLine, deltaStartChar, length, tokenType, modifiers);
    previousPosition = position;
  }

  return { data };
}
