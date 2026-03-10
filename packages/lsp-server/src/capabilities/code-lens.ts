/**
 * Code Lens Capability
 *
 * Provides inline action buttons for CriticMarkup changes.
 * Shows "Accept" and "Reject" buttons above each change,
 * plus document-level "Accept All" and "Reject All" at the top.
 */

import { CodeLens, Command, Range } from 'vscode-languageserver';
import { ChangeNode, ChangeStatus } from '@changetracks/core';
import type { ViewName } from '@changetracks/core';
import { offsetToPosition } from '../converters';

/**
 * Create code lenses for CriticMarkup changes
 *
 * @param changes Array of change nodes from parser
 * @param text Full document text (needed for offset-to-position conversion)
 * @param viewMode Current view mode — CodeLens is suppressed in settled/raw (clean preview)
 * @returns Array of CodeLens objects
 */
export function createCodeLenses(changes: ChangeNode[], text: string, viewMode?: ViewName): CodeLens[] {
  // No CodeLens in clean preview modes (Final / Original)
  if (viewMode === 'settled' || viewMode === 'raw') {
    return [];
  }

  const lenses: CodeLens[] = [];

  // Filter to only actionable (proposed, unsettled) changes
  const actionable = changes.filter(c => !c.settled && c.status === ChangeStatus.Proposed);

  // If no actionable changes, return empty array
  if (actionable.length === 0) {
    return lenses;
  }

  // Create document-level lenses at line 0
  const changeCount = actionable.length;
  const changeWord = changeCount === 1 ? 'change' : 'changes';

  const acceptAllLens: CodeLens = {
    range: Range.create(0, 0, 0, 0),
    command: Command.create(
      `Accept All (${changeCount} ${changeWord})`,
      'changetracks.acceptAll'
    )
  };

  const rejectAllLens: CodeLens = {
    range: Range.create(0, 0, 0, 0),
    command: Command.create(
      `Reject All (${changeCount} ${changeWord})`,
      'changetracks.rejectAll'
    )
  };

  lenses.push(acceptAllLens, rejectAllLens);

  // Create per-change lenses (only for actionable changes)
  for (const change of actionable) {
    // Position lens at the start of the change range
    const position = offsetToPosition(text, change.range.start);
    const lensRange = Range.create(position, position);

    // Build lifecycle indicator suffix
    const indicator = buildLifecycleIndicator(change);
    const suffix = indicator ? ` ${indicator}` : '';

    // Accept lens
    const acceptLens: CodeLens = {
      range: lensRange,
      command: Command.create(
        `Accept${suffix}`,
        'changetracks.acceptChange',
        change.id
      )
    };

    // Reject lens
    const rejectLens: CodeLens = {
      range: lensRange,
      command: Command.create(
        `Reject${suffix}`,
        'changetracks.rejectChange',
        change.id
      )
    };

    lenses.push(acceptLens, rejectLens);
  }

  return lenses;
}

/**
 * Build a lifecycle state indicator string for a change.
 * Shows discussion count, request-changes warning, amendment indicator.
 * Resolved threads suppress the discussion indicator.
 */
export function buildLifecycleIndicator(change: ChangeNode): string {
  const meta = change.metadata;
  if (!meta) return '';

  const parts: string[] = [];

  // Discussion count (suppressed when thread is resolved)
  const isResolved = meta.resolution?.type === 'resolved';
  if (!isResolved && meta.discussion && meta.discussion.length > 0) {
    parts.push(`💬 ${meta.discussion.length}`);
  }

  // Request-changes warning
  if (meta.requestChanges && meta.requestChanges.length > 0) {
    parts.push('⚠');
  }

  // Amendment/revision indicator (only revisions: block format, not standalone revised lines)
  const hasRevisions = meta.revisions && meta.revisions.length > 0;
  if (hasRevisions) {
    parts.push('✎');
  }

  return parts.join(' ');
}
