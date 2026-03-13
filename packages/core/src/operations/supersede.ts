/**
 * Pure computation for superseding a proposed change.
 *
 * Extracted from packages/cli/src/engine/handlers/supersede-change.ts (Task 1D).
 * Atomically rejects the original change and proposes a replacement,
 * linking them via `supersedes:` and `superseded-by:` cross-references.
 *
 * No file I/O, no config resolution, no settlement (that's a policy decision).
 */

import { findFootnoteBlock, parseFootnoteHeader } from '../footnote-utils.js';
import { applyReview, type Decision } from './apply-review.js';
import { applyProposeChange } from '../file-ops.js';
import { scanMaxCtId } from './footnote-generator.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SupersedeOptions {
  /** Replacement text for the new change. */
  newText: string;
  /** Text to replace (targets the document after rejection). Empty for insertion-style supersede. */
  oldText?: string;
  /** Why this change supersedes the old one. */
  reason?: string;
  /** Who is making the supersede. */
  author: string;
  /** Anchor for insertions (when oldText is empty). */
  insertAfter?: string;
}

export interface SupersedeSuccess {
  isError: false;
  /** The full document text after supersede operations. */
  text: string;
  /** The newly allocated change ID (e.g. "ct-2"). */
  newChangeId: string;
  /** The original change ID that was superseded. */
  originalChangeId: string;
}

export interface SupersedeError {
  isError: true;
  error: string;
}

export type SupersedeResult = SupersedeSuccess | SupersedeError;

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Computes the result of superseding a proposed change.
 *
 * Pure function: no I/O. Takes the full file text and returns the
 * rewritten text with:
 * 1. Original change rejected (status → rejected, rejection line added)
 * 2. New replacement change proposed at the same location
 * 3. Cross-references: `supersedes: ct-N` in new footnote,
 *    `superseded-by: ct-M` in original footnote
 *
 * Constraints enforced:
 * - Only `proposed` changes can be superseded
 */
export function computeSupersedeResult(
  text: string,
  changeId: string,
  opts: SupersedeOptions,
): SupersedeResult {
  const { newText, oldText = '', reason, author, insertAfter } = opts;

  // --- 1. Validate: find change, check status, check different-author ---
  const lines = text.split('\n');
  const block = findFootnoteBlock(lines, changeId);
  if (!block) {
    return { isError: true, error: `Change "${changeId}" not found in file.` };
  }

  const header = parseFootnoteHeader(lines[block.headerLine]);
  if (!header) {
    return {
      isError: true,
      error: `Malformed metadata for change "${changeId}". Expected format: @author | date | type | status`,
    };
  }

  if (header.status === 'accepted') {
    return {
      isError: true,
      error: `Cannot supersede change "${changeId}": it is already accepted. Only proposed changes can be superseded.`,
    };
  }
  if (header.status === 'rejected') {
    return {
      isError: true,
      error: `Cannot supersede change "${changeId}": it is already rejected. Only proposed changes can be superseded.`,
    };
  }
  if (header.status !== 'proposed') {
    return {
      isError: true,
      error: `Cannot supersede change "${changeId}": unexpected status "${header.status}". Only proposed changes can be superseded.`,
    };
  }

  // Same-author guard: supersede is for different authors. Use amend for own changes.
  const normalizedAuthor = author.startsWith('@') ? author.slice(1) : author;
  if (header.author === normalizedAuthor) {
    return {
      isError: true,
      error: `Cannot supersede change "${changeId}": authored by the same author (${author}). Use amend_change to modify your own changes.`,
    };
  }

  // --- 2. Reject the original change ---
  const rejectResult = applyReview(
    text,
    changeId,
    'reject' as Decision,
    reason ?? 'Superseded by new change',
    author,
  );

  if ('error' in rejectResult) {
    return { isError: true, error: `Failed to reject old change: ${rejectResult.error}` };
  }

  let fileContent = rejectResult.updatedContent;

  // --- 3. Allocate next ID ---
  const maxId = scanMaxCtId(fileContent);
  const newChangeId = `ct-${maxId + 1}`;

  // --- 4. Create replacement change via applyProposeChange ---
  // Determine oldText for propose: if caller provided oldText, use it.
  // If empty and no insertAfter, we need to target something. The handler
  // uses the caller's old_text/new_text, so we pass through.
  const proposeOldText = oldText;
  const proposeResult = applyProposeChange({
    text: fileContent,
    oldText: proposeOldText,
    newText,
    changeId: newChangeId,
    author,
    reasoning: reason,
    insertAfter,
  });
  fileContent = proposeResult.modifiedText;

  // --- 5. Add `supersedes: ct-N` to the new change's footnote ---
  const modifiedLines = fileContent.split('\n');
  const newBlock = findFootnoteBlock(modifiedLines, newChangeId);
  if (newBlock) {
    const supersedesLine = `    supersedes: ${changeId}`;
    modifiedLines.splice(newBlock.headerLine + 1, 0, supersedesLine);
    fileContent = modifiedLines.join('\n');
  }

  // --- 6. Add `superseded-by: ct-M` to the original change's footnote ---
  const updatedLines = fileContent.split('\n');
  const origBlock = findFootnoteBlock(updatedLines, changeId);
  if (origBlock) {
    const supersededByLine = `    superseded-by: ${newChangeId}`;
    // Insert after the header line (before any existing content lines)
    updatedLines.splice(origBlock.headerLine + 1, 0, supersededByLine);
    fileContent = updatedLines.join('\n');
  }

  return {
    isError: false,
    text: fileContent,
    newChangeId,
    originalChangeId: changeId,
  };
}
