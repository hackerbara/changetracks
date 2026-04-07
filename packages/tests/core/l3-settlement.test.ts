import { describe, it, expect, beforeAll } from 'vitest';
import { applyAcceptedChanges, applyRejectedChanges, initHashline, computeCurrentView } from '@changedown/core/internals';

beforeAll(async () => {
  await initHashline();
});

// Helper: build L3 document with one insertion
function l3WithInsertion(status: string) {
  return [
    '<!-- changedown.com/v1: tracked -->',
    'Hello beautiful world',
    '',
    `[^cn-1]: @alice | 2026-03-18 | ins | ${status}`,
    '    2:b4 {++beautiful ++}',
  ].join('\n');
}

// Helper: build L3 document with one deletion
function l3WithDeletion(status: string) {
  return [
    '<!-- changedown.com/v1: tracked -->',
    'Hello world',
    '',
    `[^cn-1]: @alice | 2026-03-18 | del | ${status}`,
    '    2:b4 {--beautiful --} @ctx:"Hello "||" world"',
  ].join('\n');
}

// Helper: build L3 document with one substitution
function l3WithSubstitution(status: string) {
  return [
    '<!-- changedown.com/v1: tracked -->',
    'Hello new world',
    '',
    `[^cn-1]: @alice | 2026-03-18 | sub | ${status}`,
    '    2:b4 {~~old~>new~~}',
  ].join('\n');
}

describe('applyAcceptedChanges on L3', () => {
  it('accept insertion: L3 no-op — text unchanged, edit-op preserved', () => {
    const input = l3WithInsertion('accepted');
    const { currentContent, appliedIds } = applyAcceptedChanges(input);
    expect(appliedIds).toEqual([]);
    expect(currentContent).toBe(input);
    expect(currentContent).toContain('{++beautiful ++}');
    expect(currentContent).not.toContain('settled:');
    expect(currentContent).toContain('[^cn-1]:');
  });

  it('accept deletion: L3 no-op — text unchanged, edit-op preserved', () => {
    const input = l3WithDeletion('accepted');
    const { currentContent, appliedIds } = applyAcceptedChanges(input);
    expect(appliedIds).toEqual([]);
    expect(currentContent).toBe(input);
    expect(currentContent).toContain('{--beautiful --}');
    expect(currentContent).not.toContain('settled:');
  });

  it('accept substitution: L3 no-op — text unchanged, edit-op preserved', () => {
    const input = l3WithSubstitution('accepted');
    const { currentContent, appliedIds } = applyAcceptedChanges(input);
    expect(appliedIds).toEqual([]);
    expect(currentContent).toBe(input);
    expect(currentContent).toContain('{~~old~>new~~}');
    expect(currentContent).not.toContain('settled:');
  });

  it('skips proposed changes in L3', () => {
    const { currentContent, appliedIds } = applyAcceptedChanges(l3WithInsertion('proposed'));
    expect(appliedIds).toEqual([]);
    expect(currentContent).toContain('{++beautiful ++}');
  });

  it('does NOT inject [^cn-N] refs into L3 body lines', () => {
    const input = l3WithInsertion('accepted');
    const { currentContent } = applyAcceptedChanges(input);
    const bodyLines = currentContent.split('\n').slice(0, 2);
    for (const line of bodyLines) {
      expect(line).not.toMatch(/\[\^cn-\d+\]/);
    }
  });
});

describe('applyRejectedChanges on L3', () => {
  it('reject insertion: text removed from body, edit-op preserved', () => {
    const { currentContent, appliedIds } = applyRejectedChanges(l3WithInsertion('rejected'));
    expect(appliedIds).toEqual(['cn-1']);
    const bodyLine = currentContent.split('\n')[1];
    expect(bodyLine).toBe('Hello world');
    expect(currentContent).toContain('[^cn-1]:');
    expect(currentContent).toContain('{++beautiful ++}');
    expect(currentContent).not.toContain('settled:');
  });

  it('reject deletion: text restored to body, edit-op preserved', () => {
    const { currentContent, appliedIds } = applyRejectedChanges(l3WithDeletion('rejected'));
    expect(appliedIds).toEqual(['cn-1']);
    expect(currentContent).toContain('beautiful');
    expect(currentContent).toContain('[^cn-1]:');
    expect(currentContent).toContain('{--beautiful --}');
    expect(currentContent).not.toContain('settled:');
  });

  it('reject substitution: reverted to original, edit-op preserved', () => {
    const { currentContent, appliedIds } = applyRejectedChanges(l3WithSubstitution('rejected'));
    expect(appliedIds).toEqual(['cn-1']);
    expect(currentContent).toContain('old');
    expect(currentContent).not.toContain('new world');
    expect(currentContent).toContain('[^cn-1]:');
    expect(currentContent).toContain('{~~old~>new~~}');
    expect(currentContent).not.toContain('settled:');
  });

  it('does NOT inject [^cn-N] refs into L3 body lines', () => {
    const { currentContent } = applyRejectedChanges(l3WithInsertion('rejected'));
    const bodyLines = currentContent.split('\n').slice(0, 2);
    for (const line of bodyLines) {
      expect(line).not.toMatch(/\[\^cn-\d+\]/);
    }
  });
});

describe('computeCurrentView on L3', () => {
  it('produces correct line mappings for L3 text', () => {
    const l3 = [
      '<!-- changedown.com/v1: tracked -->',
      'Hello beautiful world',
      'Second line',
      '',
      '[^cn-1]: @alice | 2026-03-18 | ins | proposed',
      '    1:b4 beautiful ',
    ].join('\n');
    const result = computeCurrentView(l3);
    expect(result.lines.length).toBeGreaterThan(0);
    // Current view strips footnotes from output lines
    const fullText = result.lines.map(l => l.text).join('\n');
    expect(fullText).not.toContain('[^cn-1]');
    expect(fullText).toContain('Hello beautiful world');
  });
});

describe('mixed-status L3 settlement', () => {
  it('settles only accepted changes, leaves proposed and rejected', () => {
    const l3 = [
      '<!-- changedown.com/v1: tracked -->',
      'Hello beautiful new world today',
      '',
      '[^cn-1]: @alice | 2026-03-18 | ins | accepted',
      '    2:b4 {++beautiful ++}',
      '[^cn-2]: @bob | 2026-03-18 | ins | proposed',
      '    2:b4 {++new ++}',
      '[^cn-3]: @carol | 2026-03-18 | ins | rejected',
      '    2:b4 {++today++}',
    ].join('\n');
    const { currentContent, appliedIds } = applyAcceptedChanges(l3);
    expect(appliedIds).toEqual([]);
    expect(currentContent).toContain('{++beautiful ++}');
    expect(currentContent).not.toContain('settled:');
    expect(currentContent).toContain('{++new ++}');
    expect(currentContent).toContain('{++today++}');
  });
});

describe('L3 settlement round-trip', () => {
  it('settle in L3 preserves edit-op, preserves footnote header', () => {
    const l3 = [
      '<!-- changedown.com/v1: tracked -->',
      'Hello beautiful world',
      '',
      '[^cn-1]: @alice | 2026-03-18 | ins | accepted',
      '    2:b4 {++beautiful ++}',
      '[^cn-2]: @bob | 2026-03-18 | ins | proposed',
      '    2:b4 {++world++}',
    ].join('\n');
    const { currentContent } = applyAcceptedChanges(l3);
    expect(currentContent).toContain('[^cn-1]:');
    expect(currentContent).toContain('{++beautiful ++}');
    expect(currentContent).not.toContain('settled:');
    expect(currentContent).toContain('{++world++}');
  });
});
