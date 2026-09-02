# Preregistration: Qwen 35B context-handoff threshold screen v2 (2026-09-02)

## Status and scope

**PREPARED — no execution is implied by this document.** This is a bounded
mechanism screen for the pre-request handoff repair. It is not a capacity
benchmark, quality result, model comparison, or adoption decision.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source branch: `codex/qwen35b-provenance`
- Code commit: `aad8e84`
- Package-source surface SHA-256: `704ca8201022509eba1be456966b840689adc2f370146e1ba23be6e2d539ae83`
- Loaded Pi agent surface SHA-256: **TO BE RECORDED AFTER APPROVED MIRROR**
- Model-registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Synthetic-input revision: `context-padding-v1`

The loaded surface and serving identity must match after the mirror receipt is
recorded. Raw padding, prompts, responses, and endpoint URLs are not retained
in the audit.

## Bound fixture and expected behavior

Use one no-goal, no-tool Pi print session with deterministic synthetic input
large enough to cross the model-specific safe input threshold immediately
before a provider request. Set `CONTEXT_HANDOFF=on` and
`CONTEXT_DISCOVERY=off`. The short sentinel response keeps the check
independent of task quality.

Require a single outcome-bearing `runtime/context-handoff` row and a follow-up
turn only after successful compaction. A second handoff is forbidden until
usage falls below the 70% rearm threshold. Stop on a missing or duplicate
outcome, a provider request proceeding with an over-budget context, a second
trip without rearm, raw endpoint/payload leakage, or any mirror mutation.

## Offline and execution boundary

Before execution, recompute the source hash, record a zero-drift mirror and
loaded hash, confirm router health, and confirm no active Pi process. Generate
padding in a disposable path. The model-executing command remains explicit and
human-approved; no test, verifier, or automation invokes it.

## Interpretation

A clean result proves only the repaired one-shot handoff boundary for this
serving epoch. It does not measure context capacity or prove benefit on other
models. Keep the startup epoch receipt and the pre-fix diagnostic audit
separate from this screen.
