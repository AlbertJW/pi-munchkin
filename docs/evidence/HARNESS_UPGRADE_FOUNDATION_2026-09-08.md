# Harness upgrade — foundation checkpoint

Date: 2026-09-08. Specification: [approved upgrade](../HARNESS_UPGRADE_PLAN_2026-09-08.md).

This is an implementation checkpoint, not completion of the five-package upgrade. Packages 1 and 2 are source-only rollback points; package 3 now includes its parent-owned budget/deadline guard, bounded views, aggregate-authoritative parent status/recovery reads with lifecycle-preserving freshness projection after graph mutations, cancellation/extension authority, a dark one-call `research_finish` terminal contract, a compatibility-safe optional claim-ID input for `research_note`, a parent-only `web_read` receipt bridge, automatic parent publication of verified evidence-card references with a validation receipt, and automatic bounded `web_search` receipts. No inference, live mirror application, rollout or default promotion was performed. Existing unrelated dirty files and the retired-goal archive were preserved.

## Corrected and regression-tested

Observed overflow rejects a small assembled request rather than reporting admission. Missing usage after compaction does not erase a known overflow. Remaining allowance includes observed retained context, uncertainty and concurrent reservations; unmeasured tool reservations fail closed. Explicit `MUNCHKIN_TOOL_PROFILE=ambient` wins over legacy minimal selection.

Serialized JSON tokenization is explicitly estimated, not verified provider-prompt counting. A provider-rendered counting interface checks request and serving-epoch binding; malformed receipts yield unavailable. Explicitly bound observations reject stale epoch/generation values. This does not establish that any production provider currently supplies those bindings or a rendered-request counter.

Unsafe admission can request one coordinated compaction at the settled boundary for an unchanged request/epoch. Failed recovery does not trigger provider replay. A corrected request cancels pending recovery. The session-local retry set is bounded; persisted/reload recovery qualification remains outstanding.

Parsed retrieval completeness and method survive in cached receipts with source identity and content digest. Notes derive their evidence metadata from the receipt. Unknown completeness remains explicit in the receipt and conservatively maps to V1's `truncated=true`, so a matching quote alone cannot satisfy complete coverage. Cache hits retain the incomplete-coverage guard.

URL identity preserves query bytes/order and trailing slashes. Citation validation compares identities before producing query-redacted displays. Direct-reader rows from unrequested sources cannot populate the cache. Reading shares a deadline signal between preflight, direct extraction and Jina fallback; cancellation never starts fallback.

## Counterfactual evidence

Each corrective regression was run against the preceding implementation and failed before its fix. Observed failures included `admitted` instead of `rejected`, full-window reservation acceptance, `exact` instead of `estimated`, ignored ambient selection, complete cards/cache coverage for unknown retrievals, unrequested source acceptance, fallback after cancellation, missing usage clearing overflow, absent compaction recovery, stale pending compaction and query-identity mismatch. Focused reruns passed after fixes. Existing canonicalization assertions were updated to the approved resource-preserving semantics, not weakened.

## Verification

Focused foundation suite: 118/118; aggregate/view suite: 7/7; parent Ketch budget/deadline suite: 28/28; parent unified-finish integration: 2/2; isolated hierarchical-planner wrapper: 62/62, including the aggregate-authority, branch-lease freshness, and cancellation/extension regressions. The fresh full harness suite is 813/813, including the claim-ID, automatic-search/read-receipt, automatic-card-publication, aggregate-authority, and lifecycle-authority regressions. Typecheck, Python compilation, package smoke (185 packaged files, 31 extension entrypoints, two skills), Optimizer V2 unit tests (43/43), and optimizer verification passed with fake/offline providers and the trusted gate dry-run; hardened scoring unavailable in the managed sandbox. Secret scan against HEAD passed. Mirror comparison reported expected source differences; no mirror was applied.

## Remaining work, in order

Package 1 is landed, but production observation binding across epoch/compaction/restart, provider counting integration/qualification and persisted recovery probes remain acceptance work. Package 2's aggregate, migration, locking, deadline primitives and bounded views are landed; parent status/recovery reads now fail closed to a missing or mismatched aggregate and graph mutations refresh that aggregate without resurrecting paused, blocked or extension-boundary phases, while graph/ledger writes remain compatibility views until creation, reservation, branch merge, pause and settlement all use one aggregate transition. Package 3 still needs full aggregate transition authority, complete ten-minute lifecycle/extension handling, goal continuation suppression and stable terminal delivery qualification. The dark `research_finish` operation is present and tested (one parent call settles the ledger and graph) but intentionally uses the existing ledger and graph validators as compatibility boundaries. `research_note` now accepts an existing claim ID; parent `web_search` records a bounded query/lead receipt; parent `web_read` records a content-addressed read receipt; and a parent note can automatically merge a validated evidence-card reference plus a validation receipt when the plan claim is known. These remain compatibility bridges except for parent status/recovery authority and lifecycle gating. Package 4 now has durable provider intent/response events, uncertain-operation stops, and explicit supply/abandon/retry reconciliation; baseline execution qualification and fresh-process recovery evidence remain outstanding. Package 5 remains the frozen-corpus screen and release review. No live research or optimizer mechanism is claimed adopted by this checkpoint.

Integration targets for continuation: `context-admission.ts` still obtains an unbound Pi usage estimate, and the counting callback exists only at the accounting boundary. Do not label either production-qualified. `plan-runner.ts` now projects `plan_update`, `plan_expand` and `research_finish` freshness into the aggregate, but `research_plan_start`, branch reservation/merge and pause/settlement still have separate compatibility writes; route all transitions through the aggregate and rebuild views transactionally. The parent workflow currently blocks post-deadline discovery and retains the shared local envelope, but delegated branch ceilings and provider-hung deterministic progress still need end-to-end coverage. Optimizer operation intent/response handling and explicit reconciliation are landed in the engine; real-baseline execution qualification and fresh-process crash evidence remain outstanding.

## Boundary and rollback

Source-only model-visible correction; live receipt intentionally absent. The commit containing this checkpoint is its rollback point; revert that commit only, preserving unrelated work. Current live defaults remain unchanged. The five-package upgrade has not been approved for live promotion by this receipt.

Current package-source SHA-256:
`bcad8266ab683d868b3d136eb042169ba7c2bbb724cab81b43d5f05a2177315e`.
