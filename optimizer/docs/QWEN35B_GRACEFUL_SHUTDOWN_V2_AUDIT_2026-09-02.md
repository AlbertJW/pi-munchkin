# Qwen 35B post-foreground-timeout gate audit (2026-09-02)

**Classification: INCOMPLETE INFRASTRUCTURE SCREEN.** This run is not a Qwen
quality result, optimizer evidence, planner/deep-research evidence, or
adoption decision.

The run followed
[`PREREG_QWEN35B_GRACEFUL_SHUTDOWN_V2_2026-09-02.md`](PREREG_QWEN35B_GRACEFUL_SHUTDOWN_V2_2026-09-02.md)
with one base replicate of `parens`, `equil`, and `bigdata`, pinned to
`local-llamacpp/qwen36-35b-iq3s`. All three local fixture gates passed. The
authenticated trial-validity sidecar then accepted only `equil`:

| Fixture | Gate | Infrastructure validity | Safe classification |
|---|---:|---:|---|
| `parens` | 1 | FAIL | consumed 478/480 seconds and was still mutating at the bound; settlement sidecar incomplete |
| `equil` | 1 | PASS | completed at 198/480 seconds with one authoritative settlement |
| `bigdata` | 1 | FAIL | still mutating at the timeout boundary; settlement sidecar incomplete |

The two voids are the same long-running model/tool-loop class seen in the
earlier retry, not evidence of a duplicate `SIGTERM`: the focused Seatbelt
fixture under the new `--foreground` timeout emitted exactly one
`session_shutdown` followed by one `agent_settled`. The full gate therefore
confirms that the timeout wrapper fix is active while also showing that
foreground signalling cannot make an unfinished model loop settle within an
arbitrary wall-clock bound.

The run was stopped by its declared bounds, not resumed, repaired, or pooled.
No candidate arm, semantic-loop enforcement, planner graph, deep-research
planning, calibration, or optimizer provider was enabled. Raw transcripts and
tool arguments remain outside this report; only the sidecar classifications and
timings above are retained.

## Decision

Keep the duplicate-signal fix. Do not claim the full gate is universally
lifecycle-valid. The next infrastructure work is to characterize bounded
active-tool cancellation and to use semantic-loop recovery to control repeated
mutation tails; any new gate screen must be freshly preregistered and must not
pool these two voided rows. The one valid `equil` row is protocol evidence only
and is insufficient for baseline or candidate decisions.
