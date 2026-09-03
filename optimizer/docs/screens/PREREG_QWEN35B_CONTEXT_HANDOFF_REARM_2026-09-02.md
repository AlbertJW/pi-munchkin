# Preregistration: Qwen 35B context-handoff rearm screen (2026-09-02)

## Status and scope

**EXECUTED — mechanism receipt recorded 2026-09-02.** This bounded
mechanism screen tests that automatic context handoff is one-shot while a
context remains high, then rearms only after a completed compaction reduces
usage below the 70% threshold. It is not a capacity benchmark, quality
result, model comparison, gate row, or adoption decision.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Configuration: `CONTEXT_HANDOFF=on`, `CONTEXT_DISCOVERY=off`, telemetry on,
  no tools, no goal, no saved session, default model thinking settings.
- Synthetic-input revision: `context-padding-v3-subnative` (small prompt,
  then the first 210,000 bytes of the fixed padding fixture for each large
  user turn).

## Fixture and sequence

1. Send a small first prompt and await its successful provider settlement.
2. Send the fixed large payload once. Its assembled context must cross the
   dynamic 85% threshold while remaining below Pi's native 90% threshold.
3. The runtime must abort that oversized request, compact once, and deliver one
   successful follow-up. The post-compaction context must be below 70% so the
   one-shot latch rearms.
4. Send the same fixed large payload a second time. It must trigger exactly one
   second handoff, compaction, and successful follow-up.

The private driver ends only after two `ok=true` handoff outcomes and three
successful provider timings (the first response plus two post-compaction
follow-ups). It has a bounded 420-second wall and never prints model text.

## Acceptance and stop rules

Accept only if one fresh telemetry session contains exactly two
`runtime/context-handoff` rows, both `ok=true` and on the same epoch, exactly
two `context-watcher` rows attributed to `model-handoff`, and no duplicate
handoff before rearm. The two large requests should have one cancelled timing
each (`status=null`) and the first/follow-up requests should have status `200`.
All rows must carry the frozen loaded surface hash; no raw prompts, responses,
endpoint identities, or tool arguments may be retained.

Stop and classify incomplete on a missing or duplicate outcome, a native
`context-watcher` compaction, a failed continuation, a timeout without a
settled follow-up, a mixed surface/session identity, or any raw payload leak.

## Interpretation

A clean receipt proves only one-shot disarm and threshold rearm for this Qwen
serving epoch. It does not measure context capacity or establish benefit. The
active-goal preservation and provider/model/window-switch screens remain
separate preregistrations and must not be inferred from this run.

## Execution receipt

- Result: **CLEAN MECHANISM RECEIPT**; no adoption or quality decision.
- Process: exit `0`, `stderr_bytes=0`, `settled=5`, and the third large user
  turn was sent exactly once.
- Provenance: one fresh telemetry session with 96 rows; every row carries the
  frozen loaded surface hash `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
- Outcomes: exactly two `runtime/context-handoff` rows, both `ok=true`,
  `from_epoch=0`, `to_epoch=0`, `reason_class=budget_threshold`; exactly two
  `context-watcher` rows attributed to `model-handoff`; zero native (`pi`)
  compaction rows.
- Provider boundary: timing sequences 1, 3, and 5 returned status `200`;
  sequences 2 and 4 were the two cancelled oversized requests (`status=null`).

The first compaction reduced context below the 70% rearm threshold, and the
second large turn then triggered exactly one new handoff. This proves the
one-shot latch and rearm lifecycle for this Qwen serving epoch only. It does
not establish context capacity, active-goal preservation, model switching, or
any quality or adoption benefit.
