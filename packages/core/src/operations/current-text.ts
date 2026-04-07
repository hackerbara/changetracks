import { ChangeNode, ChangeType, ChangeStatus, TextEdit } from '../model/types.js';
import { computeReject, computeAcceptParts, computeRejectParts, AcceptRejectParts } from './accept-reject.js';
import { computeLineHash } from '../hashline.js';
import { FOOTNOTE_DEF_START, footnoteRefGlobal, isL3Format, splitBodyAndFootnotes } from '../footnote-patterns.js';
import { findCodeZones, CodeZone, isFenceCloserLine } from '../parser/code-zones.js';
import { parseForFormat } from '../format-aware-parse.js';
import { buildContextualL3EditOp } from './footnote-generator.js';

/**
 * Computes a TextEdit that "settles" a single CriticMarkup change node using
 * **accept-all** semantics — every change is applied regardless of footnote status:
 *
 * - Insertion (any status): keep inserted text, remove markup
 * - Deletion (any status): remove everything (text is deleted)
 * - Substitution (any status): keep modified (new) text, remove markup
 * - Highlight (any status): keep highlighted text, remove markup
 * - Comment (any status): remove entirely
 *
 * This produces "the document as it would be if all proposals were approved".
 * Per V1 view model design doc §5.
 */
export function computeCurrentReplace(change: ChangeNode): TextEdit {
  const rangeLength = change.range.end - change.range.start;

  // Comments are always removed entirely
  if (change.type === ChangeType.Comment) {
    return { offset: change.range.start, length: rangeLength, newText: '' };
  }

  // Highlights always reduce to their plain text content
  if (change.type === ChangeType.Highlight) {
    return { offset: change.range.start, length: rangeLength, newText: change.originalText ?? '' };
  }

  // Accept-all: every change is treated as accepted regardless of footnote status.
  switch (change.type) {
    case ChangeType.Insertion:
      return { offset: change.range.start, length: rangeLength, newText: change.modifiedText ?? '' };
    case ChangeType.Deletion:
      return { offset: change.range.start, length: rangeLength, newText: '' };
    case ChangeType.Substitution:
      return { offset: change.range.start, length: rangeLength, newText: change.modifiedText ?? '' };
  }

  // Exhaustiveness guard: fail-fast if a new ChangeType is added without updating this switch
  throw new Error(`Unknown ChangeType: ${change.type}`);
}

// FOOTNOTE_DEF_START imported from footnote-patterns.ts

/**
 * Strips all footnote definition blocks from the text.
 * A footnote definition starts with `[^cn-N]:` at column 0 and continues
 * on subsequent indented lines (or blank lines within the body).
 * Trailing blank lines left behind are also cleaned up.
 */
function stripFootnoteDefinitions(text: string, zones: CodeZone[]): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let inFootnote = false;
  let foundFootnote = false;
  let charOffset = 0;

  for (const line of lines) {
    // Check if this line's start is inside a code zone
    const inCodeZone = zones.some(z => charOffset >= z.start && charOffset < z.end);

    if (!inCodeZone && FOOTNOTE_DEF_START.test(line)) {
      inFootnote = true;
      foundFootnote = true;
      // Remove trailing blank lines that were separators before this footnote block
      while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
        kept.pop();
      }
      charOffset += line.length + 1; // +1 for newline
      continue;
    }
    if (inFootnote) {
      // Continuation lines are indented or blank
      if (line.trim() === '' || /^[\t ]/.test(line)) {
        charOffset += line.length + 1;
        continue;
      }
      // Non-indented, non-blank line ends the footnote body
      inFootnote = false;
    }
    kept.push(line);
    charOffset += line.length + 1;
  }

  // Only strip trailing blank lines if we actually removed footnote definitions
  if (foundFootnote) {
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
      kept.pop();
    }
  }

  return kept.join('\n');
}

/**
 * Strips orphaned inline footnote references `[^cn-N]` or `[^cn-N.M]` that
 * remain in the text after CriticMarkup processing (these are not part of any
 * change node's range and appear as bare refs in the settled text).
 */
function stripInlineFootnoteRefs(text: string, zones: CodeZone[]): string {
  return text.replace(footnoteRefGlobal(), (match, offset) => {
    if (zones.some(z => offset >= z.start && offset < z.end)) {
      return match; // preserve refs inside code zones
    }
    return '';
  });
}

