# Preregistration: Qwen 35B context-handoff threshold screen v3 (2026-09-02)

## Status and scope

**PREPARED — no execution is implied by this document.** This is a bounded
mechanism screen for the initial-prompt guard and the queued-follow-up handoff.
It is not a capacity benchmark, quality result, model comparison, or adoption
decision.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source branch: `codex/qwen35b-provenance`
- Code commit: `8f5d475`
- Package-source surface SHA-256: `18d9b372b936bd9d00ae1ebcc9fee504ab4771fe110ef6c0e792fa170f769e27`
- Loaded Pi agent surface SHA-256: **TO BE RECORDED AFTER APPROVED MIRROR**
- Model-registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Synthetic-input revision: `context-padding-v2-multiturn`

The loaded surface and serving identity must match after the mirror receipt is
recorded. Raw padding, prompts, responses, and endpoint URLs are not retained.

## Fixture and sequence

Use a no-goal, no-tool Pi print session with two bounded user turns. The first
turn is small and must complete normally, establishing a prior provider turn.
The second turn uses deterministic padding that places the assembled context
above the model-specific safe input threshold immediately before its provider
request, while remaining below the declared serving window. Set
`CONTEXT_HANDOFF=on` and `CONTEXT_DISCOVERY=off`.

The expected sequence is one ordinary first response, one pre-request
`runtime/context-handoff` outcome, and one follow-up turn only after successful
compaction. An oversized first prompt is a negative control and must not invoke
handoff. A second handoff is forbidden until usage falls below the 70% rearm
threshold.

## Stop conditions and interpretation

Stop on a missing or duplicate handoff outcome, a provider request proceeding
with an over-budget context, a handoff attempt on the initial turn, a second
trip without rearm, raw endpoint/payload leakage, a timeout without settlement,
or any mirror mutation. A clean receipt proves only this lifecycle boundary for
the Qwen serving epoch; it does not measure capacity or establish benefit on
other models.

Before execution, confirm the new source hash, zero-drift mirror and loaded
hash, router health, and no active Pi process. The model-executing command is
explicit and human-approved; tests and verification never invoke it.
