/**
 * Typed Footnote model.
 *
 * Represents a single footnote definition from the footnote log, with the
 * body parsed into a discriminated FootnoteLine union that preserves source
 * order for round-trip safety, plus derived projections (discussion,
 * approvals, rejections, etc.) for consumer convenience.
 *
 * See docs/superpowers/specs/2026-04-07-view-and-format-cleanup-design.md
 * §"Typed document model" for the design rationale.
 */

import type { DiscussionComment, Resolution, Approval } from './types.js';
// Compile-time sanity check: Resolution uses `type` as discriminator, not `kind`.
// The spec draft showed `kind: 'open'` but the concrete type uses `type: 'open'`.
// If this line errors, someone renamed the discriminator in model/types.ts.
const _RESOLUTION_SHAPE_CHECK: Resolution = { type: 'open' };
void _RESOLUTION_SHAPE_CHECK;

/**
 * The canonical parsed header of a footnote definition line.
 *
 * Format on disk: `[^cn-N]: @author | date | type | status`
 * Or for sub-footnotes: `[^cn-N.M]: @author | date | type | status`
 *
 * Note: `author` is stored with the `@` prefix preserved (e.g. `@alice`).
 */
export interface FootnoteHeader {
  readonly author: string;
  readonly date: string;
  readonly type: string;
  readonly status: 'proposed' | 'accepted' | 'rejected';
}


/**
 * Edit-op line inside a footnote definition (L3 only).
 *
 * Discriminated union: when `resolutionPath === 'context'`, `contextBefore` and
 * `contextAfter` are required. TypeScript enforces this at the call site — you
 * cannot construct the 'context' variant with undefined context fields.
 */
export type EditOp =
  | {
      readonly resolutionPath: 'hash';
      readonly lineNumber: number;   // 1-indexed body line
      readonly hash: string;          // hex line hash
      readonly op: string;            // the CriticMarkup op text, e.g. "brown"
      readonly contextBefore?: string;
      readonly contextAfter?: string;
    }
  | {
      readonly resolutionPath: 'context';
      readonly lineNumber: number;   // 1-indexed body line
      readonly hash: string;          // hex line hash
      readonly op: string;            // the CriticMarkup op text, e.g. "brown"
      readonly contextBefore: string;  // required — present because resolutionPath === 'context'
      readonly contextAfter: string;   // required — present because resolutionPath === 'context'
    };

/**
 * A single line inside a footnote body, typed by its role.
 *
 * FootnoteLine is a discriminated union — new line kinds can be added
 * without breaking existing consumers. The 'unknown' variant preserves
 * round-trip safety for any line pattern the parser doesn't recognize.
 *
 * The serializer walks `bodyLines` in order; each variant carries its
 * original `raw` bytes (minus trailing newline) for fidelity.
 */
export type FootnoteLine =
  | { readonly kind: 'edit-op'; readonly editOp: EditOp; readonly raw: string }
  | { readonly kind: 'reason'; readonly text: string; readonly raw: string }
  | { readonly kind: 'context'; readonly text: string; readonly raw: string }
  | { readonly kind: 'discussion'; readonly reply: DiscussionComment; readonly raw: string }
  | { readonly kind: 'approval'; readonly action: Approval; readonly raw: string }
  | { readonly kind: 'rejection'; readonly action: Approval; readonly raw: string }
  | { readonly kind: 'resolution'; readonly resolution: Resolution; readonly raw: string }
  | { readonly kind: 'image-meta'; readonly key: string; readonly value: string; readonly raw: string }
  | { readonly kind: 'equation-meta'; readonly key: string; readonly value: string; readonly raw: string }
  | { readonly kind: 'blank'; readonly raw: '' }
  | { readonly kind: 'unknown'; readonly raw: string };

/**
 * A typed footnote: one entry in the footnote log.
 *
 * `bodyLines` is the canonical representation — ordered, interleaved, round-
 * trip safe. The parallel projection fields (`discussion`, `approvals`, etc.)
 * are computed eagerly during parse and provide convenience access for
 * consumers that don't need the raw stream.
 */
export interface Footnote {
  readonly id: string;             // "cn-1", "cn-3.2"
  readonly header: FootnoteHeader;
  readonly editOp: EditOp | null;  // null for footnotes without an edit-op line

  /** Canonical body representation. Source order preserved. */
  readonly bodyLines: readonly FootnoteLine[];

  // ── Derived projections (computed eagerly at parse time) ────────────
  readonly reason?: string;          // first 'reason' line, if present
  readonly context?: string;         // first 'context' line, if present
  readonly discussion: readonly DiscussionComment[];
  readonly approvals: readonly Approval[];
  readonly rejections: readonly Approval[];
  readonly resolution: Resolution | null;
  readonly imageMetadata?: Readonly<Record<string, string>>;
  readonly equationMetadata?: Readonly<Record<string, string>>;

  /**
   * Source line range of the footnote block (0-indexed, inclusive).
   * Required by Plan 4 (plan builder) for footnote block dimming:
   * plan builder reads `document.footnotes[0]?.sourceRange.startLine`
   * to know where to begin dimming.
   */
  readonly sourceRange: { startLine: number; endLine: number };
}

/** Re-export for spec-vocabulary convenience. */
export type DiscussionReply = DiscussionComment;
export type ReviewAction = Approval;