export interface CurrentTextOptions {
  /** When true, the parser skips CriticMarkup inside fenced code blocks and
   *  inline code spans. Default: false (backward compatible with existing callers). */
  skipCodeBlocks?: boolean;
}

/**
 * Computes the settled state of an L3 (footnote-native) document.
 * L3 body already contains the accepted state — just strip the footnote block.
 */
function computeCurrentTextL3(text: string): string {
  const { bodyLines } = splitBodyAndFootnotes(text.split('\n'));
  return bodyLines.join('\n') + '\n';
}

/**
 * Computes the original (reject-all) view of an L3 document.
 *
 * For L3, the body reflects the current state (proposed changes applied).
 * To get the "original" view: undo all proposed changes.
 * - Proposed insertion → remove from body (text was added, undo it)
 * - Proposed deletion → restore originalText (text was removed, put it back)
 * - Proposed substitution → revert to originalText
 * - Accepted/rejected changes are already resolved in the body — leave as-is
 */
/**
 * Revert changes in body text by undoing their effects. Processes changes
 * in reverse offset order to preserve positions. Used by both
 * computeOriginalTextL3 and applyRejectedChanges.
 */
function revertChangesInBody(body: string, changes: ChangeNode[]): string {
  const sorted = [...changes].sort((a, b) => b.range.start - a.range.start);
  for (const change of sorted) {
    if (change.anchored === false) continue;
    switch (change.type) {
      case ChangeType.Insertion:
        body = body.slice(0, change.range.start) + body.slice(change.range.end);
        break;
      case ChangeType.Deletion:
        if (change.originalText) {
          body = body.slice(0, change.range.start) + change.originalText + body.slice(change.range.start);
        }
        break;
      case ChangeType.Substitution:
        if (change.originalText) {
          body = body.slice(0, change.range.start) + change.originalText + body.slice(change.range.end);
        }
        break;
    }
  }
  return body;
}

function computeOriginalTextL3(text: string): string {
  const doc = parseForFormat(text);
  const allChanges = doc.getChanges();

  const { bodyLines } = splitBodyAndFootnotes(text.split('\n'));
  let body = bodyLines.join('\n');

  if (allChanges.length > 0) {
    body = revertChangesInBody(body, allChanges);
  }

  // Strip orphaned inline footnote refs left behind after reverting changes
  const zones = findCodeZones(body);
  body = stripInlineFootnoteRefs(body, zones);

  return body + '\n';
}

/**
 * Computes the "settled state" of a CriticMarkup document using accept-all semantics.
 *
 * The settled text represents what the document would look like if every proposed
 * change were approved:
 * - All insertions are kept (text absorbed, markup removed) regardless of status
 * - All deletions are applied (text removed) regardless of status
 * - All substitutions use new text regardless of status
 * - Highlights reduce to plain text
 * - Comments are removed entirely
 * - Footnote definitions are stripped
 * - Orphaned inline footnote references are stripped
 *
 * For L3 (footnote-native) format, the body already reflects the accepted state,
 * so this function routes to computeCurrentTextL3 which simply strips the footnote
 * block. This gives SCM QuickDiff and all other consumers free L3 support.
 *
 * Per V1 view model design doc §5: settled = "document as it would be if all
 * proposals were approved". The committed view (separate function) handles
 * status-aware rendering.
 *
 * This is a pure function: it does not modify the input string.
 */
export function computeCurrentText(text: string, options?: CurrentTextOptions): string {
  // L3 format: footnote-native body is already the settled state.
  // Auto-detect: has [^cn-N]: footnote defs, no inline CriticMarkup in body,
  // and at least one L3 footnote body line (LINE:HASH {op}).
  if (isL3Format(text)) {
    return computeCurrentTextL3(text);
  }

  const doc = parseForFormat(text, { skipCodeBlocks: options?.skipCodeBlocks ?? false });
  const changes = doc.getChanges();

  if (changes.length === 0) {
    // Compute zones on original text (no edits to shift offsets)
    const zones = findCodeZones(text);
    return stripInlineFootnoteRefs(stripFootnoteDefinitions(text, zones), zones);
  }

  // Sort changes by descending offset so we can apply edits from end to start
  // without invalidating earlier offsets
  const edits = [...changes]
    .sort((a, b) => b.range.start - a.range.start)
    .map(computeCurrentReplace);

  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.offset) + edit.newText + result.slice(edit.offset + edit.length);
  }

  // Compute zones on intermediate text (post-edit, pre-strip).
  // CriticMarkup edits can shift code fence offsets, so zones must be computed
  // on the intermediate result. Footnote definitions always appear after all
  // content and code fences, so stripping them does not shift zone offsets.
  const zones = findCodeZones(result);
  result = stripFootnoteDefinitions(result, zones);
  result = stripInlineFootnoteRefs(result, zones);

  return result;
}
/**
 * Compute the "Original" view: reject all changes, strip all markup.
 * Insertions are removed entirely. Deletions keep their content.
 * Substitutions keep the original (pre-change) text.
 */
