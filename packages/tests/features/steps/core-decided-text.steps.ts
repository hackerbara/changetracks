import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { ChangeDownWorld } from './world.js';
import {
  computeDecidedLine,
  computeDecidedView,
  formatDecidedOutput,
  initHashline,
  computeLineHash,
  type FootnoteStatus,
  type DecidedLineResult,
  type DecidedViewResult,
} from '@changedown/core';

// =============================================================================
// Per-scenario state via WeakMap (avoids polluting the shared World interface)
// =============================================================================

const committedLineInput = new WeakMap<ChangeDownWorld, string>();
const footnoteMap = new WeakMap<ChangeDownWorld, Map<string, FootnoteStatus>>();
const committedLineResult = new WeakMap<ChangeDownWorld, DecidedLineResult>();
const committedViewRawText = new WeakMap<ChangeDownWorld, string>();
const committedViewResult = new WeakMap<ChangeDownWorld, DecidedViewResult>();
const formattedCommittedOutput = new WeakMap<ChangeDownWorld, string>();

// =============================================================================
// Background
// =============================================================================

Given(
  'the committed-text hashline module is initialized',
  async function (this: ChangeDownWorld) {
    await initHashline();
  },
);

// =============================================================================
// computeDecidedLine: Given steps
// =============================================================================

Given(
  'a committed-text input {string}',
  function (this: ChangeDownWorld, input: string) {
    committedLineInput.set(this, input);
  },
);

Given(
  'no footnote statuses',
  function (this: ChangeDownWorld) {
    footnoteMap.set(this, new Map<string, FootnoteStatus>());
  },
);

Given(
  'footnote status {string} is {string} type {string}',
  function (this: ChangeDownWorld, id: string, status: string, type: string) {
    let map = footnoteMap.get(this);
    if (!map) {
      map = new Map<string, FootnoteStatus>();
      footnoteMap.set(this, map);
    }
    map.set(id, { status: status as 'proposed' | 'accepted' | 'rejected' });
  },
);

// =============================================================================
// computeDecidedLine: When step
// =============================================================================

When(
  'I compute the committed line',
  function (this: ChangeDownWorld) {
    const input = committedLineInput.get(this);
    assert.ok(input !== undefined, 'No committed-text input set');
    const fns = footnoteMap.get(this) ?? new Map<string, FootnoteStatus>();
    committedLineResult.set(this, computeDecidedLine(input, fns));
  },
);

// =============================================================================
// computeDecidedLine: Then steps
// =============================================================================

Then(
  'the committed text is {string}',
  function (this: ChangeDownWorld, expected: string) {
    const result = committedLineResult.get(this);
    assert.ok(result, 'No committed line result');
    assert.strictEqual(result.text, expected);
  },
);

Then(
  'the committed flag is {string}',
  function (this: ChangeDownWorld, expected: string) {
    const result = committedLineResult.get(this);
    assert.ok(result, 'No committed line result');
    assert.strictEqual(result.flag, expected);
  },
);

Then(
  'the committed changeIds are empty',
  function (this: ChangeDownWorld) {
    const result = committedLineResult.get(this);
    assert.ok(result, 'No committed line result');
    assert.deepStrictEqual(result.changeIds, []);
  },
);

Then(
  'the committed changeIds include {string}',
  function (this: ChangeDownWorld, expected: string) {
    const result = committedLineResult.get(this);
    assert.ok(result, 'No committed line result');
    assert.ok(
      result.changeIds.includes(expected),
      `Expected changeIds to include "${expected}" but got: ${JSON.stringify(result.changeIds)}`,
    );
  },
);

// =============================================================================
// computeDecidedView: Given steps
// =============================================================================

Given(
  'a decided-view raw text:',
  function (this: ChangeDownWorld, rawText: string) {
    committedViewRawText.set(this, rawText);
  },
);

Given(
  'a decided-view raw text {string}',
  function (this: ChangeDownWorld, rawText: string) {
    // Handle escape sequences for inline strings
    const unescaped = rawText.replace(/\\n/g, '\n');
    committedViewRawText.set(this, unescaped);
  },
);

// =============================================================================
// computeDecidedView: When steps
// =============================================================================

