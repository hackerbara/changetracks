import { ChangeNode, ChangeStatus, ChangeType, isGhostNode, OffsetRange, PendingOverlay, UnresolvedDiagnostic } from './types.js';
import type { Footnote } from './footnote.js';

export class VirtualDocument {
  private changes: ChangeNode[];
  readonly coherenceRate: number;
  readonly unresolvedDiagnostics: UnresolvedDiagnostic[];
  readonly resolvedText?: string;

  constructor(
    changes: ChangeNode[] = [],
    coherenceRate: number = 100,
    unresolvedDiagnostics: UnresolvedDiagnostic[] = [],
    resolvedText?: string,
  ) {
    this.changes = changes;
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
    };
    return new VirtualDocument([change]);
  }

  getChanges(): ChangeNode[] {
    return this.changes;
  }

  /** Returns L2+ ghost nodes that failed anchor resolution. L0/L1 unanchored nodes are excluded. */
  getUnresolvedChanges(): ChangeNode[] {
    return this.changes.filter(c => isGhostNode(c));
  }

  changeAtOffset(offset: number): ChangeNode | null {
    for (const change of this.changes) {
      if (change.range.start === change.range.end
          ? offset === change.range.start
          : offset >= change.range.start && offset < change.range.end) {
        return change;
      }
    }
    return null;
  }

  acceptChange(id: string): void {
    const change = this.changes.find(c => c.id === id);
    if (change) {
      change.status = ChangeStatus.Accepted;
    }
  }

  rejectChange(id: string): void {
    const change = this.changes.find(c => c.id === id);
    if (change) {
      change.status = ChangeStatus.Rejected;
    }
  }

  /**
   * Returns all changes belonging to a given group (e.g., a move operation).
   * Changes are identified by their groupId field.
   */
  getGroupMembers(groupId: string): ChangeNode[] {
    return this.changes.filter(c => c.groupId === groupId);
  }
}

// ── Typed document model ──────────────────────────────────────────────
// See docs/superpowers/specs/2026-04-07-view-and-format-cleanup-design.md

/** Format discriminator for the typed Document union. */
export type Format = 'L2' | 'L3';

/**
 * An L2 document: body text with inline CriticMarkup and optional footnote log.
 * Field is called `text` (not `body`) because in L2 the markup is structurally
 * part of the body — splitting "clean body" from "markup" is not meaningful.
 */
export interface L2Document {
  readonly format: 'L2';
  readonly text: string;
  readonly footnotes: readonly Footnote[];
}

/**
 * An L3 document: clean body text plus footnote log.
 * Field is called `body` (not `text`) to emphasize the clean separation
 * — no inline CriticMarkup, no footnote refs in the body.
 */
export interface L3Document {
  readonly format: 'L3';
  readonly body: string;
  readonly footnotes: readonly Footnote[];
}

/** Typed document union. `format` is the discriminator. */
export type Document = L2Document | L3Document;
