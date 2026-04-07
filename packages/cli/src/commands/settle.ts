import { applyAcceptedChanges, applyRejectedChanges } from '@changedown/core';

export interface SettlementResult {
  currentContent: string;
  appliedCount: number;
}

/**
 * Compacts (removes markup from) accepted and rejected changes.
 * Proposed changes are left untouched.
 *
 * Pipeline:
 * 1. applyAcceptedChanges — removes inline CriticMarkup for accepted changes
 * 2. applyRejectedChanges — removes inline CriticMarkup for rejected changes
 *
 * Both functions preserve footnote definitions and inline refs (Layer 1 settlement).
 *
 * Pure function: no I/O, no side effects.
 */
export function computeSettlement(content: string): SettlementResult {
  const acceptResult = applyAcceptedChanges(content);
  const rejectResult = applyRejectedChanges(acceptResult.currentContent);

  const appliedCount = acceptResult.appliedIds.length + rejectResult.appliedIds.length;

  return {
    currentContent: rejectResult.currentContent,
    appliedCount,
  };
}