export function computeOriginalText(text: string, options?: CurrentTextOptions): string {
  if (isL3Format(text)) {
    return computeOriginalTextL3(text);
  }

  const doc = parseForFormat(text, { skipCodeBlocks: options?.skipCodeBlocks ?? false });
  const changes = doc.getChanges();

  if (changes.length === 0) {
    const zones = findCodeZones(text);
    return stripInlineFootnoteRefs(stripFootnoteDefinitions(text, zones), zones);
  }

  const edits = [...changes]
    .sort((a, b) => b.range.start - a.range.start)
    .map(computeReject);

  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.offset) + edit.newText + result.slice(edit.offset + edit.length);
  }

  const zones = findCodeZones(result);
  result = stripFootnoteDefinitions(result, zones);
  result = stripInlineFootnoteRefs(result, zones);

  return result;
}

// ─── Zone-aware ref placement ────────────────────────────────────────────────

/**
 * Check whether a given offset falls inside any code zone.
 * Returns the zone if found, undefined otherwise.
 */
function findContainingCodeZone(offset: number, zones: CodeZone[]): CodeZone | undefined {
  for (const zone of zones) {
    if (offset >= zone.start && offset < zone.end) return zone;
  }
  return undefined;
}

interface DeferredRef {
  ref: string;
  /** Line number in the original text (0-indexed) */
  origLineIndex: number;
}

/**
 * Build settled text with zone-aware ref placement.
 * Refs for edits inside code zones are deferred to end-of-line.
 */
function buildSegmentsWithZoneAwareness(
  text: string,
  parts: AcceptRejectParts[],
  zones: CodeZone[],
): string {
  const segments: string[] = [];
  const deferredRefs: DeferredRef[] = [];
  let cursor = 0;

  // Pre-compute line boundaries in original text for offset→line mapping
  const lineBreaks: number[] = []; // offsets of each '\n'
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineBreaks.push(i);
  }

  function offsetToLine(offset: number): number {
    // Binary search for the line containing offset (0-indexed)
    let lo = 0;
    let hi = lineBreaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lineBreaks[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  for (const part of parts) {
    // Original text before this edit
    if (part.offset > cursor) {
      segments.push(text.slice(cursor, part.offset));
    } else if (part.offset < cursor) {
      continue; // overlapping edit, skip
    }

    const ref = part.refId ? `[^${part.refId}]` : '';

    if (ref && findContainingCodeZone(part.offset, zones)) {
      // Edit is inside a code zone — emit text without ref, defer ref to end of line
      segments.push(part.text);
      deferredRefs.push({ ref, origLineIndex: offsetToLine(part.offset) });
    } else if (ref && zones.length > 0) {
      // Fence-closer guard (only needed when document has code zones)
      const targetLineIdx = offsetToLine(part.offset);
      const lineStartOff = targetLineIdx === 0 ? 0 : lineBreaks[targetLineIdx - 1] + 1;
      const lineEndOff = targetLineIdx < lineBreaks.length ? lineBreaks[targetLineIdx] : text.length;
      const targetLine = text.slice(lineStartOff, lineEndOff);
      if (isFenceCloserLine(targetLine)) {
        segments.push(part.text);
        deferredRefs.push({ ref, origLineIndex: targetLineIdx + 1 });
      } else {
        segments.push(part.text + ref);
      }
    } else {
      // No code zones or no ref — place inline
      segments.push(part.text + ref);
    }

    cursor = part.offset + part.length;
  }

  // Remaining original text
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }

  if (deferredRefs.length === 0) {
    return segments.join('');
  }

  // Apply deferred refs: split result into lines, append refs at their target lines
  const result = segments.join('');
  const lines = result.split('\n');

  // Group deferred refs by their original line index.
  // INVARIANT: Settlement does not add or remove newlines — each AcceptRejectParts
  // replacement is inline (same line). The line index in the result corresponds to
  // the same line index in the original text. If multi-line range settlement is
  // added in the future, this mapping must be recalculated.
  const refsByLine = new Map<number, string[]>();
  for (const dr of deferredRefs) {
    const existing = refsByLine.get(dr.origLineIndex) ?? [];
    existing.push(dr.ref);
    refsByLine.set(dr.origLineIndex, existing);
  }

  for (const [lineIdx, refs] of refsByLine) {
    if (lineIdx < lines.length) {
      lines[lineIdx] = lines[lineIdx] + refs.join('');
    } else {
      // Target line doesn't exist (fence closer was last line) — append new line
      while (lines.length <= lineIdx) lines.push('');
      lines[lineIdx] = refs.join('');
    }
  }

  return lines.join('\n');
}