When(
  'I compute the decided view',
  function (this: ChangeDownWorld) {
    const rawText = committedViewRawText.get(this);
    assert.ok(rawText !== undefined, 'No decided-view raw text set');
    committedViewResult.set(this, computeDecidedView(rawText));
  },
);

When(
  'I format the decided output for {string} with tracking {string}',
  function (this: ChangeDownWorld, filePath: string, trackingStatus: string) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result to format');
    formattedCommittedOutput.set(
      this,
      formatDecidedOutput(view, { filePath, trackingStatus }),
    );
  },
);

// =============================================================================
// computeDecidedView: Then steps
// =============================================================================

Then(
  'the decided view has {int} lines',
  function (this: ChangeDownWorld, expected: number) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.strictEqual(view.lines.length, expected);
  },
);

Then(
  'decided view line numbers are sequential with no gaps',
  function (this: ChangeDownWorld) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    const lineNums = view.lines.map(l => l.decidedLineNum);
    for (let i = 1; i < lineNums.length; i++) {
      assert.strictEqual(
        lineNums[i],
        lineNums[i - 1] + 1,
        `Gap between line ${lineNums[i - 1]} and ${lineNums[i]}`,
      );
    }
  },
);

Then(
  'committed-to-raw mapping {int} is raw {int}',
  function (this: ChangeDownWorld, committedNum: number, rawNum: number) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.strictEqual(view.decidedToRaw.get(committedNum), rawNum);
  },
);

Then(
  'raw-to-committed mapping {int} is committed {int}',
  function (this: ChangeDownWorld, rawNum: number, committedNum: number) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.strictEqual(view.rawToDecided.get(rawNum), committedNum);
  },
);

Then(
  'all decided hashes are 2-char lowercase hex',
  function (this: ChangeDownWorld) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    for (const line of view.lines) {
      assert.match(line.hash, /^[0-9a-f]{2}$/);
    }
  },
);

Then(
  'the committed summary has {int} proposed',
  function (this: ChangeDownWorld, expected: number) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.strictEqual(view.summary.proposed, expected);
  },
);

Then(
  'the committed summary has {int} accepted',
  function (this: ChangeDownWorld, expected: number) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.strictEqual(view.summary.accepted, expected);
  },
);

Then(
  'the committed summary has {int} rejected',
  function (this: ChangeDownWorld, expected: number) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.strictEqual(view.summary.rejected, expected);
  },
);

Then(
  'the committed summary has {int} clean lines',
  function (this: ChangeDownWorld, expected: number) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.strictEqual(view.summary.clean, expected);
  },
);

Then(
  'no decided view line starts with a footnote ref',
  function (this: ChangeDownWorld) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    for (const line of view.lines) {
      assert.ok(
        !line.text.match(/^\[\^cn-/),
        `Unexpected footnote ref in committed text: ${line.text}`,
      );
    }
  },
);

Then(
  'no decided view line contains {string}',
  function (this: ChangeDownWorld, unexpected: string) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    for (const line of view.lines) {
      assert.ok(
        !line.text.includes(unexpected),
        `Unexpected content in committed text: ${line.text}`,
      );
    }
  },
);

Then(
  'the decided view line count equals the raw line count',
  function (this: ChangeDownWorld) {
    const view = committedViewResult.get(this);
    const rawText = committedViewRawText.get(this);
    assert.ok(view, 'No decided view result');
    assert.ok(rawText !== undefined, 'No raw text');
    const rawLineCount = rawText.split('\n').length;
    assert.strictEqual(view.lines.length, rawLineCount);
  },
);

Then(
  'all decided view lines have empty flag',
  function (this: ChangeDownWorld) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    for (const line of view.lines) {
      assert.strictEqual(line.flag, '', `Line ${line.decidedLineNum} has non-empty flag "${line.flag}"`);
    }
  },
);

Then(
  'all decided view lines have empty changeIds',
  function (this: ChangeDownWorld) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    for (const line of view.lines) {
      assert.deepStrictEqual(
        line.changeIds,
        [],
        `Line ${line.decidedLineNum} has changeIds: ${JSON.stringify(line.changeIds)}`,
      );
    }
  },
);

