# Model-switch context-epoch audit — 2026-09-02

## Verdict

**CLEAN MECHANISM RECEIPT.** The run proved that an RPC switch from the pinned
Qwen 35B model to the registered Ling fast model creates a new context epoch,
refreshes model-aware runtime facts, and keeps the next provider turn usable.
This is protocol evidence only; it is not a model-quality comparison.

## Bound identity

- Runtime source commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Models: `local-llamacpp/qwen36-35b-iq3s` →
  `local-llamacpp/ling3-tiny-fast`

## Safe observations

The disposable RPC process exited `0` with zero stderr and settled two
lifecycle turns. Both provider timings returned status `200`. Telemetry had 83
rows in one session and one loaded surface hash. Exactly two context profiles
were emitted: epoch 0 for Qwen and epoch 1 for Ling, with distinct hashed
serving fingerprints. Each model also produced its own context-budget and
serving-truth observations; no values or identity from epoch 0 leaked into
epoch 1. Automatic handoff was disabled by preregistration, and no compaction
was requested.

No raw endpoint, prompt, response, tool argument, or source content was kept.

## Interpretation and next gate

This closes the model-identity epoch-rebinding mechanism gate for the current
loopback router. It does not test differing providers, differing declared
windows, active-goal preservation (covered separately), or cross-epoch
handoff safety. The next remaining work is the broader dark-candidate suite:
semantic-loop delivery, research-ledger comparison, bash-output guard,
working-memory/minimal-tools value screens, and finally the hierarchical
planner/deep-research evaluation.