/**
 * When optional text fields are empty but markup ranges are present, recover
 * old/new strings from the source document (L2 settlement edit-op generation).
 */
function recoverL2EditOpPayload(
  change: ChangeNode,
  sourceText: string,
): { originalText: string; currentText: string } {
  let orig = change.originalText ?? '';
  let cur = change.modifiedText ?? '';
  if (change.type === ChangeType.Insertion) {
    if (!cur && change.contentRange) {
      cur = sourceText.slice(change.contentRange.start, change.contentRange.end);
    }
  } else if (change.type === ChangeType.Substitution) {
    if (!cur && change.modifiedRange) {
      cur = sourceText.slice(change.modifiedRange.start, change.modifiedRange.end);
    }
    if (!orig && change.originalRange) {
      orig = sourceText.slice(change.originalRange.start, change.originalRange.end);
    }
  }
  return { originalText: orig, currentText: cur };
}

/**
 * Settles only accepted changes: resolves their markup to clean text while
 * preserving footnote references and definitions. Proposed and rejected changes
 * are left untouched. Uses parser range information (no regex replacement) so
 * substitution text that looks like CriticMarkup is handled correctly.
 *
 * For L2: removes inline CriticMarkup delimiters but keeps footnote references
 * [^cn-N] and footnote definition blocks with their 'accepted' status.
 *
 * For L3: no-op. The body is already the Current projection (accepted text
 * present), and edit-op lines must be preserved per ADR-C §2.
 *
 * Synchronous: L2 edit-op generation uses `computeLineHash`, which requires
 * xxhash-wasm. Call `await initHashline()` once before the first L2 settlement
 * (CLI/LSP do this at startup; async callers such as DOCX export await
 * `initHashline` before calling this).
 */
