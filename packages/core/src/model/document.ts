import {
  ChangeNode,
  ChangeStatus,
  ChangeType,
  isGhostNode,
  OffsetRange,
  PendingOverlay,
  UnresolvedDiagnostic,
} from "./types.js";
import type { Footnote } from "./footnote.js";
import {
  UnresolvedChangesError,
  type Diagnostic,
  type DiagnosticKind,
} from "./diagnostic.js";

export interface ChangeDownRecord {
  readonly id: string;
  readonly author: string;
  readonly date: string;
  readonly type: string;
  readonly status: string;
  readonly reviewable: boolean;
  readonly metadata: Readonly<Record<string, string>>;
  readonly bodyLines: readonly string[];
}

export class VirtualDocument {
  private changes: ChangeNode[];
  private records: ChangeDownRecord[];
  readonly coherenceRate: number;
  readonly unresolvedDiagnostics: UnresolvedDiagnostic[];
  readonly resolvedText?: string;
  private diagnostics: Diagnostic[] = [];

  constructor(
    changes: ChangeNode[] = [],
    coherenceRate: number = 100,
    unresolvedDiagnostics: UnresolvedDiagnostic[] = [],
    resolvedText?: string,
    records: ChangeDownRecord[] = []
  ) {
    this.changes = changes;
    this.records = records;
    this.coherenceRate = coherenceRate;
    this.unresolvedDiagnostics = unresolvedDiagnostics;
    this.resolvedText = resolvedText;
  }

  /**
   * Create a VirtualDocument from a pending overlay only (no parse).
   * Used when LSP is disconnected and overlay exists — enables display of
   * pending insertion before LSP connects.
   */
  static fromOverlayOnly(overlay: PendingOverlay): VirtualDocument {
    const change: ChangeNode = {
      id: overlay.scId ?? `cn-pending-${overlay.range.start}`,
      type: ChangeType.Insertion,
      status: ChangeStatus.Proposed,
      range: overlay.range,
      contentRange: overlay.range,
      modifiedText: overlay.text,
      level: 1,
      anchored: false,
      resolved: true,
    };
    return new VirtualDocument([change]);
  }

  getChanges(): ChangeNode[] {
    return this.changes;
  }

  getRecords(): ChangeDownRecord[] {
    return this.records.slice();
  }

  getReviewableChanges(): ChangeNode[] {
    return this.changes.filter(
      (change) =>
        String(
          change.metadata?.status ??
            change.inlineMetadata?.status ??
            change.status
        ).toLowerCase() === "proposed"
    );
  }

  /** Returns L2+ ghost nodes that failed anchor resolution. L0/L1 unanchored nodes are excluded. */
  getUnresolvedChanges(): ChangeNode[] {
    return this.changes.filter((c) => isGhostNode(c));
  }

  changeAtOffset(offset: number): ChangeNode | null {
    for (const change of this.changes) {
      if (
        change.range.start === change.range.end
          ? offset === change.range.start
          : offset >= change.range.start && offset < change.range.end
      ) {
        return change;
      }
    }
    return null;
  }

  acceptChange(id: string): void {
    const change = this.changes.find((c) => c.id === id);
    if (change) {
      change.status = ChangeStatus.Accepted;
    }
  }

  rejectChange(id: string): void {
    const change = this.changes.find((c) => c.id === id);
    if (change) {
      change.status = ChangeStatus.Rejected;
    }
  }

  /**
   * Returns all changes belonging to a given group (e.g., a move operation).
   * Changes are identified by their groupId field.
   */
  getGroupMembers(groupId: string): ChangeNode[] {
    return this.changes.filter((c) => c.groupId === groupId);
  }

  /**
   * Returns a readonly view of diagnostics emitted during parsing or
   * subsequent operations on this document. Diagnostics live on the
   * document, not on individual ChangeNodes — see model/diagnostic.ts.
   */
  getDiagnostics(): readonly Diagnostic[] {
    return this.diagnostics;
  }

  /**
   * Append a diagnostic. Called by parsers during construction and by
   * recovery paths that detect new issues. Not part of the read API
   * surface for ordinary consumers.
   */
  addDiagnostic(d: Diagnostic): void {
    this.diagnostics.push(d);
  }

  /**
   * Remove all diagnostics whose changeId matches. Used by the replay
   * protocol in footnote-native-parser when a previously-failed change
   * is recovered, and by review-changes when a change settles.
   */
  removeDiagnosticsForChange(changeId: string): void {
    this.diagnostics = this.diagnostics.filter((d) => d.changeId !== changeId);
  }
}

// ── Typed document model ──────────────────────────────────────────────
// See docs/superpowers/specs/2026-04-07-view-and-format-cleanup-design.md

/** Format discriminator for the typed Document union. */
export type Format = "L2" | "L3";

/**
 * An L2 document: body text with inline CriticMarkup and optional footnote log.
 * Field is called `text` (not `body`) because in L2 the markup is structurally
 * part of the body — splitting "clean body" from "markup" is not meaningful.
 */
export interface L2Document {
  readonly format: "L2";
  readonly text: string;
  readonly footnotes: readonly Footnote[];
}

/**
 * An L3 document: clean body text plus footnote log.
 * Field is called `body` (not `text`) to emphasize the clean separation
 * — no inline CriticMarkup, no footnote refs in the body.
 */
export interface L3Document {
  readonly format: "L3";
  readonly body: string;
  readonly footnotes: readonly Footnote[];
}

/** Typed document union. `format` is the discriminator. */
export type Document = L2Document | L3Document;

/**
 * Throws UnresolvedChangesError if the document carries any blocking
 * diagnostics. Mutation paths (settlement, propose, amend, supersede,
 * review_changes, LSP accept/reject, DOCX export) call this BEFORE any
 * byte splice — see spec §3.4 for the full call-site enumeration in
 * Tranche 3.
 *
 * Blocking kinds: coordinate_failed, anchor_ambiguous, anchor_missing,
 * structural_invalid.
 *
 * Non-blocking by default: record_orphaned, surface_orphaned (footnote/body
 * desync but doesn't corrupt the body).
 *
 * The `allow` option lets specific call sites whitelist a kind that's
 * safe in their context (for example, the repair command may permit
 * coordinate_failed because it intends to fix exactly that condition).
 *
 * Per spec §3.1, Tranche 1 Task 1.4.
 */
const BLOCKING_KINDS: ReadonlySet<DiagnosticKind> = new Set([
  "coordinate_failed",
  "anchor_ambiguous",
  "anchor_missing",
  "structural_invalid",
]);

export function assertResolved(
  doc: VirtualDocument,
  options?: { allow?: DiagnosticKind[] }
): void {
  const allowed = new Set(options?.allow ?? []);
  const violations = doc
    .getDiagnostics()
    .filter((d) => BLOCKING_KINDS.has(d.kind) && !allowed.has(d.kind));
  if (violations.length > 0) throw new UnresolvedChangesError(violations);
}
