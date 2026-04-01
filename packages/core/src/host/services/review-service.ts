import { EventEmitter, type LspConnection, type ReviewResult, type Disposable } from '../types.js';

interface ReviewOptions {
  reason?: string;
}

export class ReviewService implements Disposable {
  readonly onDidCompleteReview = new EventEmitter<ReviewResult>();
  readonly onReviewError = new EventEmitter<{ uri: string; message: string }>();

  constructor(private connection: LspConnection) {}

  async acceptChange(uri: string, changeId: string, options?: ReviewOptions): Promise<void> {
    await this.sendReview(uri, 'changedown/reviewChange', {
      changeId,
      decision: 'approve',
      reason: options?.reason,
    });
  }

  async rejectChange(uri: string, changeId: string, options?: ReviewOptions): Promise<void> {
    await this.sendReview(uri, 'changedown/reviewChange', {
      changeId,
      decision: 'reject',
      reason: options?.reason,
    });
  }

  async requestChanges(uri: string, changeId: string, options?: ReviewOptions): Promise<void> {
    await this.sendReview(uri, 'changedown/reviewChange', {
      changeId,
      decision: 'request_changes',
      reason: options?.reason,
    });
  }

  async acceptAll(uri: string): Promise<void> {
    await this.sendReview(uri, 'changedown/reviewAll', {
      decision: 'approve',
    });
  }

  async rejectAll(uri: string): Promise<void> {
    await this.sendReview(uri, 'changedown/reviewAll', {
      decision: 'reject',
    });
  }

  async amendChange(uri: string, changeId: string, newText: string): Promise<void> {
    await this.sendReview(uri, 'changedown/amendChange', {
      changeId,
      newText,
    });
  }

  private async sendReview(uri: string, method: string, params: Record<string, unknown>): Promise<void> {
    try {
      const response = await this.connection.sendRequest<{
        edit?: { range: any; newText: string };
        edits?: Array<{ range: any; newText: string }>;
        error?: string;
      }>(method, { uri, ...params });
      if (response && 'error' in response) {
        this.onReviewError.fire({ uri, message: (response as any).error ?? 'Review failed' });
        return;
      }
      const edits = response?.edits ?? (response?.edit ? [response.edit] : undefined);
      this.onDidCompleteReview.fire({
        uri,
        success: true,
        edits,
        refreshDecorations: true,
      });
    } catch (err: any) {
      this.onReviewError.fire({
        uri,
        message: err?.message ?? 'Unknown error',
      });
    }
  }

  dispose(): void {
    this.onDidCompleteReview.dispose();
    this.onReviewError.dispose();
  }
}
