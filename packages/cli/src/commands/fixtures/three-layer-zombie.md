<!-- changedown.com/v1: tracked -->
# Test document — three-layer zombie fixture

This document reproduces the exact bug-report state from Step 5 of
docs/findings/2026-04-28-changedown-nested-markup-bug.txt (line 81 after
three nesting layers accumulated via rejected cn-2.1 + proposals cn-3/cn-4).

The body line below has three nested {~~...~~} wrappers and three trailing refs.

{~~{~~J1–J12  (this spec)          @fast/mocked {~~+ @slow/real  Journeys~>or @slow/real Journeys~~}[^cn-3]~>J1–J12  (this spec)          per journey (see tier table) Journeys~~}[^cn-2.1]~>J1–J12  (this spec)          @fast/mocked or @slow/real  Journeys~~}[^cn-4]

[^cn-4]: @agent | 2026-04-28 | sub | accepted
    approved: @hackerbara 2026-04-28 "Cleanup of nested CriticMarkup"
[^cn-2.1]: @agent | 2026-04-28 | sub | rejected
    rejected: @hackerbara 2026-04-28 "Change drifted (anchored: false)"
[^cn-3]: @agent | 2026-04-28 | sub | accepted
    approved: @hackerbara 2026-04-28 "Accepted inner fix"


[^cn-1]: ai:claude-opus-4.6 | 2026-04-29 | creation | proposed
    ai:claude-opus-4.6 2026-04-29T09:41:26Z: File created