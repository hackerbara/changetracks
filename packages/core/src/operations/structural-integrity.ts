/**
 * Structural-integrity validator for tracked CriticMarkup documents.
 *
 * Returns Diagnostic[] for any structural problem in `text`. An empty array
 * means the document is structurally valid.
 *
 * Per spec §3.7 / Tranche 6 Task 6.1.
 *
 * Checks performed (in order):
 *  1. Parser failure  → structural_invalid (with parser error message)
 *  2. Parser-emitted diagnostics (coordinate_failed, etc.) → forwarded as-is
 *  3. Nested CriticMarkup (open inside open without close) → structural_invalid
 *  4. Inline [^cn-N] ref without matching footnote def → record_orphaned
 *  5. Footnote def for a decided change without matching inline ref → surface_orphaned
 */

import type { Diagnostic } from '../model/diagnostic.js';
import type { VirtualDocument } from '../model/document.js';
import { parseForFormat } from '../format-aware-parse.js';
import { findCodeZones, buildCodeZoneMask } from '../parser/code-zones.js';
import { FOOTNOTE_ID_PATTERN, splitBodyAndFootnotes, FOOTNOTE_DEF_STATUS } from '../footnote-patterns.js';
import { ChangeStatus } from '../model/types.js';

// ── CriticMarkup open/close delimiter pairs ────────────────────────────────
// Each entry: [openDelim, closeDelim]
const CM_DELIMITERS: Array<[string, string]> = [
  ['{++', '++}'],
  ['{--', '--}'],
  ['{~~', '~~}'],
  ['{==', '==}'],
  ['{>>', '<<}'],
];

// Set of all close delimiters, mapped to their matching open.
// Used for fast close-detection during the scan.
const CM_CLOSE_TO_OPEN = new Map<string, string>([
  ['++}', '{++'],
  ['--}', '{--'],
  ['~~}', '{~~'],
  ['==}', '{=='],
  ['<<}', '{>>'],
]);

// The first character of each close delimiter, for a quick pre-filter.
const CM_CLOSE_FIRST_CHARS = new Set(['+', '-', '~', '=', '<']);

/**
 * Returns Diagnostic[] for any structural problem in `text`.
 * An empty array means the document is structurally valid.
 */
export function validateStructuralIntegrity(text: string): Diagnostic[] {
  const violations: Diagnostic[] = [];

  // ── Step 1: Parse ──────────────────────────────────────────────────────────
  let doc;
  try {
    doc = parseForFormat(text);
  } catch (err) {
    violations.push({
      kind: 'structural_invalid',
      message: `Parser threw: ${(err as Error).message}`,
    });
    return violations;
  }

  // ── Step 2: Forward parser-emitted diagnostics ─────────────────────────────
  for (const d of doc.getDiagnostics()) {
    violations.push(d);
  }

  // ── Step 3: Nested CriticMarkup detection ──────────────────────────────────
  violations.push(...detectNestedMarkup(text));

  // ── Step 4 + 5: Orphan detection ───────────────────────────────────────────
  violations.push(...detectOrphans(text, doc));

  return violations;
}

// ── Nested-markup scanner ──────────────────────────────────────────────────

/**
 * Detects nested CriticMarkup — an open delimiter encountered while another
 * open delimiter is already active. Code zones (fenced blocks, inline code)
 * are skipped to avoid false positives.
 *
 * Returns Diagnostic[] for each nesting violation found.
 */
function detectNestedMarkup(text: string): Diagnostic[] {
  // Build a bitmask: inCodeZone[i] = 1 when position i is inside a code zone.
  // Note: zone.end is exclusive (one past the last character of the zone).
  const inCodeZone = buildCodeZoneMask(text);

  const violations: Diagnostic[] = [];
  let currentOpen: string | null = null; // the open delimiter currently active

  let pos = 0;
  while (pos < text.length) {
    // Skip code zones
    if (inCodeZone[pos]) {
      pos++;
      continue;
    }

    const ch = text[pos];

    // ── Check for close delimiter (when we are inside a span) ─────────────
    // Close delimiters start with '+', '-', '~', '=', or '<'.
    if (currentOpen !== null && CM_CLOSE_FIRST_CHARS.has(ch)) {
      let closedSpan = false;
      for (const [close, matchingOpen] of CM_CLOSE_TO_OPEN) {
        if (currentOpen === matchingOpen && text.startsWith(close, pos)) {
          currentOpen = null;
          pos += close.length;
          closedSpan = true;
          break;
        }
      }
      if (closedSpan) continue;
    }

    // ── Check for open delimiter ('{' starts all opens) ───────────────────
    if (ch === '{') {
      for (const [open] of CM_DELIMITERS) {
        if (text.startsWith(open, pos)) {
          if (currentOpen !== null) {
            // Already inside a CriticMarkup span — this is nesting.
            violations.push({
              kind: 'structural_invalid',
              message: `Nested CriticMarkup: found '${open}' inside '${currentOpen}' (at offset ${pos}).`,
            });
            // Keep currentOpen as-is (the outer span) so the scan stays coherent.
          } else {
            currentOpen = open;
          }
          pos += open.length;
          break;  // Only one open can match at a given position
        }
      }
      // Whether matched or not, advance past '{' at minimum (the for-break
      // already advanced pos by open.length if matched; if not matched, we
      // still need to advance by 1 to avoid infinite loop — but the break
      // exits the for-loop without touching pos in that case).
      // Simpler: if pos didn't advance (no open matched), advance by 1.
      if (text[pos] === '{') pos++;
      continue;
    }

    pos++;
  }

  return violations;
}

