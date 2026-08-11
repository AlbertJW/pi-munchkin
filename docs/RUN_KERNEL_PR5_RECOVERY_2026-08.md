# Run Kernel PR 5: dark recovery integration

Status: dark candidate. PR 4 persistence remains the default `RUN_CAPSULE=shadow`; this branch
does not enable recovery injection, mirror the live harness, run a gate round, or make an efficacy
claim.

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

Semantic Tier 1 and Tier 2 recovery interventions use the brief as their message body only in
recovery mode. Tier 3 remains the existing safe abort path and emits no automatic continuation.
The control arbiter still selects at most one same-boundary action.

## Limits and rollback

The brief is bounded by UTF-8 bytes, uses only hashes/enums/counts, and is generated from the
current in-memory snapshot. `RUN_CAPSULE=shadow` is the rollback and remains default. `off`
removes capsule handlers and commands. Recovery is observationally dark until a separate adoption
gate establishes non-zero exposure and a preregistered fixture/model round; shadow persistence and
the recovery plumbing are not evidence of benefit.

Measurements before and after the PR 5 surface hash are not pooled.
