import { TextEdit } from '../model/types.js';
import { findFootnoteBlock } from '../footnote-utils.js';
import { nowTimestamp } from '../timestamp.js';

export interface ResolutionOptions {
  author: string;
  date?: string;
}

/**
 * Returns a TextEdit that appends a `resolved: @author date` line at the end
 * of the footnote block for the given change ID.
 *
 * The resolved line is placed after all existing content (metadata, discussion,
 * approval lines) as the final entry in the footnote block.
 *
 * Returns null if no footnote block is found for the given change ID.
 */
export function computeResolutionEdit(
  text: string,
  changeId: string,
  opts: ResolutionOptions
): TextEdit | null {
  const lines = text.split('\n');
  const block = findFootnoteBlock(lines, changeId);
  if (!block) return null;

  const date = opts.date ?? nowTimestamp().raw;
  const author = opts.author.startsWith('@') ? opts.author : `@${opts.author}`;
  const line = `    resolved: ${author} ${date}`;

  const offset = lines
    .slice(0, block.blockEnd + 1)
    .join('\n')
    .length;
  return { offset, length: 0, newText: '\n' + line };
}

/**
 * Returns a TextEdit that removes the `resolved:` line from the footnote block
 * for the given change ID.
 *
 * Returns null if no footnote block is found or if the block has no resolved line.
 */
export function computeUnresolveEdit(
  text: string,
  changeId: string
): TextEdit | null {
  const lines = text.split('\n');
  const block = findFootnoteBlock(lines, changeId);
  if (!block) return null;

  // Find the resolved line within this footnote block
  for (let i = block.headerLine + 1; i <= block.blockEnd; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('resolved:') || trimmed.startsWith('resolved ')) {
      // Calculate offset of this line (including the preceding newline)
      const linesBefore = lines.slice(0, i).join('\n');
      const lineOffset = linesBefore.length; // offset of the \n before this line
      const lineLength = lines[i].length + 1; // +1 for the \n preceding it
      return { offset: lineOffset, length: lineLength, newText: '' };
    }
  }

  return null;
}