export function applyAcceptedChanges(text: string): { currentContent: string; appliedIds: string[] } {
  if (isL3Format(text)) {
    return { currentContent: text, appliedIds: [] };
  }

  const doc = parseForFormat(text, { skipCodeBlocks: false });
  const accepted = doc.getChanges().filter((c) => c.status === ChangeStatus.Accepted);
  const appliedIds = accepted.map((c) => c.id);

  if (accepted.length === 0) {
    return { currentContent: text, appliedIds: [] };
  }

  // Get parts (text + ref separated) for each accepted change
  const parts = [...accepted]
    .sort((a, b) => a.range.start - b.range.start)
    .map(computeAcceptParts);

  const zones = findCodeZones(text);
  const rawCurrentContent = buildSegmentsWithZoneAwareness(text, parts, zones);

  // ─── Edit-op generation ────────────────────────────────────────────────
  // After settlement the body contains accepted text inline with [^cn-N] refs.
  // We need to generate LINE:HASH edit-op lines and splice them into each
  // accepted change's footnote block.

  const { bodyLines, footnoteLines } = splitBodyAndFootnotes(rawCurrentContent.split('\n'));

  // Build ref-stripped body for column computation and hashing
  const refRe = footnoteRefGlobal();
  const cleanBodyLines = bodyLines.map(line => line.replace(refRe, ''));

  // Pre-index: ref marker → { lineIdx, col } for O(1) lookup per change
  const refIndex = new Map<string, { lineIdx: number; col: number }>();
  for (let i = 0; i < bodyLines.length; i++) {
    const refPattern = /\[\^cn-[\w.]+\]/g;
    let rm: RegExpExecArray | null;
    while ((rm = refPattern.exec(bodyLines[i])) !== null) {
      refIndex.set(rm[0], { lineIdx: i, col: rm.index });
    }
  }

  // Pre-index: change ID → footnote header line for O(1) lookup per change
  const footnoteHeaderIndex = new Map<string, number>();
  for (let i = 0; i < footnoteLines.length; i++) {
    const idMatch = footnoteLines[i].match(/^\[\^(cn-[\w.]+)\]:/);
    if (idMatch) footnoteHeaderIndex.set(idMatch[1], i);
  }

  // Single regex for scanning preceding refs (reused across iterations)
  const scanRe = footnoteRefGlobal();

  const editOpInsertions: Array<{ headerLine: number; editOpLine: string }> = [];

  for (const change of accepted) {
    const { originalText: effOrig, currentText: effCur } = recoverL2EditOpPayload(change, text);

    // Look up ref position from pre-built index
    const refPos = refIndex.get(`[^${change.id}]`);
    if (!refPos) continue;
    const { lineIdx, col: refColInLine } = refPos;

    let anchorLen: number;
    switch (change.type) {
      case ChangeType.Insertion:
      case ChangeType.Substitution:
        anchorLen = effCur.length;
        break;
      case ChangeType.Deletion:
        anchorLen = 0;
        break;
      case ChangeType.Highlight:
        anchorLen = (change.originalText ?? '').length;
        break;
      default:
        anchorLen = 0;
        break;
    }

    // Column on ref-stripped line: subtract bytes of preceding refs on this line
    scanRe.lastIndex = 0;
    let precedingRefBytes = 0;
    let m: RegExpExecArray | null;
    while ((m = scanRe.exec(bodyLines[lineIdx])) !== null) {
      if (m.index >= refColInLine) break;
      precedingRefBytes += m[0].length;
    }
    const changeCol = Math.max(0, refColInLine - precedingRefBytes - anchorLen);

    const lineNumber = lineIdx + 1;
    const hash = computeLineHash(lineIdx, cleanBodyLines[lineIdx], cleanBodyLines);

    const editOpLine = buildContextualL3EditOp({
      changeType: change.type,
      originalText: effOrig,
      currentText: effCur,
      lineContent: cleanBodyLines[lineIdx],
      lineNumber,
      hash,
      column: changeCol,
      anchorLen,
    });

    const headerLine = footnoteHeaderIndex.get(change.id);
    if (headerLine !== undefined) {
      editOpInsertions.push({ headerLine, editOpLine });
    }
  }

  // Splice edit-op lines into footnote blocks in reverse order to avoid index invalidation
  editOpInsertions.sort((a, b) => b.headerLine - a.headerLine);
  for (const { headerLine, editOpLine } of editOpInsertions) {
    footnoteLines.splice(headerLine + 1, 0, editOpLine);
  }

  // Reassemble: body + blank line + footnotes
  const currentContent = [...bodyLines, '', ...footnoteLines].join('\n');

  return { currentContent, appliedIds };
}

/**
 * Settles only rejected changes: resolves their markup to clean text while
 * preserving footnote references and definitions. Proposed and accepted changes
 * are left untouched. Uses parser range information (no regex replacement) so
 * substitution text that looks like CriticMarkup is handled correctly.
 *
 * For L2: removes rejected inline CriticMarkup (insertions removed, deletions
 * and substitutions reverted to original text). Footnote refs stay.
 *
 * For L3: reverts the body (removes rejected insertions, restores rejected
 * deletions/substitutions) but preserves edit-op lines per ADR-C §2.
 */
