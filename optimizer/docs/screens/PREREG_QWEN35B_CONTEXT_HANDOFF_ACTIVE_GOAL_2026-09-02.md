# Preregistration: Qwen 35B active-goal context-handoff screen (2026-09-02)

## Status and scope

**EXECUTED — clean mechanism receipt recorded 2026-09-02.** This bounded screen tests
that an executable persistent goal remains present and steerable after the
model-aware context handoff and its one-shot continuation. It is not a goal
quality result, capacity benchmark, model comparison, gate row, or adoption
decision.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Runtime source commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Configuration: `GOALS=on`, `CONTEXT_HANDOFF=on`,
  `CONTEXT_DISCOVERY=off`, telemetry on, no saved session, pinned Qwen
  model, default thinking settings.

## Fixture and sequence

1. Start one short user-owned goal with `/goal`; its required criterion stays
   open, so the model cannot legitimately settle it during this screen.
2. Complete one small ordinary prompt and confirm the private ledger remains
   `status=active` with the same `current_goal_id`.
3. Send a deterministic large payload that crosses the dynamic 85% threshold.
   The runtime must cancel the oversized request, compact once, and deliver a
   bounded continuation containing the active goal context.
4. Complete the continuation and inspect the ledger and telemetry. The goal
   must still be active, with one current ID, one goal-context injection per
   continuation, and no inactive-goal `continue` brief.

The disposable driver has a 420-second wall bound, retains no model text,
prompts, tool arguments, endpoints, or source contents, and writes telemetry
to one private temporary file.

## Acceptance and stop rules

Accept only if the process exits 0 with zero stderr; exactly one
`runtime/context-handoff` row has `ok=true`; exactly one matching
`context-watcher` row names `requester=model-handoff`; provider timing shows
one cancelled oversized request followed by a successful continuation; and
the ledger has the same non-null `current_goal_id` and `status=active` before
and after the handoff. The continuation must contain the active-goal schema
and objective, while no recovery/goal brief for an inactive state may contain
`continue`.

Stop and classify incomplete on a missing or duplicate handoff, native
compaction, failed continuation, goal settlement/block/pause, changed or
missing current ID, mixed surface/session identity, or any raw payload leak.

## Interpretation

A clean receipt proves only active-goal preservation across one repaired
handoff on this Qwen serving epoch. It does not establish persistence benefit,
long-horizon steering quality, 80/20 behavior, cross-provider switching, or
adoption value. The goal and context defaults remain unchanged.

## Execution receipt

- Result: **CLEAN MECHANISM RECEIPT**; no quality, gate, or adoption decision.
- Process: exit `0`, `stderr_bytes=0`, and four settled agent lifecycles. The
  first attempt was discarded before inference because the router was down;
  this receipt is from the later host-reachable run only.
- Provenance: one fresh telemetry session with 126 rows; every row carries the
  loaded surface hash `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
  The runtime source surface remains `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`;
  the documentation commits after `accdf89` do not alter it.
- Goal lifecycle: one `goal-runner/started` row with status `active`; the
  final private ledger retained the same non-null current-goal hash
  `34701f78a32be08649e28826b90e2cdefc2379a337a30f3f622f2ca047c3ae19`,
  status `active`, and its required criterion `open`.
- Handoff: exactly one `runtime/context-handoff` row with `ok=true`,
  `from_epoch=0`, `to_epoch=0`, and `reason_class=budget_threshold`; exactly
  one matching `context-watcher` row attributed to `requester=model-handoff`;
  no native compaction row.
- Provider boundary: timing statuses were `200, 200, null, 200`; the null
  request was the cancelled oversized payload and the final `200` was the
  continuation after compaction. One recovery brief was injected.
- Safety: the run retained no raw prompts, responses, goal text, tool
  arguments, endpoints, or source contents. No goal settlement, block, pause,
  or ID change occurred.

The companion audit is
[`optimizer/docs/QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL_AUDIT_2026-09-02.md`](QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL_AUDIT_2026-09-02.md).
