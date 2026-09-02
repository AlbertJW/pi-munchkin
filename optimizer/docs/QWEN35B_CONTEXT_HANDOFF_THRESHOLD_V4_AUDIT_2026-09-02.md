# Qwen 35B context-handoff threshold v4 audit — 2026-09-02

## Verdict

**CLEAN MECHANISM RECEIPT.** The hash-bound two-turn screen exercised the
model-aware pre-request handoff on the pinned Qwen 35B daily-driver endpoint.
It passed the lifecycle contract and remains strictly protocol evidence; it
is not a capacity benchmark, quality score, gate row, optimizer result, or
adoption recommendation.

## Bound identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Telemetry: one fresh private file and one session identity; 58 rows, no
  reused path, no raw prompts, responses, endpoint, or tool arguments.

## Safe observations

The driver exited `0` with zero stderr, settled three agent lifecycles, and
sent the deterministic second payload exactly once. Serving discovery observed
`n_ctx=65536` against the registry's `61440`; the profile moved from safe input
`52224` to `56320` and classified the serving envelope `ok`.

The first provider timing returned status `200`. The second assembled context
crossed the dynamic 85% threshold while remaining below Pi's native 90%
threshold. The runtime synchronously aborted that request, emitted one
`context-watcher` compaction attributed to `model-handoff`, and recorded one
`runtime/context-handoff` outcome with `from_epoch=0`, `to_epoch=0`,
`reason_class=budget_threshold`, and `ok=true`. The cancelled request has a
`provider-timing` row with `status=null`; the single post-compaction follow-up
returned status `200`. No duplicate handoff outcome appeared.

## Interpretation and next gates

This is the first clean receipt after three source repairs: a final
pre-request check, initial-prompt protection, sticky settled-turn history,
and synchronous abort/committed-compaction handling. It establishes that the
handoff lifecycle is reachable and bounded on this loaded Qwen epoch. It does
not establish context capacity, model performance, rearm behavior, active-goal
preservation, or model/provider/window switching.

The next evidence must be separately preregistered: first a no-goal rearm
screen, then an active-goal preservation screen, then a provider/model/window
switch. Keep `CONTEXT_HANDOFF=on` and `CONTEXT_DISCOVERY=off` defaults as-is;
do not pool these mechanism receipts with gate or efficacy evidence.