export function applyRejectedChanges(text: string): { currentContent: string; appliedIds: string[] } {
  // L3 rejected settlement: revert the body (remove rejected insertions,
  // restore rejected deletions/substitutions) but preserve edit-op lines
  // per ADR-C §2. The edit-op anchors become stale after body reversion —
  // this is expected. The Resolution Protocol handles stale anchors via
  // fast-path exits and intermediate-state replay.
  if (isL3Format(text)) {
    const doc = parseForFormat(text);
    const rejected = doc.getChanges().filter((c) => c.status === ChangeStatus.Rejected);
    const appliedIds = rejected.map((c) => c.id);
    if (rejected.length === 0) return { currentContent: text, appliedIds: [] };

    const { bodyLines, footnoteLines } = splitBodyAndFootnotes(text.split('\n'));
    const body = revertChangesInBody(bodyLines.join('\n'), rejected);

    const currentContent = footnoteLines.length > 0
      ? body + '\n\n' + footnoteLines.join('\n')
      : body;
    return { currentContent, appliedIds };
  }

  const doc = parseForFormat(text, { skipCodeBlocks: false });
  const rejected = doc.getChanges().filter((c) => c.status === ChangeStatus.Rejected);
  const appliedIds = rejected.map((c) => c.id);

  if (rejected.length === 0) {
    return { currentContent: text, appliedIds: [] };
  }

  const parts = [...rejected]
    .sort((a, b) => a.range.start - b.range.start)
    .map(computeRejectParts);

  const zones = findCodeZones(text);
  const currentContent = buildSegmentsWithZoneAwareness(text, parts, zones);

  return { currentContent, appliedIds };
}

// ─── Settled view types ──────────────────────────────────────────────────────

export interface CurrentLine {
  currentLineNum: number;  // 1-indexed, sequential (no gaps)
  rawLineNum: number;      // 1-indexed, raw file line number
  text: string;            // settled text (no CriticMarkup, no footnotes)
  hash: string;            // hash of settled text (2 hex chars)
}

export interface CurrentViewResult {
  lines: CurrentLine[];
  currentToRaw: Map<number, number>;  // settled line num → raw line num
  rawToCurrent: Map<number, number>;  // raw line num → settled line num
  changes?: ChangeNode[];
}

// ─── Settled view computation ────────────────────────────────────────────────

/**
 * L3 fast-path: body is already the settled view (1:1 line mapping).
 * Strip footnote section and build line mappings directly.
 */
function computeCurrentViewL3(rawText: string): CurrentViewResult {
  const { bodyLines } = splitBodyAndFootnotes(rawText.split('\n'));
  const lines: CurrentLine[] = [];
  const currentToRaw = new Map<number, number>();
  const rawToCurrent = new Map<number, number>();

  for (let i = 0; i < bodyLines.length; i++) {
    const currentNum = i + 1;  // 1-indexed
    const rawNum = i + 1;      // 1:1 mapping for body lines
    lines.push({
      currentLineNum: currentNum,
      rawLineNum: rawNum,
      text: bodyLines[i],
      hash: computeLineHash(i, bodyLines[i], bodyLines),
    });
    currentToRaw.set(currentNum, rawNum);
    rawToCurrent.set(rawNum, currentNum);
  }

  return { lines, currentToRaw, rawToCurrent };
}

/**
 * Compute the settled view for an entire file using accept-all semantics.
 *
 * Uses the parser-based `computeCurrentText()` for correct handling of multi-line
 * CriticMarkup, then builds line mappings by tracking offset deltas through the
 * edits applied. This provides:
 *
 * 1. Correct settled text (multi-line markup handled via parser)
 * 2. settled-line-num → raw-line-num mapping for coordinate resolution
 * 3. Per-line hashes for settled-space write targeting
 *
 * Returns structured data enabling settled-space → raw-space coordinate mapping
 * (the settled-space analog of committed-space write targeting from ADR-049).
 *
 * **Mapping strategy:** Applies CriticMarkup edits forward, tracking cumulative
 * offset deltas. For each line in the settled text, maps its starting offset
 * back through the deltas to find the corresponding raw line. Footnote and
 * inline-ref stripping are line-level operations that preserve the character-to-line
 * correspondence established by the CriticMarkup edits.
 */
