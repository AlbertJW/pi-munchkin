# Preregistration: Qwen 35B context-handoff threshold screen v4 (2026-09-02)

## Status and scope

**PREPARED — no execution is implied by this document.** This bounded
mechanism screen isolates the harness pre-request handoff from Pi's native
90% compactor. It is not a capacity benchmark, quality result, model
comparison, or adoption decision.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source commit: `392fcdc`
- Package-source surface SHA-256: `c73d86a5c704253293d7458823e591e4e30424ce626a95bb91e397c3d0cf37c0`
- Loaded Pi agent surface SHA-256: `f5cdd5b6cf94e7d5687ff2cda1d1e87af6c535b96ed9456481b194af2c55dddb`
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