Then(
  'each decided hash matches computeLineHash for its text and index',
  function (this: ChangeDownWorld) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    // Mirror the two-pass approach: collect all committed texts, then hash with allLines
    const allCommittedTexts = view.lines.map(l => l.text);
    for (const line of view.lines) {
      const expectedHash = computeLineHash(line.decidedLineNum - 1, line.text, allCommittedTexts);
      assert.strictEqual(
        line.hash,
        expectedHash,
        `Hash mismatch on decided line ${line.decidedLineNum}: got "${line.hash}", expected "${expectedHash}"`,
      );
    }
  },
);

Then(
  'decided view line {int} has flag {string}',
  function (this: ChangeDownWorld, lineNum: number, expected: string) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.ok(lineNum >= 1 && lineNum <= view.lines.length, `Line ${lineNum} out of range`);
    assert.strictEqual(view.lines[lineNum - 1].flag, expected);
  },
);

Then(
  'decided view line {int} changeIds include {string}',
  function (this: ChangeDownWorld, lineNum: number, expected: string) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.ok(lineNum >= 1 && lineNum <= view.lines.length, `Line ${lineNum} out of range`);
    assert.ok(
      view.lines[lineNum - 1].changeIds.includes(expected),
      `Expected line ${lineNum} changeIds to include "${expected}" but got: ${JSON.stringify(view.lines[lineNum - 1].changeIds)}`,
    );
  },
);

Then(
  'decided view line {int} has text {string}',
  function (this: ChangeDownWorld, lineNum: number, expected: string) {
    const view = committedViewResult.get(this);
    assert.ok(view, 'No decided view result');
    assert.ok(lineNum >= 1 && lineNum <= view.lines.length, `Line ${lineNum} out of range`);
    assert.strictEqual(view.lines[lineNum - 1].text, expected);
  },
);

// =============================================================================
// formatDecidedOutput: Then steps
// =============================================================================

Then(
  'the formatted decided output line {int} is {string}',
  function (this: ChangeDownWorld, lineNum: number, expected: string) {
    const output = formattedCommittedOutput.get(this);
    assert.ok(output, 'No formatted decided output');
    const lines = output.split('\n');
    assert.ok(lineNum >= 1 && lineNum <= lines.length, `Line ${lineNum} out of range`);
    assert.strictEqual(lines[lineNum - 1], expected);
  },
);

Then(
  'the formatted decided output line {int} starts with {string}',
  function (this: ChangeDownWorld, lineNum: number, prefix: string) {
    const output = formattedCommittedOutput.get(this);
    assert.ok(output, 'No formatted decided output');
    const lines = output.split('\n');
    assert.ok(lineNum >= 1 && lineNum <= lines.length, `Line ${lineNum} out of range`);
    assert.ok(
      lines[lineNum - 1].startsWith(prefix),
      `Expected line ${lineNum} to start with "${prefix}" but got: "${lines[lineNum - 1]}"`,
    );
  },
);

Then(
  'the formatted decided output has {int} hashline content lines',
  function (this: ChangeDownWorld, expected: number) {
    const output = formattedCommittedOutput.get(this);
    assert.ok(output, 'No formatted decided output');
    const lines = output.split('\n');
    const contentLines = lines.filter(l => l.match(/^\s*\d+:[0-9a-f]{2}/));
    assert.strictEqual(contentLines.length, expected);
  },
);

Then(
  'the formatted decided output contains {string}',
  function (this: ChangeDownWorld, expected: string) {
    const output = formattedCommittedOutput.get(this);
    assert.ok(output, 'No formatted decided output');
    assert.ok(
      output.includes(expected),
      `Expected formatted output to contain "${expected}" but got:\n${output}`,
    );
  },
);

Then(
  'the formatted decided output has a line containing {string} with flag {string}',
  function (this: ChangeDownWorld, text: string, flag: string) {
    const output = formattedCommittedOutput.get(this);
    assert.ok(output, 'No formatted decided output');
    const lines = output.split('\n');
    const matchingLine = lines.find(l => l.includes(text));
    assert.ok(matchingLine, `No formatted line contains "${text}"`);
    assert.ok(
      matchingLine.includes(flag),
      `Line containing "${text}" does not include flag "${flag}": ${matchingLine}`,
    );
  },
);
