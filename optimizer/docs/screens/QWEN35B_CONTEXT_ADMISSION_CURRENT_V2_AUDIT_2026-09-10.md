# Qwen context-admission current-source V2 — audit (2026-09-10)

## Result

V2 is **incomplete / unresolved**, not a passing screen. Its private
permissions-checked artifact is
`qwen35b-context-admission-v2-cea78dd5e5663d51-2e8026e6-5ca8-43ab-9ddb-8af09fe10394.json`
with artifact-path digest
`198f6ac2693728f805eee25036ce7ba690897dde0a8f46867309d3a78551ce9c`.

The normal cell produced a current-source `context-admission` telemetry row
with `outcome=admitted` and `reason_class=within_budget`, and the isolated
proxy counted exactly one forwarded request. The oversized cell produced
`outcome=rejected` with `reason_class=aggregate_budget_exceeded`; its proxy
count was zero. This is direct evidence that the extension’s pre-dispatch
guard was exposed on the requested Qwen route.

However, the normal Pi subprocess exited `1` after its forwarded request. The
screen's preregistration requires a successful normal process as well as the
admission row and forwarding count. The original runner mistakenly omitted
that condition and printed `passed: true`; a targeted regression now requires
normal `exit_code === 0` before a screen may pass. Under the corrected rule,
V2 is not a safety qualification and must not support adoption.

## Boundaries and next action

The run used the V2 manifest and approval SHA from the preregistration, one
normal request, no retry, and a private artifact mode of `0600`. It did not
measure actual rendered-token capacity, observed-overflow recovery,
compaction, concurrent reservations, provider/window switching, or task
benefit. It also did not preserve raw request, response, router endpoint, or
model error content in public artifacts.

Do not rerun V2. The next context study, if justified, must diagnose the
non-zero Pi completion in an offline launcher fixture first, then freeze a new
manifest that treats both normal completion and pre-dispatch rejection as
required conditions.
