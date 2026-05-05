<!-- changedown.com/v1: tracked -->
# Multi-type nested zombie fixture

A synthetic document mixing CriticMarkup kinds to test the forward-scan parser.

The line below has a substitution containing an insertion.

{~~outer text{++middle insert++}[^cn-2] more outer~>clean replacement~~}[^cn-1]

[^cn-1]: @agent | 2026-04-28 | sub | rejected
    rejected: @hackerbara 2026-04-28 "Zombie outer span"
[^cn-2]: @agent | 2026-04-28 | ins | accepted
    approved: @hackerbara 2026-04-28 "Nested insertion"
