<!-- changedown.com/v1: tracked -->
# Changelog

All notable changes to ChangeDown are documented here.

## Unreleased — assertResolved default-on & zombie elimination

### Breaking

**`assertResolved` is now default-on.** Tools (`propose_change`, `review_changes`,
`amend_change`, `supersede_change`, `compact_changes`, etc.) now return a
typed `UnresolvedChangesError` when operating on a document with unresolvable
changes (changes whose target text could not be located, marked
`resolved: false` and carrying a `coordinate_failed` diagnostic).

To opt out (legacy silent behavior), set `CHANGEDOWN_ASSERT_RESOLVED=0`. This
escape hatch will be removed in a future release (Tranche 10).

**`propose_batch` is now atomic by default.** Previously the default was
partial (apply successful changes, skip failures). The default is now atomic:
either all changes in a batch succeed or none are applied. Callers that need
partial behavior must opt in explicitly with `{ partial: true }`.

### Added

- **`cd repair` command** — detects and optionally repairs structural integrity
  violations (zombie markup) in existing tracked files. Runs `--dry-run` by
  default, printing all violations as structured diagnostics without modifying
  the file. Use `--apply` to repair in-place (creates a timestamped backup
  before writing).

  ```
  cd repair path/to/file.md            # dry-run: show violations, no changes
  cd repair --apply path/to/file.md    # repair: backup + rewrite
  ```

- **`diagnostics` field on `list_changes` and `read_tracked_file` responses** —
  both responses now include a `diagnostics: Diagnostic[]` array carrying
  typed parse-time and operation-time diagnostics.

- **`resolved` field on `list_changes` entries** — each change in the list
  response now includes `resolved: boolean` so callers can detect unresolvable
  changes without waiting for a mutation to fail.

### Additive (non-breaking)

The additions above are backward-compatible for callers that ignore unknown
fields. The `diagnostics` array is always present (empty when there are no
diagnostics). The `resolved` field is always `true` for changes in healthy
documents.

### Migration for agent callers

#### Detecting unresolvable changes: `anchored` → `resolved`

If your code inspects `change.anchored` to detect whether a change can be
located in the document, switch to `change.resolved`:

```javascript
// Before (incorrect — anchored means "has footnote ref", not "position known")
if (change.anchored === false) {
  console.log('change cannot be located, skipping');
}

// After (correct — resolved means "position was deterministically found")
if (change.resolved === false) {
  console.log('change cannot be located, skipping');
}
```

The `anchored` field's semantic was narrowed to "has `[^cn-N]` footnote ref in
the file." For L3 nodes, `anchored` is always `true` by construction (the node
was created from a footnote). Use `resolved` to check whether the position is
safe to use.

#### Batch callers: opt in to partial behavior

```javascript
// Before (partial was the default — now breaks with AtomicBatchError)
await propose_batch({ changes: [...] });

// After (explicit opt-in to partial behavior)
await propose_batch({ changes: [...], partial: true });

// Or: use atomic (new default) and handle AtomicBatchError
try {
  await propose_batch({ changes: [...] });
} catch (e) {
  if (e.type === 'AtomicBatchError') {
    // inspect e.failures for which changes failed, retry or fix
  }
}
```

#### Repairing existing files

Files written before this release may contain zombie markup. Run `cd repair`
to detect and clean them:

```bash
cd repair docs/my-document.md          # inspect without changing
cd repair --apply docs/my-document.md  # repair (backup created automatically)
```

Refs: docs/superpowers/specs/2026-04-28-criticmarkup-zombie-elimination-design-v2.md
     docs/decisions/062-anchored-resolved-split-and-zombie-elimination.md


[^cn-1]: ai:claude-opus-4.6 | 2026-04-29 | creation | proposed
    ai:claude-opus-4.6 2026-04-29T07:44:46Z: File created