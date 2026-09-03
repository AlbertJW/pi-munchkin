# Preregistration: Qwen 35B foreground-timeout lifecycle receipt (2026-09-02)

## Status and scope

**EXECUTED — infrastructure mechanism receipt only.** This supersedes the
stale `PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-02.md` after the gate timeout
wrapper was corrected. It does not create a gate row, quality result,
candidate comparison, planner/deep-research evaluation, adoption decision, or
rollout.

The narrow question is whether the real Seatbelt path can deliver Pi's
single-flight shutdown lifecycle when the external timeout keeps the command
in the foreground process group. The gate owns descendant cleanup, while the
foreground timeout prevents the duplicate `SIGTERM` that previously aborted
Pi before `agent_settled`.

## Pinned identity

- Requested and resolved model: `local-llamacpp/qwen36-35b-iq3s`
- Transport: loopback llama-swap OpenAI-compatible endpoint
- Source branch: `codex/qwen35b-provenance`
- Gate source commit: `6ef1464` (`fix(gate): keep timeout in foreground process group`)
- Package-source surface SHA-256: `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`
- Loaded Pi agent surface SHA-256: `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`
- Registered-model catalog SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`

The optimizer gate script is not part of the Pi package surface; therefore the
loaded Pi hash remains the same while this wrapper change is evaluated. Any
future gate rows still require a newly prepared campaign/preregistration that
binds the current gate commit and all normal row identities.

## Bounded fixture and expected lifecycle

- One isolated temporary workdir using the existing endpoint Seatbelt profile.
- One pinned Pi print-mode request with `--approve`, `read,bash` tools, and a
  prompt that starts `sleep 60` so an external timeout interrupts an active
  tool turn.
- External bound: 15 seconds, 30-second TERM grace; no retries or candidate arm.
- A private extension records event names only inside the jailed workdir.

The expected receipt is exactly one `session_shutdown` followed by exactly one
`agent_settled`, with the process exiting through the external timeout status.
No model text, tool arguments, commands, source, URLs, or raw telemetry are
retained in this note.

## Result

The pinned Qwen run exited `124` at the deliberate hard bound. The private
lifecycle receipt contained exactly:

```text
session_shutdown
agent_settled
```

The same fixture under the old timeout invocation emitted neither event and
left the authenticated gate settlement absent. The foreground wrapper now
restores the lifecycle ordering needed by `telemetry-flush`; it does not claim
that every long-running model turn will settle before the configured bound.

The first disposable replay also exposed that a custom extension needs Pi's
`--approve` path and a write grant for its receipt. Those were test-fixture
details only; the final probe used the existing approval flag and wrote solely
inside the permitted workdir. No live mirror, source surface, or candidate
configuration was changed by the probe.

## Follow-up boundary

Before any new Qwen gate rows, prepare a fresh full preregistration against
this gate commit and run its offline dry preflight. Keep the prior invalid
three-row run isolated; never resume or pool it. The next valid screen should
exercise the real gate's authenticated failure-episode sidecar and retain the
existing hard wall-clock, memory, sandbox, provenance, and trial-validity
guards.
