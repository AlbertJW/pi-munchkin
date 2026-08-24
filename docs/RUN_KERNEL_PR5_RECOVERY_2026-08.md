# Run Kernel PR 5: recovery integration

Status: implemented and adopted 2026-08-24. `RUN_CAPSULE=recovery` is the deployed default;
`RUN_CAPSULE=shadow` is the explicit rollback and keeps persistence without model-context
injection. This document describes the bounded recovery contract, not an efficacy claim.

## Recovery brief contract

`harness/lib/recovery-brief.ts` projects only the closed RunState contract into a deterministic
brief capped at 2 KiB. It contains fixed fields for the objective hash (the label is intentionally
not retained), phase, outcome, current item hash, verified fact hashes, last mutation and gate
state, failure class, active walls, capability counts, and a deterministic next safe action.
The opening and closing markers identify the payload as untrusted evidence rather than
instructions or authority. No raw prompt, command, argument, output, path, URL, endpoint, error,
secret, or model-generated summary is persisted or emitted.

## Eligible delivery windows

Recovery mode adds a context handler only when `RUN_CAPSULE=recovery`:

- after `session_compact`, the first following context request receives one `compaction` brief;
- after an unsettled `agent_end` whose RunState failure class is `provider`, the first following
  context request receives one `provider_retry` brief;
- normal successive context calls receive zero capsule bytes;
- `agent_settled` clears both pending windows, so a later retry or compaction cannot receive stale
  recovery data.

The model-driven `compact_context` tool appends the same projection to custom compaction
instructions in recovery mode. Shadow mode keeps its previous instruction bytes. No provider
retry, abort, or model selection is performed by the harness.

## Manual recovery

`/run-resume` exists only in recovery mode. It emits a typed resume request; loop-breaker clears
episode walls and publishes a typed completion signal. `/loop-resume` uses the same path in
recovery mode and retains its deployed `sendUserMessage` behavior in shadow mode. The completion
signal causes Run Kernel to clear active/exposed episode counts, reopen the run, and append a
`manual-resume` transition. The capsule appends one deterministic custom message with
`triggerTurn=false`, so no provider request starts automatically.

Historical note: semantic Tier 1 and Tier 2 originally used this full brief in recovery mode.
The semantic-truth repair removed that coupling: tier corrections now contain only the observed
failure class, call-variant count, verification-frontier state, and one required next action.
Tier 3 remains the existing safe abort path and emits no automatic continuation. The control
arbiter still selects at most one same-boundary action.

## Limits and rollback

The brief is bounded by UTF-8 bytes, uses only hashes/enums/counts, and is generated from the
current in-memory snapshot. `RUN_CAPSULE=shadow` is the rollback. `off` removes capsule handlers
and commands. Recovery exposure is now model-visible only at the bounded windows above; the
adoption is an operational judgment, not evidence of benefit. Any efficacy claim still requires
a fresh, preregistered fixture/model round on the current surface hash.

Measurements before and after the PR 5 surface hash are not pooled.
