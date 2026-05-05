// packages/core/src/model/diagnostic.ts

/**
 * Typed parse-time / operation-time diagnostic per ADR-034 Appendix taxonomy
 * (coordinate_failed, anchor_ambiguous, anchor_missing, record_orphaned,
 * surface_orphaned), plus `structural_invalid` introduced in spec
 * 2026-04-28-criticmarkup-zombie-elimination-design-v2 §3.1 for nested or
 * malformed CriticMarkup detected by writeTrackedFile().
 *
 * Diagnostics live on the parsed Document; they are not stored on individual
 * ChangeNodes (that field is reserved for parsed metadata only).
 */
export type DiagnosticKind =
  | 'coordinate_failed'   // L3 edit-op text not uniquely located on target line
  | 'anchor_ambiguous'    // Multiple matches for an anchor candidate
  | 'anchor_missing'      // No target matches the anchor evidence
  | 'record_orphaned'     // Inline markup ref [^cn-N] without a footnote def
  | 'surface_orphaned'    // Footnote def without matching inline ref
  | 'structural_invalid'; // Nested or malformed CriticMarkup detected

export interface Diagnostic {
  kind: DiagnosticKind;
  /** ChangeNode ID this diagnostic relates to, when applicable. */
  changeId?: string;
  /** Human-readable summary suitable for inclusion in MCP error responses. */
  message: string;
  /** Structured evidence for agent retry. May include line, hash, candidates. */
  evidence?: {
    line?: number;
    hash?: string;
    expectedText?: string;
    candidates?: number;
    bytePosition?: number;
  };
}

/**
 * Thrown by assertResolved() when a document with blocking diagnostics is
 * passed to a mutation path. Carries the violations subset (the blocking
 * diagnostics that triggered the throw, minus any whitelisted via the
 * `allow` option) so callers (MCP handlers, LSP server) can surface
 * structured errors per ADR-061 ("informed retry > blind retry").
 */
export class UnresolvedChangesError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(`Document has ${diagnostics.length} unresolved change(s); cannot mutate.`);
    this.name = 'UnresolvedChangesError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Thrown by writeTrackedFile() when the post-mutation content fails the
 * structural-validity invariant (ADR-030 §0 invariant 4).
 */
export class StructuralIntegrityError extends Error {
  readonly violations: Diagnostic[];
  constructor(violations: Diagnostic[]) {
    super(`Structural integrity violated: ${violations.map(v => v.kind).join(', ')}.`);
    this.name = 'StructuralIntegrityError';
    this.violations = violations;
  }
}
