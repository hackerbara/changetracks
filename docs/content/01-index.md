<!-- changedown.com/v1: tracked -->
# ChangeDown

Track changes in markdown — for humans and AI agents.

Every edit is attributed, every decision recorded. The file carries its own deliberation history — not in a sidebar or a separate system, but in the text itself. Anyone reading it sees not just what the document says, but the reasoning that shaped it.

---

**For humans** — a VS Code extension with the workflow you know from Word and Google Docs. Accept, reject, comment, navigate.
The comment panel keeps discussion next to the text — no context-switching to review. 

**For agents** — six MCP tools that read and write CriticMarkup directly. Hash-verified coordinates prevent stale edits. {~~Fewer tokens~>2.3× fewer tokens~~}[^cn-1.3] than raw file replacement.

**For everyone** — plain text. Readable in any editor, diffable in git, parseable by anything. No lock-in. {==The format is already markdown==}[^cn-4].


---

Get it: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=changedown.changedown) · [npm](https://www.npmjs.com/package/@changedown/core) · [GitHub](https://github.com/hackerbara/changedown)

[^cn-1.1]: @ai:claude-opus-4.6 | 2026-03-13 | sub | accepted
    6:24 history{~~~>~~} —
    @ai:claude-opus-4.6 2026-03-13T06:08:23Z: The file IS the deliberation record — not just a log of what changed, but why
    approved: @human:hackerbara 2026-03-13T06:09:37Z "good catch — deliberation is the right word"

[^cn-1.2]: @ai:claude-opus-4.6 | 2026-03-13 | ins | accepted
    11:82 {++The comment panel keeps discussion next to the text — no context-switching to review. ++}
    @ai:claude-opus-4.6 2026-03-13T06:08:23Z: The comment panel is the demo — every change on this page has its thread visible on the right
    approved: @human:hackerbara 2026-03-13T06:09:37Z "yes — exactly what the panel on the right shows"

[^cn-1.3]: @ai:claude-opus-4.6 | 2026-03-13 | sub | proposed
    @ai:claude-opus-4.6 2026-03-13T06:08:23Z: Measured against direct file editing across the benchmark harness. Concrete beats vague.

[^cn-1]: @ai:claude-opus-4.6 | 2026-03-13 | group | proposed
    @ai:claude-opus-4.6 2026-03-13T06:08:23Z: propose_batch

[^cn-3]: @ai:claude-opus-4.6 | 2026-03-13 | ins | rejected
    16:c5 {++**For teams** — shared review workflows with approval chains, amendment history, and compaction. ++}
    @ai:claude-opus-4.6 2026-03-13T06:08:48Z: Natural extension of the three-audience framing. Teams are where the collaboration features land.
    rejected: @human:hackerbara 2026-03-13T06:09:37Z "not there yet. ship it when it's real."

[^cn-4]: @human:hackerbara | 2026-03-13 | highlight | proposed
    @human:hackerbara 2026-03-13T06:09:08Z: this is the line. everything else supports this.


