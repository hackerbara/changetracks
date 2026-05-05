/**
 * cd repair — structural-integrity repair command.
 *
 * Three operating modes:
 *   (no flags)   List structural issues found in the file. No mutations.
 *   --dry-run    Print the issues and show what the repaired file would look like.
 *   --apply      Apply the repair, writing a timestamped backup first.
 *
 * Per spec §3.3 / Tranche 8 Task 8.2.
 */

import { promises as fs } from 'fs';
import {
  validateStructuralIntegrity,
  removeMarkupById,
  findMarkupRangeById,
  stripFootnoteBlocks,
  extractFootnoteStatuses,
  type Diagnostic,
} from '@changedown/core';
import { writeTrackedFile } from '../engine/write-tracked-file.js';

export interface RepairOptions {
  dryRun?: boolean;
  apply?: boolean;
}

/**
 * Main entry point for `cd repair <file>`.
 *
 * Returns an exit code (0 = success / no issues, 1 = error or unresolved issues).
 */
export async function runRepair(filePath: string, opts: RepairOptions): Promise<number> {
  const original = await fs.readFile(filePath, 'utf-8');
  const violations = validateStructuralIntegrity(original);

  if (violations.length === 0) {
    console.log('No structural issues found.');
    return 0;
  }

  // Default mode: list issues only (no plan computation — lazy)
  if (!opts.dryRun && !opts.apply) {
    printIssues(violations);
    console.log(`\nRun with --dry-run to preview the repair, --apply to apply it.`);
    return 0;
  }

  // Iterative repair: build plan, apply, re-validate, repeat until clean or stuck.
  const MAX_ITERATIONS = 5;
  let repaired = original;
  let remaining = violations;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const plan = buildRepairPlan(repaired, remaining);
    if (plan.length === 0) break;
    repaired = applyRepairPlan(repaired, plan);
    remaining = validateStructuralIntegrity(repaired);
    if (remaining.length === 0) break;
  }

  const post = remaining;
  if (post.length > 0) {
    console.error('Repair did not fully resolve all issues:');
    printIssues(post);
    return 1;
  }

  if (opts.dryRun) {
    printIssues(violations);
    console.log('\n--- Repaired output ---');
    printDiff(original, repaired);
    return 0;
  }

  // --apply mode: write backup, then write repaired file.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${filePath}.repair-backup-${stamp}`;
  // The backup must preserve the original possibly-invalid bytes; using
  // writeTrackedFile() here would reject the very structural damage this
  // command is trying to repair.
  // eslint-disable-next-line changedown/no-direct-tracked-file-write
  await fs.writeFile(backup, original, 'utf-8');

  try {
    await writeTrackedFile(filePath, repaired);
  } catch (err) {
    // writeTrackedFile itself validates; if it throws StructuralIntegrityError
    // after our post-check passed, something very unexpected happened.
    console.error(`Failed to write repaired file: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  console.log(`Repaired. Original backed up to ${backup}`);
  return 0;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function printIssues(violations: Diagnostic[]): void {
  console.log(`Found ${violations.length} structural issue(s):`);
  for (const v of violations) {
    const id = v.changeId ? ` [${v.changeId}]` : '';
    console.log(`  ${v.kind}${id}: ${v.message}`);
  }
}

export interface RepairStep {
  kind: 'remove-by-id' | 'remove-orphan-ref' | 'remove-orphan-def';
  changeId: string;
}

/**
 * Builds an ordered list of repair steps from the diagnostic violations.
 *
 * For violations with a changeId (coordinate_failed, record_orphaned,
 * surface_orphaned), a direct step is added.
 *
 * For structural_invalid violations without a changeId (nested markup),
 * we perform a secondary scan: extract all decided (accepted/rejected)
 * footnote IDs from the footnote section, then for each one that still
 * has live markup in the body (detected via findMarkupRangeById), add a
 * remove-by-id step. This is the zombie-markup repair path.
 */
export function buildRepairPlan(text: string, violations: Diagnostic[]): RepairStep[] {
  const plan: RepairStep[] = [];
  const seenIds = new Set<string>();

  let hasUnattributedStructuralInvalid = false;

  for (const v of violations) {
    if (v.changeId) {
      if (seenIds.has(v.changeId)) continue;
      seenIds.add(v.changeId);
      switch (v.kind) {
        case 'coordinate_failed':
        case 'structural_invalid':
          plan.push({ kind: 'remove-by-id', changeId: v.changeId });
          break;
        case 'record_orphaned':
          plan.push({ kind: 'remove-orphan-ref', changeId: v.changeId });
          break;
        case 'surface_orphaned':
          plan.push({ kind: 'remove-orphan-def', changeId: v.changeId });
          break;
      }
    } else if (v.kind === 'structural_invalid') {
      hasUnattributedStructuralInvalid = true;
    }
  }

  // Secondary pass for nested-markup (structural_invalid without changeId).
  // Scan the footnote section for decided IDs whose markup is still in the body.
  if (hasUnattributedStructuralInvalid) {
    const decidedIds = [...extractFootnoteStatuses(text).entries()]
      .filter(([, status]) => status === 'accepted' || status === 'rejected')
      .map(([id]) => id);
    for (const id of decidedIds) {
      if (seenIds.has(id)) continue;
      if (findMarkupRangeById(text, id) !== null) {
        seenIds.add(id);
        plan.push({ kind: 'remove-by-id', changeId: id });
      }
    }
  }

  // Tertiary pass: for every remove-by-id step, the decided footnote def will
  // become surface_orphaned after its inline markup is removed. Add corresponding
  // remove-orphan-def steps so the footnote section is also cleaned up.
  const removeByIdIds = new Set(
    plan.filter(s => s.kind === 'remove-by-id').map(s => s.changeId),
  );
  for (const id of removeByIdIds) {
    // Only add if we won't already remove the def via a surface_orphaned step.
    if (!plan.some(s => s.kind === 'remove-orphan-def' && s.changeId === id)) {
      plan.push({ kind: 'remove-orphan-def', changeId: id });
    }
  }

  return plan;
}

/**
 * Applies a repair plan to `text`, returning the repaired string.
 * Steps are applied in order; later steps operate on the already-modified text.
 */
export function applyRepairPlan(text: string, plan: RepairStep[]): string {
  let working = text;
  for (const step of plan) {
    switch (step.kind) {
      case 'remove-by-id':
        working = removeMarkupById(working, step.changeId);
        break;
      case 'remove-orphan-ref':
        working = working.replace(`[^${step.changeId}]`, '');
        break;
      case 'remove-orphan-def':
        working = stripFootnoteBlocks(working, [step.changeId]);
        break;
    }
  }
  return working;
}

/**
 * Prints a simple line-by-line diff of original vs repaired.
 * Lines present in original but not in repaired are shown with `-` prefix,
 * lines present in repaired but not in original with `+` prefix.
 * This is a naive line-level diff, not a semantic one.
 */
function printDiff(original: string, repaired: string): void {
  const origLines = original.split('\n');
  const repLines = repaired.split('\n');
  const maxLen = Math.max(origLines.length, repLines.length);

  for (let i = 0; i < maxLen; i++) {
    const o = origLines[i];
    const r = repLines[i];
    if (o === r) {
      // Unchanged: print as-is (show context up to 80 chars)
      if (o !== undefined) {
        console.log(`  ${o.slice(0, 120)}`);
      }
    } else {
      if (o !== undefined) {
        console.log(`- ${o.slice(0, 120)}`);
      }
      if (r !== undefined) {
        console.log(`+ ${r.slice(0, 120)}`);
      }
    }
  }
}
