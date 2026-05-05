import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ReviewService, type ReviewOperationResult } from '@changedown/core/host/services';
import { parseForFormat, initHashline } from '@changedown/core';

// L2 doc with a single proposed insertion
const L2_DOC = [
  'Hello {++world++}[^cn-1] more text',
  '',
  '[^cn-1]: @alice | 2026-03-09 | ins | proposed',
  '    reason: Added greeting',
  '',
].join('\n');

// L2 doc with two proposed changes
const L2_DOC_TWO = [
  'Hello {++world++}[^cn-1] and {++goodbye++}[^cn-2] text',
  '',
  '[^cn-1]: @alice | 2026-03-09 | ins | proposed',
  '    reason: Added greeting',
  '',
  '[^cn-2]: @alice | 2026-03-10 | ins | proposed',
  '    reason: Added farewell',
  '',
].join('\n');

// L2 doc with an accepted change (for settlement tests)
const L2_DOC_ACCEPTED = [
  'Hello {++world++}[^cn-1] more text',
  '',
  '[^cn-1]: @alice | 2026-03-09 | ins | accepted',
  '    reason: Added greeting',
  '    approved: @bob 2026-03-10 "Looks good"',
  '',
].join('\n');

beforeAll(async () => {
  await initHashline();
});

describe('ReviewService', () => {
  describe('acceptChange', () => {
    it('calls applyReview and returns updated text with accepted status', () => {
      const service = new ReviewService();
      const result = service.acceptChange(L2_DOC, 'cn-1', 'bob');

      expect(result.error).toBeUndefined();
      expect(result.updatedText).toContain('| accepted');
      expect(result.updatedText).toContain('approved:');
      expect(result.updatedText).toContain('@bob');
      expect(result.affectedChangeIds).toContain('cn-1');
    });

    it('returns error for non-existent change ID', () => {
      const service = new ReviewService();
      const result = service.acceptChange(L2_DOC, 'cn-99', 'bob');

      expect(result.error).toBeDefined();
      expect(result.affectedChangeIds).toHaveLength(0);
    });

    it('fires onDidCompleteReview event on success', () => {
      const service = new ReviewService();
      const listener = vi.fn();
      service.onDidCompleteReview(listener);

      service.acceptChange(L2_DOC, 'cn-1', 'bob');

      expect(listener).toHaveBeenCalledTimes(1);
      const fired: ReviewOperationResult = listener.mock.calls[0][0];
      expect(fired.updatedText).toContain('| accepted');
      expect(fired.affectedChangeIds).toContain('cn-1');
    });

    it('fires onReviewError event on failure', () => {
      const service = new ReviewService();
      const listener = vi.fn();
      service.onReviewError(listener);

      service.acceptChange(L2_DOC, 'cn-99', 'bob');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].error).toBeDefined();
    });
  });

  describe('rejectChange', () => {
    it('rejects a proposed change', () => {
      const service = new ReviewService();
      const result = service.rejectChange(L2_DOC, 'cn-1', 'bob');

      expect(result.error).toBeUndefined();
      expect(result.updatedText).toContain('| rejected');
      expect(result.updatedText).toContain('rejected:');
      expect(result.affectedChangeIds).toContain('cn-1');
    });
  });

  describe('settlement', () => {
    it('auto-settles accepted changes when autoOnApprove is true', () => {
      const service = new ReviewService({ settlement: { autoOnApprove: true } });
      const result = service.acceptChange(L2_DOC, 'cn-1', 'bob');

      expect(result.error).toBeUndefined();
      // After settlement, the body text should have no inline CriticMarkup
      // (edit-op lines in footnotes may still contain {++ syntax as data)
      const bodyLine = result.updatedText.split('\n')[0];
      expect(bodyLine).not.toContain('{++');
      expect(bodyLine).toContain('world');
      expect(result.affectedChangeIds).toContain('cn-1');
    });

    it('does NOT settle when autoOnApprove is false/absent', () => {
      const service = new ReviewService();
      const result = service.acceptChange(L2_DOC, 'cn-1', 'bob');

      expect(result.error).toBeUndefined();
      // Markup should still be present
      expect(result.updatedText).toContain('{++');
    });

    it('auto-settles rejected changes when autoOnReject is true', () => {
      const service = new ReviewService({ settlement: { autoOnReject: true } });
      const result = service.rejectChange(L2_DOC, 'cn-1', 'bob');

      expect(result.error).toBeUndefined();
      // After rejection settlement, the insertion should be removed from the body;
      // edit-op history may preserve it in footnotes.
      const body = result.updatedText.split('\n\n')[0];
      expect(body).not.toContain('{++');
      expect(body).not.toContain('world');
      expect(parseForFormat(result.updatedText).getDiagnostics()).toEqual([]);
    });

    it('does NOT settle when status was not actually updated (idempotent review)', () => {
      // First accept
      const service = new ReviewService({ settlement: { autoOnApprove: true } });
      const first = service.acceptChange(L2_DOC, 'cn-1', 'bob');
      // Second accept on already-accepted text should be idempotent
      const second = service.acceptChange(first.updatedText, 'cn-1', 'bob');
      // Should not error, status_updated should be false
      expect(second.error).toBeUndefined();
    });
  });

  describe('acceptAll', () => {
    it('accepts all proposed changes', () => {
      const service = new ReviewService();
      const result = service.acceptAll(L2_DOC_TWO, undefined, 'bob');

      expect(result.error).toBeUndefined();
      expect(result.updatedText).toContain('| accepted');
      expect(result.affectedChangeIds).toContain('cn-1');
      expect(result.affectedChangeIds).toContain('cn-2');
    });

    it('accepts only specified change IDs when provided', () => {
      const service = new ReviewService();
      const result = service.acceptAll(L2_DOC_TWO, ['cn-1'], 'bob');

      expect(result.error).toBeUndefined();
      expect(result.affectedChangeIds).toContain('cn-1');
      // cn-2 should still be proposed
      expect(result.updatedText).toMatch(/\[\^cn-2\].*proposed/s);
    });

    it('auto-settles batch when autoOnApprove is true', () => {
      const service = new ReviewService({ settlement: { autoOnApprove: true } });
      const result = service.acceptAll(L2_DOC_TWO, undefined, 'bob');

      expect(result.error).toBeUndefined();
      // Body text should have no inline CriticMarkup (edit-op lines in footnotes may)
      const bodyLine = result.updatedText.split('\n')[0];
      expect(bodyLine).not.toContain('{++');
    });
  });

  describe('rejectAll', () => {
    it('rejects all proposed changes', () => {
      const service = new ReviewService();
      const result = service.rejectAll(L2_DOC_TWO, undefined, 'bob');

      expect(result.error).toBeUndefined();
      expect(result.updatedText).toContain('| rejected');
      expect(result.affectedChangeIds).toContain('cn-1');
      expect(result.affectedChangeIds).toContain('cn-2');
    });

    it('auto-settles batch when autoOnReject is true', () => {
      const service = new ReviewService({ settlement: { autoOnReject: true } });
      const result = service.rejectAll(L2_DOC_TWO, undefined, 'bob');

      expect(result.error).toBeUndefined();
      // After rejection settlement, insertions removed from the body;
      // edit-op history may preserve them in footnotes.
      const body = result.updatedText.split('\n\n')[0];
      expect(body).not.toContain('{++');
      expect(body).not.toContain('world');
      expect(body).not.toContain('goodbye');
      expect(parseForFormat(result.updatedText).getDiagnostics()).toEqual([]);
    });
  });

  describe('amendChange', () => {
    it('amends a proposed change by the same author', async () => {
      const service = new ReviewService();
      const result = await service.amendChange(L2_DOC, 'cn-1', 'universe', 'alice');

      expect(result.error).toBeUndefined();
      expect(result.updatedText).toContain('{++universe++}');
      expect(result.updatedText).not.toContain('{++world++}');
      expect(result.affectedChangeIds).toContain('cn-1');
    });

    it('returns error when different author tries to amend', async () => {
      const service = new ReviewService();
      const result = await service.amendChange(L2_DOC, 'cn-1', 'universe', 'bob');

      expect(result.error).toBeDefined();
      expect(result.error).toContain('not the original author');
    });
  });

  describe('supersedeChange', () => {
    it('supersedes a proposed change', async () => {
      const service = new ReviewService();
      const result = await service.supersedeChange(L2_DOC, 'cn-1', 'universe', 'bob');

      expect(result.error).toBeUndefined();
      expect(result.updatedText).toContain('| rejected');
      expect(result.updatedText).toContain('supersedes:');
      expect(result.updatedText).toContain('superseded-by:');
      expect(result.affectedChangeIds.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('resolveThread', () => {
    it('adds a resolved line to the footnote block', () => {
      const service = new ReviewService();
      const result = service.resolveThread(L2_DOC, 'cn-1', 'bob');

      expect(result.error).toBeUndefined();
      expect(result.updatedText).toContain('resolved:');
      expect(result.updatedText).toContain('@bob');
      expect(result.affectedChangeIds).toContain('cn-1');
    });

    it('returns error for non-existent change', () => {
      const service = new ReviewService();
      const result = service.resolveThread(L2_DOC, 'cn-99', 'bob');

      expect(result.error).toBeDefined();
    });
  });

  describe('dispose', () => {
    it('disposes without error', () => {
      const service = new ReviewService();
      expect(() => service.dispose()).not.toThrow();
    });
  });
});
