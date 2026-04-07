import { applyReview } from '../../operations/apply-review.js';
import { computeAmendEdits } from '../../operations/amend.js';
import { computeSupersedeResult } from '../../operations/supersede.js';
import { computeResolutionEdit } from '../../operations/resolution.js';
import { applyAcceptedChanges, applyRejectedChanges } from '../../operations/current-text.js';
import { parseForFormat } from '../../format-aware-parse.js';
import { ChangeStatus } from '../../model/types.js';
import { EventEmitter } from '../types.js';
import type { SettlementConfig, Disposable, Event } from '../types.js';

export interface ReviewOperationResult {
  updatedText: string;
  affectedChangeIds: string[];
  error?: string;
}

export class ReviewService implements Disposable {
  private readonly _onDidCompleteReview = new EventEmitter<ReviewOperationResult>();
  readonly onDidCompleteReview: Event<ReviewOperationResult> = this._onDidCompleteReview.event;

  private readonly _onReviewError = new EventEmitter<{ error: string }>();
  readonly onReviewError: Event<{ error: string }> = this._onReviewError.event;

  constructor(private readonly config?: { settlement?: SettlementConfig }) {}

  acceptChange(text: string, changeId: string, author: string): ReviewOperationResult {
    return this.executeReview(text, changeId, 'approve', author);
  }

  rejectChange(text: string, changeId: string, author: string): ReviewOperationResult {
    return this.executeReview(text, changeId, 'reject', author);
  }

  acceptAll(text: string, changeIds?: string[], author?: string): ReviewOperationResult {
    return this.executeBatchReview(text, 'approve', changeIds, author);
  }

  rejectAll(text: string, changeIds?: string[], author?: string): ReviewOperationResult {
    return this.executeBatchReview(text, 'reject', changeIds, author);
  }

  async amendChange(text: string, changeId: string, newOp: string, author: string): Promise<ReviewOperationResult> {
    const result = computeAmendEdits(text, changeId, { newText: newOp, author });
    if (result.isError) {
      const errorResult: ReviewOperationResult = { updatedText: text, affectedChangeIds: [], error: result.error };
      this._onReviewError.fire({ error: result.error });
      return errorResult;
    }
    const successResult: ReviewOperationResult = {
      updatedText: result.text,
      affectedChangeIds: [changeId],
    };
    this._onDidCompleteReview.fire(successResult);
    return successResult;
  }

  async supersedeChange(text: string, changeId: string, newOp: string, author: string): Promise<ReviewOperationResult> {
    const result = await computeSupersedeResult(text, changeId, { newText: newOp, author });
    if (result.isError) {
      const errorResult: ReviewOperationResult = { updatedText: text, affectedChangeIds: [], error: result.error };
      this._onReviewError.fire({ error: result.error });
      return errorResult;
    }
    let finalText = result.text;
    // Superseding rejects the original — auto-settle if configured
    if (this.config?.settlement?.autoOnReject) {
      const settled = applyRejectedChanges(finalText);
      finalText = settled.currentContent;
    }
    const successResult: ReviewOperationResult = {
      updatedText: finalText,
      affectedChangeIds: [result.originalChangeId, result.newChangeId],
    };
    this._onDidCompleteReview.fire(successResult);
    return successResult;
  }

  resolveThread(text: string, changeId: string, author: string): ReviewOperationResult {
    const edit = computeResolutionEdit(text, changeId, { author });
    if (!edit) {
      const errorResult: ReviewOperationResult = {
        updatedText: text,
        affectedChangeIds: [],
        error: `Change "${changeId}" not found in file.`,
      };
      this._onReviewError.fire({ error: errorResult.error! });
      return errorResult;
    }
    const updatedText = text.slice(0, edit.offset) + edit.newText + text.slice(edit.offset + edit.length);
    const successResult: ReviewOperationResult = {
      updatedText,
      affectedChangeIds: [changeId],
    };
    this._onDidCompleteReview.fire(successResult);
    return successResult;
  }

