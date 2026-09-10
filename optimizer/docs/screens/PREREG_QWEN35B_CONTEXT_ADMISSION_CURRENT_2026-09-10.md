# Preregistration: current-source Qwen context-admission safety screen (2026-09-10)

## Scope

This is a bounded **safety and treatment-exposure** qualification for the
current context-admission source, not a task-quality or default-adoption
screen. It supersedes neither the historical Qwen-to-Ling mechanism receipt
nor the unit coverage of observed-usage recovery.

## Frozen inputs

- Revision: `qwen35b-context-admission-v1`
- Requested model: `local-llamacpp/qwen36-35b-iq3s`
- Served model request: `qwen36-35b-iq3s`
- Declared context window: 32,768 tokens
- Manifest SHA-256: `9ad6e1a23e97ce47ec51d36c5bb94596b9b3cfac95d1cea7233d2453395c91d5`
- Context-admission source SHA-256:
  `fa48f06ae7d865a71cc468ada847faf16d81620fbbb04221092bc84cc28c6a7b`
- Telemetry-flush source SHA-256:
  `571128f7fc6e70312f345a808b39144954e6c2af876be0957fe708723386d532`
- Approval SHA-256:
  `94e8d647085997598d00816bc0f996c939c165cb450c9e2c01f71267c77b9bea`

The screen launches Pi in a fresh private agent directory with only the
context-admission and telemetry-flush extensions. A local forwarding proxy
counts requests but stores neither prompt nor response content. Its endpoint
is only hashed in the private result.

## Hypothesis and cells

The current extension should expose a normal Qwen request as `admitted`, then
reject an independently generated 200,000-byte system-prompt fixture as
`aggregate_budget_exceeded` before it can cross the proxy.

The normal cell permits exactly one forwarded request. The oversized cell
permits exactly zero. Each Pi subprocess has a fixed timeout (180 seconds for
the normal cell, 60 seconds for the blocked cell). There is no retry, extension
of a failed cell, calibration, or fallback model.

## Metrics and acceptance

The result is a clean mechanism receipt only when both cells have their
required telemetry classification and their proxy forwarding count. Any exit
failure, missing telemetry, model failure, extra request, or mismatched
classification is a failed or unresolved screen. The private result contains
only stable identifiers, hashes, byte counts, timings, status classes, and
token-independent request counts.

This screen deliberately does **not** claim that provider-rendered token
counting is exact, that one model has enough capacity for all workloads, or
that admission improves task quality. Observed-overflow binding, failed
compaction, reservations, and provider/window switching retain their targeted
offline tests and require a later broader safety screen before any adoption
decision.
