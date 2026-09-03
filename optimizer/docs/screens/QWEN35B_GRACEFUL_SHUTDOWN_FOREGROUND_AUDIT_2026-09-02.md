# Qwen 35B graceful-shutdown foreground-timeout audit (2026-09-02)

**Classification: VALID INFRASTRUCTURE MECHANISM RECEIPT ONLY.** This is not a
gate-quality, efficacy, candidate, or adoption result.

The previous three-row graceful-shutdown screen reached the fixture gate but
was correctly voided because no authenticated failure-episode settlement
arrived. Source and Pi runtime inspection isolated the failure to GNU
`timeout`'s default process-group mode: in the Seatbelt path it forwarded a
duplicate `SIGTERM` into Pi. Pi's print-mode shutdown handler is single-flight;
the second signal could observe an already-disposed runtime and abort before
`agent_settled` was emitted.

The gate now invokes a GNU-compatible timeout with `--foreground`. This keeps
Pi and the sandbox wrapper in one foreground process group while preserving the
gate's existing explicit descendant sweep after the bounded wait. A targeted
integrity test was red before the source change and green afterward; the exact
jailed Qwen fixture then emitted one `session_shutdown` followed by one
`agent_settled` and exited with the expected timeout status `124`.

This closes the duplicate-signal mechanism observed in the gate wrapper. It
does not prove that a full gate row is valid, that tool cancellation always
settles, or that a model will finish inside any particular timeout. A new
hash-bound full gate preregistration is required before collecting rows. The
prior invalid run remains quarantined and cannot be resumed or pooled.

The source fix is `6ef1464`; the Pi package and live mirror were not changed by
the wrapper-only patch, so the loaded Pi surface remains
`7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`. No dark
candidate, planner graph, context default, or optimizer campaign was enabled.
