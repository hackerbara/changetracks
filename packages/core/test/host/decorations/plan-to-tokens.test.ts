import { describe, it, expect } from 'vitest';
import { buildDecorationPlan, NO_CURSOR } from '../../../src/host/decorations/plan-builder.js';
import { planToSemanticTokens, TOKEN_TYPES, TokenType, TokenModifier } from '../../../src/host/decorations/plan-to-tokens.js';
import { VIEW_PRESETS } from '../../../src/host/types.js';
import { ChangeType, ChangeStatus } from '../../../src/model/types.js';

describe('planToSemanticTokens', () => {
  it('TOKEN_TYPES has exactly 8 entries in the expected order', () => {
    expect(TOKEN_TYPES).toEqual([
      'changedown-insertion',
      'changedown-deletion',
      'changedown-highlight',
      'changedown-comment',
      'changedown-subOriginal',
      'changedown-subModified',
      'changedown-moveFrom',
      'changedown-moveTo',
    ]);
  });

  it('emits an insertion token with Modification modifier for a proposed insertion in review view', () => {
    const text = 'hello world';
    const insertion = {
      id: 'cn-1',
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: { start: 6, end: 17 },
      contentRange: { start: 9, end: 14 },
      metadata: { status: 'proposed' },
    } as any;

    const plan = buildDecorationPlan([insertion], text, VIEW_PRESETS.review, NO_CURSOR);
    const tokens = planToSemanticTokens(plan, [insertion], text);

    // 5 ints per token: [deltaLine, deltaChar, length, type, modifiers]
    expect(tokens.data.length).toBeGreaterThanOrEqual(5);
    expect(tokens.data[3]).toBe(TokenType.Insertion);
    expect(tokens.data[4] & TokenModifier.Modification).toBeTruthy();
    expect(tokens.data[4] & TokenModifier.Proposed).toBeTruthy();
  });

  it('suppresses insertion tokens in decided view (projection=decided hides insertion content as visible)', () => {
    const text = 'hello world';
    const insertion = {
      id: 'cn-1',
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: { start: 6, end: 17 },
      contentRange: { start: 9, end: 14 },
    } as any;

    const plan = buildDecorationPlan([insertion], text, VIEW_PRESETS.decided, NO_CURSOR);
    const tokens = planToSemanticTokens(plan, [insertion], text);
    expect(tokens.data).toEqual([]);
  });

  it('emits HasThread modifier when change has discussion metadata', () => {
    const text = 'hello world';
    const insertion = {
      id: 'cn-1',
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: { start: 6, end: 17 },
      contentRange: { start: 9, end: 14 },
      metadata: {
        status: 'proposed',
        discussion: [{ author: 'alice', text: 'what do you think', timestamp: '2026-04-09T00:00:00Z' }],
      },
    } as any;

    const plan = buildDecorationPlan([insertion], text, VIEW_PRESETS.review, NO_CURSOR);
    const tokens = planToSemanticTokens(plan, [insertion], text);
    expect(tokens.data[4] & TokenModifier.HasThread).toBeTruthy();
  });

  it('assigns author slots 0,1,2 based on first-seen order', () => {
    const text = 'abc';
    const makeChange = (id: string, author: string, start: number, cstart: number): any => ({
      id,
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: { start, end: start + 7 },
      contentRange: { start: cstart, end: cstart + 1 },
      metadata: { author, status: 'proposed' },
    });
    const changes = [
      makeChange('cn-1', 'alice', 0, 3),
      makeChange('cn-2', 'bob', 7, 10),
      makeChange('cn-3', 'alice', 14, 17),
    ];
    const plan = buildDecorationPlan(changes, text, VIEW_PRESETS.review, NO_CURSOR);
    const tokens = planToSemanticTokens(plan, changes, text);

    const modBits = [tokens.data[4], tokens.data[9], tokens.data[14]];
    expect(modBits[0] & TokenModifier.AuthorSlot0).toBeTruthy();
    expect(modBits[1] & TokenModifier.AuthorSlot1).toBeTruthy();
    expect(modBits[2] & TokenModifier.AuthorSlot0).toBeTruthy();
  });

  it('returns empty tokens for original projection on insertion (plan.hiddens covers the whole range)', () => {
    const text = 'hello world';
    const insertion = {
      id: 'cn-1',
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: { start: 6, end: 17 },
      contentRange: { start: 9, end: 14 },
    } as any;

    const plan = buildDecorationPlan([insertion], text, VIEW_PRESETS.original, NO_CURSOR);
    const tokens = planToSemanticTokens(plan, [insertion], text);
    expect(tokens.data).toEqual([]);
  });

  it('returns empty tokens for empty plan', () => {
    const text = 'plain text';
    const plan = buildDecorationPlan([], text, VIEW_PRESETS.review, NO_CURSOR);
    const tokens = planToSemanticTokens(plan, [], text);
    expect(tokens.data).toEqual([]);
  });
});
