#!/usr/bin/env node

/**
 * Manual live smoke checklist for the Word live codec convergence tranche.
 *
 * This script intentionally prints MCP tool calls instead of reaching into
 * private Word internals. Run the calls from Codex MCP against an active
 * `word://...` resource, then paste outputs into the findings file named below.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const findingPath = join(
  repoRoot,
  "docs/findings/2026-05-05-word-live-codec-convergence-smoke.txt"
);

const calls = [
  ["resources/list", {}],
  ["read_tracked_file", { file: "word://<session>", view: "working", include_meta: true }],
  [
    "propose_change",
    {
      file: "word://<session>",
      old_text: "Anchor paragraph",
      new_text: "Anchor paragraph\n\nLive paragraph proposal.",
      author: "ai:codex",
      reason: "paragraph smoke",
    },
  ],
  [
    "propose_change",
    {
      file: "word://<session>",
      old_text: "Live paragraph proposal.",
      new_text:
        "Live paragraph proposal.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
      author: "ai:codex",
      reason: "table smoke",
    },
  ],
  [
    "propose_change",
    {
      file: "word://<session>",
      insert_after: "| 1 | 2 |",
      new_text: "Sentence below table.",
      author: "ai:codex",
      reason: "below table smoke",
    },
  ],
  [
    "propose_change",
    {
      file: "word://<session>",
      insert_after: "Sentence below table.",
      new_text: "$\\sum_{i=1}^{n} i$",
      author: "ai:codex",
      reason: "math smoke",
    },
  ],
  ["read_tracked_file", { file: "word://<session>", view: "raw" }],
  ["list_changes", { file: "word://<session>", detail: "full" }],
  [
    "amend_change",
    {
      file: "word://<session>",
      change_id: "<paragraph-change-id>",
      new_text: "Live paragraph proposal, revised.",
      author: "ai:codex",
      reason: "revise smoke",
    },
  ],
  ["read_tracked_file", { file: "word://<session>", view: "raw" }],
  ["list_changes", { file: "word://<session>", detail: "full" }],
];

console.log(`Record outputs in ${findingPath}\n`);
for (const [name, args] of calls) {
  console.log(`## ${name}`);
  console.log(JSON.stringify(args, null, 2));
  console.log("");
}