export function computeCurrentView(rawText: string, preParsed?: ChangeNode[]): CurrentViewResult {
  // L3 early-return: body is already the settled view
  if (isL3Format(rawText)) {
    return computeCurrentViewL3(rawText);
  }

  // 1. Get parser edits for CriticMarkup settlement
  const changes = preParsed ?? parseForFormat(rawText, { skipCodeBlocks: false }).getChanges();

  // 2. Apply CriticMarkup edits and build offset delta table
  // Each entry: { rawOffset, delta } where delta = cumulative shift
  // (positive = settled text is longer at this point, negative = shorter)
  const edits = [...changes]
    .sort((a, b) => a.range.start - b.range.start)
    .map(computeCurrentReplace);

  // Build delta table: sorted by raw offset
  // delta = how much the settled text has shifted relative to raw at this point
  const deltaTable: Array<{ rawOffset: number; delta: number }> = [];
  let cumulativeDelta = 0;

  for (const edit of edits) {
    deltaTable.push({ rawOffset: edit.offset, delta: cumulativeDelta });
    const oldLen = edit.length;
    const newLen = edit.newText.length;
    cumulativeDelta += (newLen - oldLen);
  }

  // Build offset → edit lookup for O(1) access in currentOffsetToRawOffset.
  // Replaces linear edits.find() scan that was O(n) per delta table entry.
  const editsByOffset = new Map(edits.map(e => [e.offset, e]));

  // Function: map a settled offset back to the approximate raw offset
  // For a given offset in the settled text, find which raw offset it corresponds to.
  // We invert the forward mapping: currentOffset = rawOffset + delta
  // => rawOffset = currentOffset - delta (using the delta that was active at that raw position)
  function currentOffsetToRawOffset(currentOffset: number): number {
    // Walk through delta table to find the right delta
    // The settled offset = raw offset + cumulative delta at that point
    // We need to find which raw range this settled offset falls in
    let delta = 0;
    let rawConsumed = 0;
    let currentConsumed = 0;

    for (const entry of deltaTable) {
      // Gap between previous edit end and this edit start (in raw space)
      const rawGap = entry.rawOffset - rawConsumed;
      // This gap maps 1:1 in settled space
      if (currentOffset <= currentConsumed + rawGap) {
        // The target settled offset is in the gap before this edit
        return rawConsumed + (currentOffset - currentConsumed);
      }
      currentConsumed += rawGap;
      rawConsumed = entry.rawOffset;
      delta = entry.delta;

      // Find the corresponding edit to get old/new lengths
      const edit = editsByOffset.get(entry.rawOffset);
      if (edit) {
        const oldLen = edit.length;
        const newLen = edit.newText.length;
        if (currentOffset < currentConsumed + newLen) {
          // The target is inside this edit's new text
          // Map to the start of the edit in raw space
          return rawConsumed;
        }
        currentConsumed += newLen;
        rawConsumed += oldLen;
      }
    }

    // Past all edits: 1:1 mapping with final cumulative delta
    return rawConsumed + (currentOffset - currentConsumed);
  }

  // 3. Compute settled text via the standard function (handles multi-line correctly)
  const currentText = computeCurrentText(rawText);

  // 4. Build line start offsets for raw text
  const rawLines = rawText.split('\n');
  const rawLineStarts: number[] = [0]; // 0-indexed offsets
  for (let i = 0; i < rawLines.length - 1; i++) {
    rawLineStarts.push(rawLineStarts[i] + rawLines[i].length + 1);
  }

  // Function: offset to raw line number (1-indexed)
  function rawOffsetToLineNum(offset: number): number {
    // Binary search for the line containing this offset
    let lo = 0;
    let hi = rawLineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rawLineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-indexed
  }

  // 5. Split settled text into lines and build mappings
  const currentTextLines = currentText.split('\n');
  const currentLines: CurrentLine[] = [];
  const currentToRaw = new Map<number, number>();
  const rawToCurrent = new Map<number, number>();

  let currentCharOffset = 0;
  for (let i = 0; i < currentTextLines.length; i++) {
    const currentLineText = currentTextLines[i];
    const currentLineNum = i + 1;

    // Map the start of this settled line back to raw offset, then to raw line
    const rawOffset = currentOffsetToRawOffset(currentCharOffset);
    const rawLineNum = rawOffsetToLineNum(rawOffset);

    const hash = computeLineHash(currentLineNum - 1, currentLineText, currentTextLines);

    currentLines.push({
      currentLineNum,
      rawLineNum,
      text: currentLineText,
      hash,
    });

    currentToRaw.set(currentLineNum, rawLineNum);
    if (!rawToCurrent.has(rawLineNum)) {
      rawToCurrent.set(rawLineNum, currentLineNum);
    }

    currentCharOffset += currentLineText.length + 1; // +1 for newline
  }

  return { lines: currentLines, currentToRaw, rawToCurrent, changes };
}
