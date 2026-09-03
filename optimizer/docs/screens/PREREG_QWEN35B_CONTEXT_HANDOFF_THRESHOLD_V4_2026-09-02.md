# Preregistration: Qwen 35B context-handoff threshold screen v4 (2026-09-02)

## Status and scope

**EXECUTED — mechanism receipt recorded 2026-09-02.** This bounded
mechanism screen isolates the harness pre-request handoff from Pi's native
90% compactor. It is not a capacity benchmark, quality result, model
comparison, or adoption decision.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source commit: `accdf89`
- Package-source surface SHA-256: `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256: `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Model registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Synthetic-input revision: `context-padding-v3-subnative` (first-turn prompt,
  then the first 210,000 bytes of the fixed padding fixture)

## Fixture and sequence

Use a no-goal, no-tool RPC session. Send a small first prompt and wait for its
successful settlement. Send the deterministic second payload only after that
settlement. Its assembled context must be at least 85% of the active profile
but below Pi's native 90% threshold. Set `CONTEXT_HANDOFF=on` and
`CONTEXT_DISCOVERY=off`.

The expected sequence is one ordinary first response, one
`runtime/context-handoff` outcome with `ok=true`, one compaction follow-up, and
one settled second response. A duplicate handoff before usage falls below the
70% rearm threshold is a failure. If the native compactor fires first, or no
handoff outcome is recorded, classify the run incomplete and stop.

## Safety and interpretation

Keep the driver and telemetry in a private temporary directory. Record only
bounded event classes, statuses, epochs, token counts, and surface hashes; do
not retain raw prompts, responses, endpoint URLs, or tool arguments. Confirm no
active Pi process before execution and delete temporary artifacts afterward.

A clean receipt proves only the dynamic handoff lifecycle for this Qwen
serving epoch. It does not measure context capacity or establish benefit on
other models. Follow-up active-goal, rearm, and provider/model/window-switch
screens require separate preregistration.

## Execution receipt

- Result: **CLEAN MECHANISM RECEIPT**; no adoption or quality decision.
- Driver: private two-turn RPC session, no tools, no goal, deterministic first
  210,000 bytes of the fixed padding fixture, default model thinking settings.
- Process: exit `0`, `stderr_bytes=0`, `settled=3`, `sent_second=true`.
- Provenance: one telemetry session, all 58 rows stamped with loaded surface
  hash `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
- Serving envelope: registry context `61440`, initial safe input `52224`,
  served `n_ctx=65536`, post-probe safe input `56320`, verdict `ok`.
- Handoff: exactly one `runtime/context-handoff` outcome with
  `from_epoch=0`, `to_epoch=0`, `reason_class=budget_threshold`, `ok=true`.
  The matching compaction observer row names `requester=model-handoff` and
  `reason=manual`.
- Provider boundary: timing sequence 1 returned status `200`; sequence 2 was
  the cancelled oversized request (`status=null`); sequence 3 returned status
  `200` after compaction. No second handoff outcome was emitted.

The prior v5/v6 sessions remain quarantined because one reused a telemetry
path and another exposed a callback race; the v7 instrumented session timed
out before its follow-up and is diagnostic only. This receipt supersedes none
of those historical records. It proves that the repaired pre-request abort,
committed-compaction outcome, and single continuation work together on this
Qwen serving epoch. It does not establish capacity, answer quality, benefit,
rearming, active-goal wording, or cross-provider/model/window behavior.
