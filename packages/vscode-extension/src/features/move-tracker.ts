/**
 * Client-side state for cut-as-move / paste-as-move.
 * On cut: capture selected text + timestamp.
 * On paste within timeout: send moveMetadata notification to server BEFORE
 * the next didChange fires. Server correlates and emits a single `move`
 * change instead of separate delete + insert.
 */
export class MoveTracker {
    private pendingCut: { text: string; timestamp: number } | null = null;

    constructor(
        private readonly sendMoveMetadata: (uri: string, cutText: string) => void,
        private readonly timeoutMs: number = 60_000,
        private readonly now: () => number = Date.now,
    ) {}

    prepareCut(text: string): void {
        if (!text) return;
        this.pendingCut = { text, timestamp: this.now() };
    }

    preparePaste(uri: string): void {
        if (!this.pendingCut) return;

        const elapsed = this.now() - this.pendingCut.timestamp;
        if (elapsed > this.timeoutMs) {
            this.pendingCut = null;
            return;
        }

        this.sendMoveMetadata(uri, this.pendingCut.text);
        this.pendingCut = null;
    }

    hasPendingCut(): boolean {
        return this.pendingCut !== null;
    }

    clear(): void {
        this.pendingCut = null;
    }

    dispose(): void {
        this.pendingCut = null;
    }
}