  dispose(): void {
    this._onDidCompleteReview.dispose();
    this._onReviewError.dispose();
  }

  // ── Private ──────────────────────────────────────────────────

  private executeReview(
    text: string,
    changeId: string,
    decision: 'approve' | 'reject',
    author: string,
  ): ReviewOperationResult {
    const result = applyReview(text, changeId, decision, '', author);

    if ('error' in result) {
      const errorResult: ReviewOperationResult = {
        updatedText: text,
        affectedChangeIds: [],
        error: result.error,
      };
      this._onReviewError.fire({ error: result.error });
      return errorResult;
    }

    let finalText = result.updatedContent;
    const affectedIds: string[] = [changeId];

    // Include cascaded children
    if (result.result.cascaded_children) {
      affectedIds.push(...result.result.cascaded_children);
    }

    // Auto-settlement only when status actually changed
    if (result.result.status_updated) {
      if (decision === 'approve' && this.config?.settlement?.autoOnApprove) {
        const settled = applyAcceptedChanges(finalText);
        finalText = settled.currentContent;
        if (settled.appliedIds.length > 0) {
          for (const id of settled.appliedIds) {
            if (!affectedIds.includes(id)) affectedIds.push(id);
          }
        }
      } else if (decision === 'reject' && this.config?.settlement?.autoOnReject) {
        const settled = applyRejectedChanges(finalText);
        finalText = settled.currentContent;
        if (settled.appliedIds.length > 0) {
          for (const id of settled.appliedIds) {
            if (!affectedIds.includes(id)) affectedIds.push(id);
          }
        }
      }
    }

    const successResult: ReviewOperationResult = {
      updatedText: finalText,
      affectedChangeIds: affectedIds,
    };
    this._onDidCompleteReview.fire(successResult);
    return successResult;
  }

  private executeBatchReview(
    text: string,
    decision: 'approve' | 'reject',
    changeIds?: string[],
    author?: string,
  ): ReviewOperationResult {
    // Parse to find proposed changes
    const doc = parseForFormat(text);
    let proposed = doc.getChanges().filter(c => c.status === ChangeStatus.Proposed);

    // Filter to specified IDs if provided
    if (changeIds && changeIds.length > 0) {
      const idSet = new Set(changeIds);
      proposed = proposed.filter(c => idSet.has(c.id));
    }

    if (proposed.length === 0) {
      return { updatedText: text, affectedChangeIds: [] };
    }

    // Sort in reverse offset order so earlier text offsets aren't invalidated
    const sorted = [...proposed].sort((a, b) => b.range.start - a.range.start);

    let currentText = text;
    const affectedIds = new Set<string>();
    const errors: string[] = [];

    for (const change of sorted) {
      const result = applyReview(currentText, change.id, decision, '', author ?? 'system');
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      currentText = result.updatedContent;
      affectedIds.add(change.id);
      if (result.result.cascaded_children) {
        for (const id of result.result.cascaded_children) affectedIds.add(id);
      }
    }

    // Auto-settlement after entire batch
    if (affectedIds.size > 0) {
      if (decision === 'approve' && this.config?.settlement?.autoOnApprove) {
        const settled = applyAcceptedChanges(currentText);
        currentText = settled.currentContent;
        for (const id of settled.appliedIds) affectedIds.add(id);
      } else if (decision === 'reject' && this.config?.settlement?.autoOnReject) {
        const settled = applyRejectedChanges(currentText);
        currentText = settled.currentContent;
        for (const id of settled.appliedIds) affectedIds.add(id);
      }
    }

    const affectedArray = [...affectedIds];
    const successResult: ReviewOperationResult = {
      updatedText: currentText,
      affectedChangeIds: affectedArray,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };

    if (affectedArray.length > 0) {
      this._onDidCompleteReview.fire(successResult);
    }
    if (errors.length > 0) {
      this._onReviewError.fire({ error: errors.join('; ') });
    }

    return successResult;
  }
}
