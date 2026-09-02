# Preregistration: Qwen 35B context-handoff threshold screen (2026-09-02)

## Status and scope

**PREPARED — no execution is implied by this document.** This is a bounded
mechanism screen for model-aware context epochs and the existing automatic
handoff. It follows the startup wiring receipt in
`QWEN35B_CONTEXT_EPOCHS_AUDIT_2026-09-02.md` and tests the previously untested
85% trip, single-flight compaction, and rearm state. It is not a capacity
benchmark, quality result, model comparison, or adoption decision.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source branch: `codex/qwen35b-provenance`
- Code commit: `6ef1464`
- Package-source surface SHA-256: `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`
- Loaded Pi agent surface SHA-256: `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`
- Model-registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Synthetic-input revision: `context-padding-v1`

The loaded Pi surface and serving identity must match these values. Raw
padding, prompts, responses, and endpoint URLs are not retained in the audit.

## Bound fixture and expected behavior

Use one no-goal, no-tool Pi print session with a deterministic synthetic input
large enough to place completed-turn usage above 85% of the observed safe input
budget, but below the declared serving window. `CONTEXT_HANDOFF=on` is the
only treatment; `CONTEXT_DISCOVERY=off` keeps the result focused on the existing
profile and handoff path. The model is asked for a short sentinel response so
the test does not depend on task quality.

The expected safe telemetry is one `runtime/context-profile`, one
`runtime/context-handoff` with an outcome (`ok` true or an explicit bounded
failure), and a follow-up turn only when compaction succeeds. A second handoff
must not occur until usage falls below the 70% rearm threshold. No raw endpoint,
padding, tool argument, or model text may appear in the receipt.

## Offline preflight

Before execution, confirm the source hash, loaded mirror (122/122), router
health, and no active Pi process. Generate the padding in a disposable path;
it is test input, not repository state. The only model-executing command is the
explicitly approved invocation after this preflight.

## Execution boundary and stop conditions

Stop on an epoch mismatch, missing or duplicate handoff outcome, a follow-up
sent while the handoff lease is active, an over-budget request, a second trip
without rearm, raw endpoint/payload leakage, or any mutation to the live
mirror. A clean receipt proves only the one-shot handoff mechanism for this
serving epoch. It does not establish a measured context capacity; the existing
one-token calibration remains reachability evidence labelled `observed`.
