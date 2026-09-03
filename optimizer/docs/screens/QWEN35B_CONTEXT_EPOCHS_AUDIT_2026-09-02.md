# Qwen 35B dynamic context epoch smoke — audit (2026-09-02)

**Classification: VALID MECHANISM / REACHABILITY RECEIPT ONLY.** This is not a
capacity measurement, quality result, efficiency result, or adoption decision.

## Bound execution

The run followed
[`PREREG_QWEN35B_CONTEXT_EPOCHS_2026-09-02.md`](PREREG_QWEN35B_CONTEXT_EPOCHS_2026-09-02.md)
against `local-llamacpp/qwen36-35b-iq3s`, with `CONTEXT_DISCOVERY=on` and
`CONTEXT_HANDOFF=off`. It used the loaded surface SHA-256
`7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7` and the
source/config/registry identities declared in the preregistration. The router
was healthy before execution; Pi exited 0, stdout was 6 bytes, and stderr was
empty. Temporary telemetry was inspected through a safe-field summarizer only.

## Observed facts

- 72 telemetry rows were emitted, all carrying the loaded surface hash.
- One `runtime/context-profile` row created epoch 0 for the pinned provider and
  model. It declared a 61,440-token window and calculated a 52,224-token safe
  input budget. Its endpoint identity was hashed; no raw URL appeared.
- One `runtime/serving-truth` row observed `served_n_ctx=65536` versus
  `registry_ctx=61440`, with verdict `ok`.
- The served-window update produced one `runtime/context-budget` row, raising
  the safe input budget to 56,320 and reporting `handoff_required=false` for
  this short turn.
- One synthetic `max_tokens=1` request returned status 200 and produced one
  `runtime/context-calibration` row with `success=true`, `failure=none`, and
  `safe_input=56320`. The profile remains reachability evidence labelled
  `observed`; it does not claim that 56,320 tokens were measured as capacity.
- No `runtime/context-handoff` row was expected because automatic handoff was
  explicitly disabled for this first smoke. No goal or planner surface was
  activated.

## Decision

The model-aware profile, local serving probe, calibration isolation, telemetry
binding, and endpoint redaction are live on the current surface. This closes
the stale startup-wiring question only. It does not test crossing the 85%
threshold, the 70% rearm, a pending handoff, a failed/stale lease, an active
goal handoff, or a provider/model/window epoch switch. Those require a separate
preregistered multi-turn screen and must not be inferred from this receipt.

Defaults remain unchanged: `CONTEXT_HANDOFF=on` in ordinary use,
`CONTEXT_DISCOVERY=off`, goals enabled but deferred, and planner/deep-research
graph flags off. The invalid graceful-shutdown rows remain isolated and cannot
be pooled with this receipt.
