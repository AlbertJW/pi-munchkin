# Preregistration: model-switch context-epoch screen (2026-09-02)

## Status and scope

**EXECUTED — clean mechanism receipt recorded 2026-09-02.** This bounded screen tests that
an RPC model switch creates a new serving epoch, rebinds discovery and runtime
telemetry to the destination model, and preserves the ability to complete the
active task. It is not a capacity benchmark, quality result, provider
comparison, gate row, or adoption decision.

## Frozen identity

- Source/runtime surface commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Initial model: `local-llamacpp/qwen36-35b-iq3s`
- Destination model: `local-llamacpp/ling3-tiny-fast`
- Configuration: `CONTEXT_DISCOVERY=off`, `CONTEXT_HANDOFF=off`,
  `GOALS=off`, telemetry on, no saved session, no tools, default model
  settings. Both models use the local loopback router; model identity is the
  deliberate epoch boundary.

## Fixture and sequence

1. Start a disposable RPC session pinned to Qwen and complete one short prompt.
2. Issue the RPC `set_model` command for the registered Ling fast model.
3. Complete one short prompt on Ling and close the session.
4. Inspect only safe telemetry and runtime state. There must be one profile at
   epoch 0 for Qwen and one at epoch 1 for Ling, with no raw endpoint data.

The driver has a 600-second wall bound and retains no model text, prompts, tool
arguments, endpoints, or source contents.

## Acceptance and stop rules

Accept only if both provider turns return status `200`, the process exits `0`
with zero stderr, exactly two context-profile rows exist with epochs `0` and
`1`, and their model IDs are the frozen Qwen and Ling IDs. Every row must carry
the loaded surface hash and one session identity. A missing, repeated, or
misbound epoch, failed destination response, raw endpoint, or mixed surface
invalidates the screen.

This screen does not claim that the task was performed equally well by either
model. It proves only that model switching rebinds context identity and keeps
the protocol usable. The context handoff, goal, planner, and deep-research
defaults remain unchanged.

## Execution receipt

- Result: **CLEAN MECHANISM RECEIPT**; no quality, capacity, comparison, gate,
  or adoption decision.
- Process: exit `0`, `stderr_bytes=0`, two settled agent lifecycles, and both
  provider turns returned status `200`.
- Provenance: one fresh telemetry session with 83 safe rows; every row carries
  the loaded surface hash
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
- Epochs: exactly two `runtime/context-profile` rows: epoch `0` for
  `local-llamacpp/qwen36-35b-iq3s` and epoch `1` for
  `local-llamacpp/ling3-tiny-fast`. Each profile had the expected declared
  61,440-token window and 52,224-token safe-input budget, with distinct hashed
  serving fingerprints. Two context-budget and two serving-truth rows were
  observed, one per model.
- Handoff: none requested because `CONTEXT_HANDOFF=off`; the screen isolates
  model-epoch rebinding rather than compaction behavior.
- Safety: no raw endpoint, prompt, response, tool argument, or source content
  was retained.

The companion audit is
[`optimizer/docs/QWEN35B_CONTEXT_EPOCH_SWITCH_AUDIT_2026-09-02.md`](QWEN35B_CONTEXT_EPOCH_SWITCH_AUDIT_2026-09-02.md).
