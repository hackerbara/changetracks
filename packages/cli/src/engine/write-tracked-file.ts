import { promises as fs, writeFileSync } from 'fs';
import {
  validateStructuralIntegrity,
  StructuralIntegrityError,
  type Diagnostic,
} from '@changedown/core';

// `surface_orphaned` is intentionally non-blocking on write: decided
// footnotes may remain as audit trail after settlement/supersede even when
// their inline surface has been removed. Inline refs without footnotes
// (`record_orphaned`) still block because they leave visible document text
// pointing at missing metadata.
const WRITE_BLOCKING_KINDS = new Set<Diagnostic['kind']>([
  'coordinate_failed',
  'anchor_ambiguous',
  'anchor_missing',
  'record_orphaned',
  'structural_invalid',
]);

function getWriteBlockingViolations(content: string): Diagnostic[] {
  return validateStructuralIntegrity(content).filter((violation) =>
    WRITE_BLOCKING_KINDS.has(violation.kind),
  );
}

/**
 * Single chokepoint for writing a tracked CriticMarkup file. Validates the
 * content is structurally sound before fs.writeFile. The original file on
 * disk is unchanged on validation failure.
 *
 * All MCP handlers, CLI commands, and host services that produce mutated
 * file content MUST go through this helper. Direct fs.writeFile() calls on
 * tracked files are disallowed (enforced by lint rule in Task 6.4).
 *
 * Per spec §3.7 / Tranche 6.
 */
export async function writeTrackedFile(filePath: string, content: string): Promise<void> {
  const violations = getWriteBlockingViolations(content);
  if (violations.length > 0) throw new StructuralIntegrityError(violations);
  await fs.writeFile(filePath, content, 'utf-8');
}

/** Sync variant for callers that can't be async. Same contract. */
export function writeTrackedFileSync(filePath: string, content: string): void {
  const violations = getWriteBlockingViolations(content);
  if (violations.length > 0) throw new StructuralIntegrityError(violations);
  writeFileSync(filePath, content, 'utf-8');
}
