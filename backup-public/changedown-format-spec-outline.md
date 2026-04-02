<!-- changedown.com/v1: tracked -->
# ChangeDown Format Specification — Outline

This is a structural skeleton for rewriting the website spec page.
Each section has: purpose, what it covers, and notes on tone/examples.

---

{~~## 1. What Problem This Solves

**Purpose:** Frame the format's reason to exist in 3-4 paragraphs. Not a sales pitch — a problem statement that a technical reader can evaluate.

**Covers:**
- Changes happen in tools. The record of *why* lives somewhere else (PR comments, Slack, review UIs). When the file moves, the context doesn't follow.
- CriticMarkup (Weatherhead & Hess 2013) solved inline change syntax. ChangeDown adds identity, deliberation, and anchoring on top.
- The format is a universal interchange: human keystrokes, AI agent tool calls, DOCX imports, CRDT sync — anything that changes a markdown file can emit well-formed ChangeDown. The producing system is irrelevant; the durable record is the format's concern.
- Introduce the two serializations here (L2 = on-disk, L3 = computational), one sentence each. Detail comes later.

**Tone:** Direct, concept-first. "The format exists because..." not "In today's collaborative landscape..."


## 2. A Change, Built in Layers

**Purpose:** Show how a change grows from bare markup to full deliberation. This is the pedagogical spine — a reader who understands this section understands the format's architecture.

**Structure:** Walk through one example change across three levels.

### 2.1 Level 0 — Bare Markup

Show the five CriticMarkup types in a table. Show one example inline in a sentence. State: this is the substrate. Any CriticMarkup document is valid Level 0.

### 2.2 Level 1 — Attribution

Same change, now with an adjacent comment carrying `@author | date | type | status`. Explain the pipe convention — same separator at every level, flexible field order. State: Level 1 adds identity without ceremony.

### 2.3 Level 2 — Full Deliberation

Same change, now with a `[^cn-N]` footnote reference and a footnote definition block. Show: header, edit-op line, discussion thread, approval, resolution marker. State: Level 2 is the full deliberation record. This is what tools produce and what the review panel displays.

### 2.4 Level Transitions

Each level is a strict superset. Promotion adds a container (L0→L1 adds comment, L1→L2 adds footnote). Compaction descends — strips containers, VCS preserves history.

**Tone:** Build-up, not taxonomy. The reader discovers the format's depth through one running example.


## 3. The Five Change Types

**Purpose:** Normative reference for the CriticMarkup syntax. Brief — the reader saw examples in §2, this is the complete table.

**Covers:**
- Insertion, Deletion, Substitution, Highlight, Comment — syntax table with examples
- Highlights attach comments with no whitespace
- All types support multi-line content
- Inline CriticMarkup must not nest
- CriticMarkup in footnote discussion text is literal, not parsed

### 3.1 Range Changes

- Block-level changes: opening/closing markers on their own lines
- Disambiguation: opener is a range marker iff first non-whitespace on its line
- Accept = keep content, delete markers. Reject = delete everything.
- Original content for range sub/del lives in the footnote under `original:`
- One concrete example (insertion range)

**Tone:** Reference-grade. A parser author reads this section and implements it.


## 4. Identity

**Purpose:** How changes and authors are identified.

### 4.1 Authors

`@name` for humans, `@ai:model` for AI agents. The `@ai:` namespace is structural — it tells readers this participant is a language model. State the design principle: identity is governance, not cosmetics.

### 4.2 Change IDs

`[^cn-N]` — standard markdown footnote reference. `cn-` prefix mandatory. Document-unique, monotonically increasing. Footnote definitions appear in `cn-N` order. A header-only footnote (no body) is valid.

### 4.3 Grouped Changes

Dotted IDs: `cn-17.1`, `cn-17.2`. One level only. Accept parent → resolves all children. Reject a child → carves out one exception. Multiple refs on one change for supersession.


## 5. The Footnote

**Purpose:** Complete reference for footnote structure. A parser author implements from this section.

### 5.1 Header

`[^cn-N]: @author | date | type | status`

Types: `ins`, `del`, `sub`, `highlight`, `comment`, `move` (+ `image`, `equation` for media).
Statuses: `proposed`, `accepted`, `rejected`. Three only. Withdrawal is self-rejection.

### 5.2 The Edit-Op Line

The anchor that locates a change in the body text:
```
    LINE:HASH contextBefore{op}contextAfter
```
4-space indent. LINE is 1-indexed. HASH is 2-char hex (§6). The CriticMarkup operation is embedded in surrounding text so the string is unique on its line.

Present in L3 for all changes. Preserved in L2 for decided changes as the coherence verification record. Proposed changes in L2 don't carry one — inline CriticMarkup in the body is their anchor.

### 5.3 Metadata Keywords

Table of recognized keywords: `context:`, `approved:`, `rejected:`, `request-changes:`, `revisions:`, `supersedes:`, `superseded-by:`, `proposed-text:`, `previous:`, `original:`, `note:`, `reason:`, `image-*`, `equation-*`.

State: parsers should preserve all indented `key: value` lines. Specific keywords carry documented semantics; unrecognized keywords are future-compatible.

### 5.4 Discussion

`@author date:` at 4-space indent. Replies indent 2 spaces deeper. No depth cap. Comment labels (optional): `[suggestion]`, `[issue]`, `[question]`, `[praise]`, `[todo]`, `[thought]`, `[nitpick]`. Blocking: `[issue/blocking]`.

### 5.5 Resolution Markers

`resolved @author date: reason` and `open` / `open -- reason`. ASCII, grep-able.

### 5.6 Line Type Identification

Table: how each footnote body line self-identifies by its first token. Continuation lines must start with whitespace. A non-indented line that matches nothing terminates the footnote.

**Tone:** Implementor-oriented. Each subsection answers "how do I parse this?"


## 6. The Anchor

**Purpose:** The most technically distinctive part of the format. This section explains how changes survive body edits. A reader who understands this section understands why the format is robust.

### 6.1 The Problem

A change knows where it lives, but the body moves. In L2 with proposed changes, inline CriticMarkup IS the anchor. In L3, and in L2 for decided changes, the body is clean text — the anchor must locate the change from outside.

### 6.2 LINE:HASH

Content-addressed coordinate. Hash algorithm:
1. Strip trailing `\r`
2. Remove footnote refs matching `[^cn-[\w.]+]`
3. Remove all whitespace
4. xxHash32 (seed 0) of UTF-8 bytes
5. Modulo 256
6. 2 lowercase hex characters

Blank-line hashing: structural context from neighboring non-blank lines.

Producers emit exactly 2 hex chars. Parsers accept 2+.

### 6.3 Contextual Embedding

How the edit-op line embeds the operation in surrounding body text for unique disambiguation. Context expands to word boundaries. Deletion context: joined before+after locates the deletion point.

Show a concrete example with before/op/after labeled.

### 6.4 Hash Relocation

When the line number is stale but the hash matches a nearby line. The system scans ±N lines for a matching hash. This handles insertions/deletions above the target line — common in concurrent editing.

### 6.5 The Matching Cascade

The fallback system when exact matching fails. Five levels, each relaxing a constraint:

1. **Exact** — `text.indexOf(target)`
2. **Ref-transparent** — strip `[^cn-N]` refs from both sides, then match
3. **Normalized** — NFKC normalization (smart quotes → ASCII, etc.)
4. **Whitespace-collapsed** — collapse all whitespace runs to single space
5. **Committed-text** — strip pending CriticMarkup (proposals reverted, accepted changes kept), match against committed text
6. **Settled-text** — strip all CriticMarkup accept-all, match against settled text

Each level throws if ambiguous (found multiple times). Diagnostic: if all levels fail, check for Unicode confusables and report.

**Note:** Reference the interactive diagram gallery (docs/diagrams/) for visual walkthroughs of coordinate resolution and text matching.

### 6.6 The Scrub Replay

When hash + cascade matching isn't enough, the resolution protocol reconstructs the original body (backward pass — un-apply all operations in reverse order), then re-applies forward to verify each operation against its intermediate body state. This is structurally identical to Eg-walker retreat/advance (Kleppmann & Gentle 2025).

The replay also detects **consumption**: when a later operation absorbs an earlier one (e.g., a substitution that replaces text containing a previous insertion).

**Tone:** Technical but motivated. Lead with "why does this exist" (concurrent editing, body drift), then "how it works." Reference the diagrams for the full pipeline visualization.


## 7. The L3 Projection

**Purpose:** Explain what L3 is, how it relates to L2, and how to convert between them.

### 7.1 What L3 Is

The computational projection: clean body text (no CriticMarkup delimiters), enriched footnotes with LINE:HASH anchors and contextual edit-ops. L3 exists during editing sessions. The body is the accepted-all projection.

Table: what the body contains for each change type × status combination.

### 7.2 L2 → L3 Conversion

Algorithm in implementable steps:
1. Parse L2 with CriticMarkup parser → ChangeNode[]
2. Strip CriticMarkup from body in reverse order
3. Strip inline [^cn-N] refs from body
4. Compute line hashes on clean body
5. For each change, build contextual edit-op
6. Prepend edit-op as first body line in footnote
7. Return assembled L3

### 7.3 L3 → L2 Demotion

Status-aware reinsertion:

| State | Body | Footnote |
|-------|------|----------|
| Proposed | Re-insert CriticMarkup at anchor | Strip edit-op line |
| Accepted | Body stays clean | Keep edit-op line |
| Rejected | Body stays clean | Keep edit-op line |

### 7.4 Round-Trip Invariant

L2 → L3 → L2 is lossless and deterministic. Footnote headers and body lines preserved verbatim. The matching cascade re-locates changes even if the body was edited between cycles.

**Tone:** Implementation guide. Someone reads this section and can build L2↔L3 conversion.


## 8. Coherence

**Purpose:** How the format verifies internal consistency. Short section — the mechanisms are in §6, this section names the properties.

### 8.1 Resolution

Each footnote is resolved or unresolved. Binary, no intermediate states. The mechanism that succeeded (hash, relocation, cascade, replay) is diagnostic metadata, not a property of the file.

Redundancy: a resolved footnote is active (effect visible) or consumed (absorbed by later operation). Consumption is computed, not stored.

### 8.2 Body-Log Coherence

The file is coherent when every footnote resolves against its intermediate body state. Decided changes retain edit-op lines as verification records.

### 8.3 Slices and Compaction

Compaction boundaries. A slice is self-describing. Within a slice, the body at the boundary is ground truth, and the resolution protocol works on the window only.


## 9. Stewardship

**Purpose:** The format's design philosophy regarding accountability and surveillance. This section is a differentiator — it should stay.

**Covers:**
- The panopticon risk: accountability infrastructure that optimizes surveillance over collaboration
- Design stance: forum, not panopticon
- Compaction as stewardship (not garbage collection) — participants choose what they carry forward
- Trace decay with preservation floor
- The file as a forum people enter at different depths
- The constitutional sentence

**Tone:** Match the blog post voice here. This is where the format's values are stated directly.


## 10. Practical Details

### 10.1 File Header

`<!-- changedown.com/v1: tracked -->` on the first line. Supports `untracked`. Auto-inserted on first tracked edit. Precedence: file header > project config > global default.

### 10.2 Timestamps

Header date: YYYY-MM-DD. Event lines accept date-only, informal time, full ISO 8601. System events use UTC. Human timestamps stored as written.

### 10.3 Code Files

Same format in language-native comments. All three levels, range delimiters, and footnotes work in comment syntax.


## 11. Complete Example

**Purpose:** A full L2 document that ties everything together. The reader should be able to trace every concept from the spec in this example.

**Covers:** An API design document with:
- Two accepted changes (clean body, edit-op lines in footnotes)
- One proposed change (inline CriticMarkup)
- Threaded discussion with labels
- Approval markers
- One resolved thread, one open with blocking issue
- Three authors (two human, one AI)

Follow with a brief walkthrough: "Three changes, three authors. The accepted changes have no inline markup — the body reads as clean prose. Their edit-op lines serve as coherence verification records..."


## 12. References

- CriticMarkup (Weatherhead & Hess 2013)
- Eg-walker (Kleppmann & Gentle, EuroSys 2025)
- The Harness Problem (Bölük 2026)
- Algorithm visualization gallery (docs/diagrams/) — interactive walkthroughs of coordinate resolution, text matching, and scrub replay

---

## Structural Notes

**What changed from v2-new draft:**
- §6 (The Anchor) is now the largest section — covers matching cascade, hash relocation, scrub replay. Previously absent.
- §2 is the pedagogical spine (one example through three levels). Previously scattered.
- §7 (L3 Projection) includes implementable conversion algorithms. Previously just tables.
- §9 (Stewardship) preserved from v2-new — matches site voice.
- §10 collects practical details that don't need their own top-level sections.
- EBNF grammar (from hybrid-format-spec.md) is NOT included inline. It belongs in a separate appendix or the GitHub repo, not the website page. The spec should be readable without formal grammar notation.

**What to reference but not inline:**
- The diagram gallery at docs/diagrams/ has SVG + interactive HTML for coordinate resolution, text matching step-through, scrub replay, and anchor computation. The spec should link to these, not duplicate them.
- The hybrid-format-spec.md has a full EBNF grammar (Section A). Reference for implementors who want formal syntax.

**Tone calibration:**
- §1, §9: site voice — conceptual, direct, the file as protagonist
- §2: pedagogical — building understanding through a running example
- §3-§5, §7-§8, §10: neutral technical reference — someone implements from these
- §6: technical but motivated — the "how it actually works" section that earns trust
- §11: narrative walkthrough of the example

**Length estimate:** ~800-1000 lines. Longer than 04-spec.md (46 lines), shorter than v2.md (588 lines) once you remove the unnecessary formality. The anchor section (§6) is the biggest addition and the most valuable.~>## 1. What Problem This Solves

**Purpose:** Frame the format's reason to exist in 3-4 paragraphs. Not a sales pitch — a problem statement that a technical reader can evaluate.

**Covers:**
- Changes happen in tools. The record of *why* lives somewhere else (PR comments, Slack, review UIs). When the file moves, the context doesn't follow.
- CriticMarkup (Weatherhead & Hess 2013) solved inline change syntax. ChangeDown adds identity, deliberation, and anchoring on top.
- The format is a universal interchange: human keystrokes, AI agent tool calls, DOCX imports, CRDT sync — anything that changes a markdown file can emit well-formed ChangeDown. The producing system is irrelevant; the durable record is the format's concern.
- Introduce the two serializations: L2 (on-disk, inline CriticMarkup in body) and L3 (computational projection, clean body + enriched footnotes). L3 is the computational layer that enables MCP-equipped agents to work effectively — content-addressed coordinates give agents stable references for sequential edits, batch operations, and parallel multi-agent work without coordinate invalidation between calls.
- One sentence each on L2/L3; detail comes later.

**Tone:** Direct, concept-first. "The format exists because..." not "In today's collaborative landscape..."


## 2. A Change, Built in Layers

**Purpose:** Show how a change grows from bare markup to full deliberation. This is the pedagogical spine — a reader who understands this section understands the format's architecture.

**Structure:** Walk through one example change across three levels.

### 2.1 Level 0 — Bare Markup

Show the five CriticMarkup types in a table. Show one example inline in a sentence. State: this is the substrate. Any CriticMarkup document is valid Level 0.

### 2.2 Level 1 — Attribution

Same change, now with an adjacent comment carrying `@author | date | type | status`. Explain the pipe convention — same separator at every level, flexible field order. State: Level 1 adds identity without ceremony.

### 2.3 Level 2 — Full Deliberation

Same change, now with a `[^cn-N]` footnote reference and a footnote definition block. Show: header, edit-op line, discussion thread, approval, resolution marker. State: Level 2 is the full deliberation record. This is what tools produce and what the review panel displays.

### 2.4 Level Transitions

Each level is a strict superset. Promotion adds a container (L0→L1 adds comment, L1→L2 adds footnote).

Compaction is the inverse direction but not merely "stripping containers." Compaction operates on an arbitrary slice of footnotes — the file's deliberation history — and decides what to carry forward. A compaction pass targets specific decided or consumed footnotes, removes their definitions, inserts a compaction-boundary marker at the frontier, and VCS preserves the full history at each step. The deliberation record is what you're deciding about: which threads have served their purpose, which decisions are load-bearing enough to keep. Compaction is stewardship of the file's memory, not mechanical cleanup (more in §9).

**Tone:** Build-up, not taxonomy. The reader discovers the format's depth through one running example.


## 3. The Five Change Types

**Purpose:** Normative reference for the CriticMarkup syntax. Brief — the reader saw examples in §2, this is the complete table.

**Covers:**
- Insertion, Deletion, Substitution, Highlight, Comment — syntax table with examples
- Highlights attach comments with no whitespace
- All types support multi-line content
- Inline CriticMarkup must not nest
- CriticMarkup in footnote discussion text is literal, not parsed

### 3.1 Range Changes

- Block-level changes: opening/closing markers on their own lines
- Disambiguation: opener is a range marker iff first non-whitespace on its line
- Accept = keep content, delete markers. Reject = delete everything.
- Original content for range sub/del lives in the footnote under `original:`
- One concrete example (insertion range)

**Tone:** Reference-grade. A parser author reads this section and implements it.


## 4. Identity

**Purpose:** How changes and authors are identified.

### 4.1 Authors

`@name` for humans, `@ai:model` for AI agents. The `@ai:` namespace is structural — it tells readers this participant is a language model. State the design principle: identity is governance, not cosmetics.

### 4.2 Change IDs

`[^cn-N]` — standard markdown footnote reference. `cn-` prefix mandatory. Document-unique, monotonically increasing. Footnote definitions appear in `cn-N` order. A header-only footnote (no body) is valid.

### 4.3 Grouped Changes

Dotted IDs: `cn-17.1`, `cn-17.2`. One level only. Accept parent → resolves all children. Reject a child → carves out one exception. Multiple refs on one change for supersession.


## 5. The Footnote

**Purpose:** Complete reference for footnote structure. A parser author implements from this section.

### 5.1 Parser Philosophy

State the design principle: loose parsing, human forgiveness. The format is designed so humans can write footnotes by hand and get them mostly right. Parsers should be generous in what they accept — tolerate blank lines within footnotes, accept flexible field ordering in headers, preserve unrecognized metadata lines for forward compatibility. The spec defines what producers emit; parsers should handle reasonable deviations gracefully.

### 5.2 Header

`[^cn-N]: @author | date | type | status`

Types: `ins`, `del`, `sub`, `highlight`, `comment`, `move` (+ `image`, `equation` for media).
Statuses: `proposed`, `accepted`, `rejected`. Three only. Withdrawal is self-rejection.

### 5.3 The Edit-Op Line

The anchor that locates a change in the body text:
```
    LINE:HASH contextBefore{op}contextAfter
```
4-space indent. LINE is 1-indexed. HASH is 2-char hex (§6). The CriticMarkup operation is embedded in surrounding text so the string is unique on its line.

Present in L3 for all changes. Preserved in L2 for decided changes as the coherence verification record. Proposed changes in L2 don't carry one — inline CriticMarkup in the body is their anchor.

The edit-op line is the bridge between the footnote and the body. §6 covers in detail how edit-ops are produced (contextual uniqueness guarantee), how they survive body edits (hash relocation and matching cascade), and how they're used in the resolution protocol (scrub replay).

### 5.4 Metadata Keywords

Table of recognized keywords: `context:`, `approved:`, `rejected:`, `request-changes:`, `revisions:`, `supersedes:`, `superseded-by:`, `proposed-text:`, `previous:`, `original:`, `note:`, `reason:`, `image-*`, `equation-*`.

State: parsers should preserve all indented `key: value` lines. Specific keywords carry documented semantics; unrecognized keywords are future-compatible.

### 5.5 Discussion

`@author date:` at 4-space indent. Replies indent 2 spaces deeper. No depth cap. Comment labels (optional): `[suggestion]`, `[issue]`, `[question]`, `[praise]`, `[todo]`, `[thought]`, `[nitpick]`. Blocking: `[issue/blocking]`.

### 5.6 Resolution Markers

`resolved @author date: reason` and `open` / `open -- reason`. ASCII, grep-able.

### 5.7 Line Type Identification

Table: how each footnote body line self-identifies by its first token. Continuation lines must start with whitespace. A non-indented line that matches nothing terminates the footnote.

### 5.8 A Change Through Its Lifecycle

Worked example: trace one change from proposal through discussion to acceptance. Show the footnote at each stage — what gets added, what stays, what the file looks like after each step. Cover the full cycle:

1. **Propose** — agent or human creates inline CriticMarkup + footnote with `proposed` status
2. **Discuss** — reviewers add `@author date:` thread replies, labels (`[issue]`, `[suggestion]`)
3. **Request changes** — `request-changes:` line, author amends (revision history under `revisions:`)
4. **Accept** — `approved:` lines added, status changes to `accepted`, CriticMarkup is settled into body text, edit-op line is written as the coherence record
5. **Compact** — footnote is eventually compacted away, compaction boundary marks the frontier, VCS preserves the full thread

This section shows the format as a living workflow, not just a static data structure.

**Tone:** Implementor-oriented. Each subsection answers "how do I parse this?" The lifecycle example answers "what does the workflow look like end-to-end?"


## 6. The Anchor

**Purpose:** The most technically distinctive part of the format. This section explains how changes survive body edits. A reader who understands this section understands why the format is robust.

### 6.1 The Problem

A change knows where it lives, but the body moves. This is a convolution of two problems: (1) how to anchor edits through sequential and batch changes by the same author, where each edit shifts the coordinates of subsequent edits, and (2) how to anchor edits through other authors' concurrent changes, where the body text has been rewritten between the time a change was proposed and the time it's resolved. Both problems compound — an agent making a batch of five edits while a human is typing in the same file faces both simultaneously.

In L2 with proposed changes, inline CriticMarkup IS the anchor — the change is physically present in the body. In L3, and in L2 for decided changes, the body is clean text — the anchor must locate the change from outside.

Introduce views here: the body text looks different depending on the view. The settled view (accept-all) is what L3 uses as its body. The committed view (revert proposals, keep accepted) is what decided changes anchor against. The raw view is literal file bytes with CriticMarkup inline. The anchor system must work across these projections — an edit-op written against one body state must resolve against the same logical text even when the view has changed.

### 6.2 LINE:HASH

Content-addressed coordinate, inspired by Bölük's line-hash addressing ("The Harness Problem," 2026). Bölük's insight: content-addressed lines eliminate the mechanical failures that plague text-matching approaches to agent editing. ChangeDown extends the concept: the hash serves as a **freshness indicator** per line — when the hash no longer matches, the system knows the line has been edited and can trigger relocation or cascade matching rather than silently operating on stale coordinates.

Hash algorithm:
1. Strip trailing `\r`
2. Remove footnote refs matching `[^cn-[\w.]+]`
3. Remove all whitespace
4. xxHash32 (seed 0) of UTF-8 bytes
5. Modulo 256
6. 2 lowercase hex characters

Step 2 makes the hash **view-independent**: the same line produces the same hash whether read in L2 (with footnote refs inline) or L3 (refs stripped). This is critical for round-trip stability — an edit-op written in L3 must resolve when the file is stored as L2.

Blank-line hashing: structural context from neighboring non-blank lines (`hash(prev + "\0" + next + "\0" + distance)`). This disambiguates blank lines that would otherwise all hash to the same value.

Producers emit exactly 2 hex chars. Parsers accept 2+ for forward compatibility.

### 6.3 Contextual Embedding

The edit-op line embeds the CriticMarkup operation within surrounding body text, creating an unambiguous anchor within the target line. This is a simplified, line-scoped variant of the W3C Web Annotation Data Model's TextQuoteSelector (`{prefix, exact, suffix}` for robust anchoring in dynamic documents). ChangeDown scopes the anchor to a single line because files have VCS history as the authoritative recovery path — full-document anchoring is over-engineered for this use case.

Context expands character-by-character (right-first bias), then snaps to word boundaries. Deletion context: joined before+after locates the deletion point.

Show a concrete example with before/op/after labeled.

### 6.4 Contextual Uniqueness Guarantee

How the system ensures every produced edit-op is contextually unique within its line. The context expansion algorithm:

1. Start with the operation's column span
2. Expand alternately right then left, one character at a time
3. At each step, check: does this substring appear exactly once on the line?
4. When unique, snap to word boundaries (extend to nearest spaces)
5. Verify uniqueness still holds after word-boundary snap; revert if broken
6. Full line is always unique (terminal case)

This guarantee means any parser can unambiguously recover the operation's exact position from the edit-op line alone.

### 6.5 Line and Hash Based Relocation

When the edit-op's line number is stale (lines were added or removed above), the system uses the hash as a relocation key.

**The relocation protocol:**
1. **Check the stated line** — compute hash at the expected line number. If it matches, done (O(1) fast path).
2. **Scan for hash match** — build a hash→line map for the entire file. If the hash appears exactly once, relocate to that line. If ambiguous (hash collision), fail — ask the caller to re-read and use fresh coordinates.

The hash is a **freshness gate**: when it matches, the line content hasn't changed and the coordinate is trustworthy. When it doesn't match, the system knows to relocate rather than silently applying to the wrong line. This is what makes sequential agent edits safe — each edit-op carries its own freshness proof.

### 6.6 The Text Matching Cascade

Once the correct line is identified (via hash match or relocation), the system locates the operation's text *within* that line. The fallback cascade relaxes constraints progressively:

1. **Exact** — `text.indexOf(target)`
2. **Ref-transparent** — strip `[^cn-N]` refs from both sides, then match
3. **Normalized** — NFKC normalization (smart quotes → ASCII, etc.)
4. **Whitespace-collapsed** — collapse all whitespace runs to single space
5. **Committed-text** — strip pending CriticMarkup (proposals reverted, accepted changes kept), match against committed text
6. **Settled-text** — strip all CriticMarkup accept-all, match against settled text

Each level throws if ambiguous (found multiple times). Diagnostic: if all levels fail, check for Unicode confusables and report specific characters.

The cascade is gated: level 1 runs always, levels 2-4 handle surface-level mismatches (agent copied a footnote ref, LLM used smart quotes, line wrapping differs), levels 5-6 handle view-projection mismatches (agent targeted committed text but the file has pending proposals inline).

**Note:** Reference the interactive diagram gallery (docs/diagrams/) for visual walkthroughs of coordinate resolution and text matching.

### 6.7 The Scrub Replay

The universal recovery mechanism. When hash relocation and the matching cascade can't resolve a change (the body has drifted too far), the scrub replay reconstructs the correct intermediate body state by replaying the entire edit history.

**The protocol:**
1. **Backward pass** — process operations in reverse log order, un-applying each to reconstruct body₀ (the original body before any changes)
2. **Forward pass** — re-apply operations in log order, verifying each against its intermediate body state and detecting consumption (a later operation absorbing an earlier one)

This is structurally identical to Eg-walker's retreat/advance (Kleppmann & Gentle 2025). The forward pass also produces **fresh anchors** — updated LINE:HASH coordinates and contextual edit-ops for any changes whose positions shifted. These fresh anchors can be written back to the file, re-establishing coherence at arbitrary length. The replay is idempotent: running it on an already-coherent file produces identical anchors.

**Tone:** Technical but motivated. Lead with "why does this exist" (concurrent editing, body drift, accumulated coordinate staleness), then "how it works." Reference the diagrams for the full pipeline visualization.


## 7. The L3 Projection

**Purpose:** Explain what L3 is, how it relates to L2, and how to convert between them.

### 7.1 The Problem L3 Solves

Two motivations:

**For editors:** The L3 body is cleanly what most humans think of as "the working document" — the text as it currently reads, without CriticMarkup delimiters cluttering the buffer. This matters for integration with editors like VS Code and Monaco that are finicky about characters in their buffer — decorations, syntax highlighting, and cursor positioning all work better on clean text. The footnote log is separate, consumed by the review panel and decoration engine, not by the text buffer.

**For agents:** L3's content-addressed coordinates (LINE:HASH) give agents stable references. An agent can read the file, get coordinates, propose a batch of changes, and each coordinate carries its own freshness proof via the hash. Without L3, agents would need to parse CriticMarkup delimiters to find their edit targets — fragile and error-prone.

### 7.2 Why L2 Is the On-Disk Format

L2 keeps CriticMarkup inline in the body, which has a different advantage: **durability and local coherence.** An agent or human reading just a few lines of an L2 file immediately sees what's proposed, what's been changed, who did it. A grep across a codebase catches pending changes. A diff shows the markup in context. There's no separate data structure to lose — the body carries its own editorial state.

L3 is the better *working* format. L2 is the better *storage* format. The round-trip between them is lossless.

### 7.3 What L3 Is

The computational projection: clean body text (no CriticMarkup delimiters), enriched footnotes with LINE:HASH anchors and contextual edit-ops. The body is the accepted-all projection.

Table: what the body contains for each change type × status combination.

### 7.4 L2 → L3 Conversion

Algorithm in implementable steps:
1. Parse L2 with CriticMarkup parser → ChangeNode[]
2. Strip CriticMarkup from body in reverse order (preserves offsets)
3. Strip inline [^cn-N] refs from body
4. Compute line hashes on clean body
5. For each change, build contextual edit-op (§6.4 uniqueness guarantee)
6. Prepend edit-op as first body line in footnote
7. Return assembled L3

### 7.5 L3 → L2 Demotion

Status-aware reinsertion:

| State | Body | Footnote |
|-------|------|----------|
| Proposed | Re-insert CriticMarkup at anchor | Strip edit-op line |
| Accepted | Body stays clean | Keep edit-op line |
| Rejected | Body stays clean | Keep edit-op line |

### 7.6 Round-Trip Invariant

L2 → L3 → L2 is lossless and deterministic. Footnote headers and body lines preserved verbatim. The matching cascade re-locates changes even if the body was edited between cycles.

**Tone:** Implementation guide. Someone reads this section and can build L2↔L3 conversion.


## 8. Coherence

**Purpose:** How the format verifies internal consistency. Short section — the mechanisms are in §6, this section names the properties.

### 8.1 Resolution

Each footnote is resolved or unresolved. Binary, no intermediate states. The mechanism that succeeded (hash, relocation, cascade, replay) is diagnostic metadata, not a property of the file.

Redundancy: a resolved footnote is active (effect visible) or consumed (absorbed by later operation). Consumption is computed, not stored.

### 8.2 Body-Log Coherence

The file is coherent when every footnote resolves against its intermediate body state. Decided changes retain edit-op lines as verification records.

### 8.3 Slices and Compaction

Compaction boundaries. A slice is self-describing. Within a slice, the body at the boundary is ground truth, and the resolution protocol works on the window only.


## 9. Stewardship

**Purpose:** The format's design philosophy regarding accountability and surveillance. This section is a differentiator — it should stay.

**Covers:**
- The panopticon risk: accountability infrastructure that optimizes surveillance over collaboration
- Design stance: forum, not panopticon
- Compaction as stewardship (not garbage collection) — participants choose what they carry forward
- Trace decay with preservation floor
- The file as a forum people enter at different depths
- The constitutional sentence

**Tone:** Match the blog post voice here. This is where the format's values are stated directly.


## 10. Practical Details

### 10.1 File Header

`<!-- changedown.com/v1: tracked -->` on the first line. Supports `untracked`. Auto-inserted on first tracked edit. Precedence: file header > project config > global default.

### 10.2 Timestamps

Header date: YYYY-MM-DD. Event lines accept date-only, informal time, full ISO 8601. System events use UTC. Human timestamps stored as written.

### 10.3 Code Files

*Conceptual — no implementation exists. Active conceptual development.*

The format is designed to work within language-native comments (`#`, `//`, `--`, `<!-- -->`, `/* */`). All three participation levels, range delimiters, and footnote definitions would work in comment syntax, with code between range markers remaining live and executable. This is a natural extension of the format's design but has not been implemented or tested.


## 11. Complete Example

**Purpose:** A full L2 document that ties everything together. The reader should be able to trace every concept from the spec in this example.

**Covers:** An API design document with:
- Two accepted changes (clean body, edit-op lines in footnotes)
- One proposed change (inline CriticMarkup)
- Threaded discussion with labels
- Approval markers
- One resolved thread, one open with blocking issue
- Three authors (two human, one AI)

Follow with a brief walkthrough: "Three changes, three authors. The accepted changes have no inline markup — the body reads as clean prose. Their edit-op lines serve as coherence verification records..."


## 12. References

- CriticMarkup (Weatherhead & Hess 2013)
- The Harness Problem (Bölük 2026) — content-addressed line hashing as the inspiration for LINE:HASH
- W3C Web Annotation Data Model — TextQuoteSelector as the conceptual ancestor of contextual embedding
- Eg-walker (Kleppmann & Gentle, EuroSys 2025) — retreat/advance model for intermediate-state verification
- Algorithm visualization gallery (docs/diagrams/) — interactive walkthroughs of coordinate resolution, text matching, and scrub replay

---

## Structural Notes

**What changed from v2-new draft:**
- §1 now frames L3 as the computational layer enabling effective agent collaboration
- §2.4 corrects compaction — it's an arbitrary-slice-of-footnotes operation, not merely stripping containers
- §5 adds parser philosophy (loose parsing, human forgiveness) and a full lifecycle worked example (§5.8)
- §5.3 explicitly bridges to §6 for edit-op deep-dive
- §6 is now the largest section — covers views problem, hash as freshness indicator, relocation protocol, matching cascade (with line/hash gating), contextual uniqueness guarantee, and scrub replay as universal recovery
- §6.2 credits Bölük and explains view-independent hashing
- §6.3 credits W3C TextQuoteSelector as conceptual ancestor
- §6.4 is new: contextual uniqueness guarantee (context expansion algorithm)
- §6.5 is expanded: line and hash based relocation with freshness gating
- §6.7 expanded: scrub replay as universal recovery with fresh anchor production
- §7 reframed: §7.1-7.2 motivate L3 and L2 as solving different problems (editor integration vs durability)
- §10.3 explicitly marked as conceptual with no implementation
- EBNF grammar (from hybrid-format-spec.md) NOT included inline — belongs in separate appendix

**What to reference but not inline:**
- The diagram gallery at docs/diagrams/ has SVG + interactive HTML for coordinate resolution, text matching step-through, scrub replay, and anchor computation. The spec should link to these, not duplicate them.
- The hybrid-format-spec.md has a full EBNF grammar (Section A). Reference for implementors who want formal syntax.

**Tone calibration:**
- §1, §9: site voice — conceptual, direct, the file as protagonist
- §2: pedagogical — building understanding through a running example
- §3-§5, §7-§8, §10: neutral technical reference — someone implements from these
- §5.8: narrative — the format as a living workflow
- §6: technical but motivated — the "how it actually works" section that earns trust
- §11: narrative walkthrough of the example

**Length estimate:** ~1000-1200 lines. The anchor section (§6) and the lifecycle example (§5.8) are the biggest additions. Longer than previous estimate because the anchor section now properly covers views, relocation protocol, and contextual uniqueness.~~}[^cn-2]


[^cn-1]: ai:claude-opus-4.6 | 2026-04-01 | creation | proposed
    ai:claude-opus-4.6 2026-04-01T19:04:18Z: File created

[^cn-2]: @ai:claude-opus-4.6 | 2026-04-01 | sub | proposed
    @ai:claude-opus-4.6 2026-04-01T19:27:29Z: Incorporating all user feedback: L3 as agent computational layer, compaction as arbitrary-slice-of-footnotes, parser philosophy, lifecycle worked example, views problem in anchor section, Bölük credit, W3C TextQuoteSelector credit, hash as freshness indicator, line+hash relocation protocol, contextual uniqueness guarantee section, scrub replay expansion, L3/L2 motivation split, code files marked conceptual