import { describe, it, expect, vi } from 'vitest';
import { applyWordReviewChanges, prepareWordReviewChanges } from '@changedown/mcp/internals';
import type { DocumentBackend, ChangeOp, DocumentRef } from '@changedown/core/backend';

function makeBackend(overrides: Partial<DocumentBackend> = {}): DocumentBackend {
  return {
    schemes: ['word'],
    list: () => [],
    read: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    listChanges: vi.fn(async () => []),
    applyChange: vi.fn(async () => ({ applied: true, changeId: 'cn-1' })),
    ...overrides,
  };
}

describe('Word review_changes adapter', () => {
  it('translates a single approve review into pane review_change args', async () => {
    const backend = makeBackend({
      listChanges: vi.fn(async () => [{ changeId: 'cn-2', type: 'Deletion', status: 'proposed', author: '@a', line: 1, preview: 'x' }]),
    });

    const response = await applyWordReviewChanges({
      file: 'word://sess-test',
      author: 'ai:codex',
      reviews: [{ change_id: 'cn-1', decision: 'approve', reason: 'looks good' }],
    }, backend, 'word://sess-test');

    expect(backend.applyChange).toHaveBeenCalledWith(
      { uri: 'word://sess-test' } satisfies DocumentRef,
      {
        kind: 'review',
        args: {
          cnId: 'cn-1',
          decision: 'approve',
          reason: 'looks good',
          author: 'ai:codex',
          blocking: undefined,
          label: undefined,
        },
      } satisfies ChangeOp,
    );
    expect(response).toMatchObject({
      file: 'word://sess-test',
      results: [{ change_id: 'cn-1', decision: 'approve', status_updated: true }],
      document_state: { remaining_proposed: 1, all_resolved: false },
    });
  });

  it('translates a single reject review into pane review_change args', async () => {
    const backend = makeBackend();

    await applyWordReviewChanges({
      file: 'word://sess-test',
      author: 'ai:codex',
      reviews: [{ change_id: 'cn-1', decision: 'reject', reason: 'not wanted' }],
    }, backend, 'word://sess-test');

    expect(backend.applyChange).toHaveBeenCalledWith(
      { uri: 'word://sess-test' },
      expect.objectContaining({
        kind: 'review',
        args: expect.objectContaining({ cnId: 'cn-1', decision: 'reject', reason: 'not wanted' }),
      }),
    );
  });

  it('rejects batch reviews for the basic Word path', () => {
    const result = prepareWordReviewChanges({
      reviews: [
        { change_id: 'cn-1', decision: 'approve', reason: 'a' },
        { change_id: 'cn-2', decision: 'reject', reason: 'b' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('exactly one');
  });

  it('rejects responses and request_changes for the basic Word path', () => {
    const withResponse = prepareWordReviewChanges({
      responses: [{ change_id: 'cn-1', response: 'hi' }],
      reviews: [{ change_id: 'cn-1', decision: 'approve', reason: 'a' }],
    });
    expect(withResponse.ok).toBe(false);

    const requestChanges = prepareWordReviewChanges({
      reviews: [{ change_id: 'cn-1', decision: 'request_changes', reason: 'please revise' }],
    });
    expect(requestChanges.ok).toBe(false);
    if (!requestChanges.ok) expect(requestChanges.message).toContain('approve/reject only');
  });

  it('throws when pane review does not apply', async () => {
    const backend = makeBackend({
      applyChange: vi.fn(async () => ({ applied: false, text: 'review_change did not match tracked change' })),
    });

    await expect(applyWordReviewChanges({
      reviews: [{ change_id: 'cn-1', decision: 'approve', reason: 'a' }],
    }, backend, 'word://sess-test')).rejects.toThrow('did not match');
  });
});
