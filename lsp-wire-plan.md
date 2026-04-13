<!-- changedown.com/v1: tracked -->
# Migrate LSP Wire Protocol{-- to Structured JSON--}[^cn-9.1]

## Motivation

The current LSP wire protocol relies on stringly-typed messages serialized by `wire.ts`, making it fragile across client versions and nearly impossible to validate at the boundary.
Structured JSON with zod schemas eliminates a whole class of runtime deserialization errors that have caused silent data loss in telemetry fields like `diagnosticSpan` and `resolvedUri`.
The v2.5 release window gives us a clean shim period — the `v2.4/v2.5` compatibility layer can remain in place until {==all downstream consumers==}[^cn-3.1] adopt the new format.
Migrating now, behind the `STRUCTURED_WIRE` feature flag, lets us roll forward incrementally and roll back {~~instantly~>quickly~~}[^cn-2.1] if edge cases emerge in production.

## Steps

1. Audit all message types in `packages/lsp-protocol/schemas/` and {==annotate==}[^cn-8] each with its {==current stringly-typed wire format.==}[^cn-9.2]
   - Identify any fields that use freeform string encoding where a number, boolean, or nested object is intended.
   - Flag all locations where `wire.ts` performs manual string splitting or {--regex parsing--}[^cn-1.1].

2. Define zod schemas for every message type, starting with the {==highest-frequency==}[^cn-1.2] messages (`textDocument/completion`, `textDocument/hover`).
   - Wire up the schemas to the existing `SchemaRegistry` so validation is centralized and testable.
   - Emit validation errors to the existing telemetry pipeline so we can measure schema coverage before cutting over.

3. Introduce the `STRUCTURED_WIRE` feature flag in `packages/lsp-protocol/src/{==flags.ts==}[^cn-7]` and gate all new serialization paths behind it.

4. Update `wire.ts` to branch on `STRUCTURED_WIRE`: when enabled, use the zod schema serializer; when disabled, fall back to the legacy {~~stringly-typed~>string-based~~}[^cn-5.1] path.

5. Add integration tests that exercise both the legacy and structured paths for each message type, asserting {==byte-level equivalence==}[^cn-5.2] for the overlap period.

6. Enable `STRUCTURED_WIRE` by default in staging and run a two-week {~~soak test~>burn-in period~~}[^cn-5.3], monitoring error rates in the `lsp.wire.deser_error` telemetry stream.

7. Remove the legacy stringly-typed path and the feature flag once the v2.4/v2.5 shim window closes and {~~all clients are confirmed~>all clients are confirmed by the platform team~~}[^cn-5.4] on v2.5+.

## Risks

- Clients pinned to v2.4 may not handle structured JSON gracefully if the shim is removed prematurely — the rollout schedule must enforce a hard cutoff date.
- The zod validation layer adds per-message overhead; benchmarks should confirm it stays under the {==2ms==}[^cn-4] latency budget for `textDocument/completion`.
- Telemetry field renames (e.g., `diagnosticSpan` → `diagnostic_span`) risk breaking existing dashboards if the migration is not coordinated with the observability team.

## Rollout

- Phase 1 ({==weeks 1–3==}[^cn-3.2]): ship behind `STRUCTURED_WIRE=false`, validate schema coverage reaches 100%, and confirm telemetry dashboards are updated.
- Phase 2 (weeks 4–6): flip `STRUCTURED_WIRE=true` in staging, then production, and deprecate the v2.4 shim after a {~~two-sprint~>a defined~~}[^cn-3.3] grace period.


[^cn-1.1]: @human:jon-staff-eng | 2026-04-11 | del | proposed
    @human:jon-staff-eng 2026-04-11T18:53:25Z: Vague — which specific regex patterns in wire.ts are we talking about? This needs to enumerate concrete locations (line refs or function names) so Step 4 authors know what they're replacing. 'regex parsing' alone is not actionable.

[^cn-1.2]: @human:jon-staff-eng | 2026-04-11 | highlight | proposed
    @human:jon-staff-eng 2026-04-11T18:53:25Z: What's the actual frequency data backing this ordering? I want to see message-type throughput numbers from prod telemetry before we commit to this prioritization. 'highest-frequency' is an assumption until measured.

[^cn-1]: @human:jon-staff-eng | 2026-04-11 | group | proposed
    @human:jon-staff-eng 2026-04-11T18:53:25Z: propose_batch

[^cn-2.1]: @human:priya-product-lead | 2026-04-11 | sub | proposed
    @human:priya-product-lead 2026-04-11T18:53:35Z: "instantly" overpromises rollback speed — flag propagation, client reconnects, and cache draining all take time. "quickly" is more accurate and defensible.

