# Qwen 35B active-goal context-handoff audit — 2026-09-02

## Verdict

**CLEAN MECHANISM RECEIPT.** The hash-bound run proved that an executable
persistent goal remains active across one repaired model-aware handoff and its
follow-up continuation. This is protocol evidence only, not a persistence
benefit, quality, capacity, gate, or adoption result.

## Bound identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Runtime source commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Telemetry: one fresh private session, 126 safe rows, no retained raw
  prompts, responses, goal text, endpoints, or tool arguments.

## Safe observations

The host-reachable driver exited `0` with zero stderr and settled four agent
lifecycles: goal start, a small ordinary turn, the oversized request, and the
handoff continuation. The goal ledger ended with one non-null current-goal ID,
the same ID hash emitted at start, `status=active`, and its required criterion
still `open`; the model therefore could not hide a lost goal by settling it.

Exactly one `runtime/context-handoff` outcome was recorded with `ok=true` on
epoch 0, alongside exactly one `context-watcher` compaction attributed to
`model-handoff`. Provider timing statuses were `200, 200, null, 200`: the null
request was cancelled at the dynamic threshold and the final response arrived
after the recovery brief and continuation. No native Pi compaction occurred,
and no pause, block, cancellation, settlement, or goal-ID change was observed.

## Interpretation and next gate

This closes the active-goal preservation mechanism gate for this Qwen serving
epoch. It does not prove long-horizon steering value, 80/20 behavior, or
cross-provider/model/window safety. The next dynamic-context gate is the
separate provider/model/context-window switch screen; keep all defaults and
planner/deep-research flags unchanged.