// ── Orphan detector ────────────────────────────────────────────────────────

const INLINE_REF_GLOBAL = new RegExp(`\\[\\^(${FOOTNOTE_ID_PATTERN})\\]`, 'g');

/**
 * Matches a footnote definition header line (global + multiline variant of FOOTNOTE_DEF_STATUS):
 *   [^cn-N]: @author | date | type | status
 *   [^cn-N]: date | type | status
 *
 * Captures:
 *  1: full ID (e.g. "cn-1", "cn-2.3")
 *  2: status word (last pipe-delimited field)
 */
const FOOTNOTE_DEF_STATUS_GM = new RegExp(FOOTNOTE_DEF_STATUS.source, 'gm');

/** Status values that mark a change as decided (settled). */
const DECIDED_STATUSES = new Set(['accepted', 'rejected']);

/**
 * Cross-checks inline [^cn-N] refs in the body against footnote definitions
 * in the text.
 *
 * Strategy:
 *  - bodyRefs: set of IDs found as `[^cn-N]` in the body (before footnote block)
 *  - footnoteDefs: map of id → status scraped directly from footnote header lines
 *  - IDs from doc.getChanges() are also added to footnoteDefs so that L2/L3
 *    parser-produced ChangeNodes are included.
 *
 * - bodyRef not in footnoteDefs → record_orphaned
 * - footnoteDef with decided status and no bodyRef → surface_orphaned
 */
function detectOrphans(text: string, doc: VirtualDocument): Diagnostic[] {
  const violations: Diagnostic[] = [];

  // ── Split body from footnote section ──────────────────────────────────────
  const { bodyLines, footnoteLines } = splitBodyAndFootnotes(text.split('\n'));
  const bodyText = bodyLines.join('\n');
  const footnoteText = footnoteLines.join('\n');

  // ── Collect inline refs from body text (code zones excluded) ────────────
  // Scan only the body portion so [^cn-N]: definition lines are not confused
  // for inline refs. Also skip code zones (fenced blocks, inline code spans)
  // to avoid false positives from documentation examples like `[^cn-1]`.
  const bodyRefs = new Set<string>();
  const bodyCodeZones = findCodeZones(bodyText);
  INLINE_REF_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_REF_GLOBAL.exec(bodyText)) !== null) {
    // Skip refs that appear inside a code zone
    const refStart = m.index;
    const inZone = bodyCodeZones.some(z => refStart >= z.start && refStart < z.end);
    if (!inZone) {
      bodyRefs.add(m[1]);
    }
  }

  // ── Collect footnote defs from the footnote section ──────────────────────
  // Maps: id → status string (e.g. 'proposed', 'accepted', 'rejected')
  const footnoteDefs = new Map<string, string>();

  FOOTNOTE_DEF_STATUS_GM.lastIndex = 0;
  while ((m = FOOTNOTE_DEF_STATUS_GM.exec(footnoteText)) !== null) {
    footnoteDefs.set(m[1], m[2]);
  }

  // Also incorporate ChangeNodes produced by the parser (covers L3 parser
  // ChangeNodes that may not appear in the footnote header scan).
  for (const change of doc.getChanges()) {
    if (!footnoteDefs.has(change.id)) {
      const status = change.status === ChangeStatus.Accepted ? 'accepted'
        : change.status === ChangeStatus.Rejected ? 'rejected'
        : 'proposed';
      footnoteDefs.set(change.id, status);
    }
  }

  // ── Check 1: body refs not in known footnote defs → record_orphaned ────────
  for (const ref of bodyRefs) {
    if (!footnoteDefs.has(ref)) {
      violations.push({
        kind: 'record_orphaned',
        changeId: ref,
        message: `Inline ref [^${ref}] has no matching footnote definition.`,
      });
    }
  }

  // ── Check 2: decided defs without body ref → surface_orphaned ─────────────
  for (const [id, status] of footnoteDefs) {
    if (DECIDED_STATUSES.has(status) && !bodyRefs.has(id)) {
      violations.push({
        kind: 'surface_orphaned',
        changeId: id,
        message: `Footnote def [^${id}] is decided (${status}) but has no matching inline ref in the body.`,
      });
    }
  }

  return violations;
}