[^cn-2]: @human:priya-product-lead | 2026-04-11 | group | proposed
    @human:priya-product-lead 2026-04-11T18:53:35Z: propose_batch

[^cn-3.1]: @human:priya-product-lead | 2026-04-11 | highlight | proposed
    @human:priya-product-lead 2026-04-11T18:53:43Z: Who owns tracking and coordinating adoption across downstream consumers? This needs a named DRI and a concrete outreach plan — 'until all adopt' is not a milestone we can gate on without ownership.

[^cn-3.2]: @human:priya-product-lead | 2026-04-11 | highlight | proposed
    @human:priya-product-lead 2026-04-11T18:53:43Z: Is a 3-week window realistic for schema coverage reaching 100% AND telemetry dashboards being updated? These are two distinct workstreams. Recommend pressure-testing this estimate with the infra and observability teams before committing.

[^cn-3.3]: @human:priya-product-lead | 2026-04-11 | sub | proposed
    @human:priya-product-lead 2026-04-11T18:53:43Z: "Two-sprint" is too specific and presupposes sprint length. Recommend replacing with a milestone-based cutoff (e.g., 'after all v2.4 clients confirm upgrade') rather than a fixed sprint count.

[^cn-3]: @human:priya-product-lead | 2026-04-11 | group | proposed
    @human:priya-product-lead 2026-04-11T18:53:43Z: propose_batch

[^cn-4]: @human:jon-staff-eng | 2026-04-11 | highlight | proposed
    @human:jon-staff-eng 2026-04-11T18:53:45Z: This number appears nowhere in our SLA docs or ADRs. Where did 2ms originate? We need a measured p99 baseline from production profiling before the validation layer design is locked to this figure.

[^cn-5.1]: @ai:claude-sonnet-4.6 | 2026-04-11 | sub | proposed
    @ai:claude-sonnet-4.6 2026-04-11T18:53:45Z: Jargon: "stringly-typed" is an insider term unlikely to land for all readers. "string-based" is clearer and more universally understood.

[^cn-5.2]: @ai:claude-sonnet-4.6 | 2026-04-11 | highlight | proposed
    @ai:claude-sonnet-4.6 2026-04-11T18:53:45Z: Is this claim achievable? Two serialization paths may produce semantically identical but byte-different output (e.g., key ordering, whitespace). Consider "semantic equivalence" unless you specifically require identical byte sequences.

[^cn-5.3]: @ai:claude-sonnet-4.6 | 2026-04-11 | sub | proposed
    @ai:claude-sonnet-4.6 2026-04-11T18:53:45Z: "Soak test" is common in infrastructure circles but opaque to product/PM readers. "Burn-in period" conveys the same sustained-load intent more plainly.

[^cn-5.4]: @ai:claude-sonnet-4.6 | 2026-04-11 | sub | proposed
    @ai:claude-sonnet-4.6 2026-04-11T18:53:45Z: Accountability gap: without naming a responsible party, "confirmed" has no owner. Adding "by the platform team" makes the sign-off obligation explicit.

[^cn-5]: @ai:claude-sonnet-4.6 | 2026-04-11 | group | proposed
    @ai:claude-sonnet-4.6 2026-04-11T18:53:45Z: propose_batch

[^cn-7]: @human:jon-staff-eng | 2026-04-11 | highlight | proposed
    @human:jon-staff-eng 2026-04-11T18:54:00Z: Why are wire protocol feature flags living in the top-level flags.ts alongside unrelated product flags? A dedicated wire-specific module would keep concerns separated and make this flag easier to locate and remove in Step 7.

[^cn-8]: @human:jon-staff-eng | 2026-04-11 | highlight | proposed
    @human:jon-staff-eng 2026-04-11T18:54:09Z: What does 'annotate' mean concretely here — inline code comments, a separate audit spreadsheet, a doc block format? The output format of this audit step should be specified so Step 2 authors know exactly what they're consuming.

[^cn-9.1]: @human:verifiable-tress-tater | 2026-04-11 | del | proposed

[^cn-9.2]: @human:verifiable-tress-tater | 2026-04-11 | highlight | proposed
    @human:verifiable-tress-tater 2026-04-11T18:56:08Z: This is going to take a lot of work

[^cn-9]: @human:verifiable-tress-tater | 2026-04-11 | group | proposed
    @human:verifiable-tress-tater 2026-04-11T18:56:08Z: propose_batch