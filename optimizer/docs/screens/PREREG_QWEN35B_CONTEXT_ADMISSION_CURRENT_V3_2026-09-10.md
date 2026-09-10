# Preregistration: current-source Qwen context-admission safety screen V3 (2026-09-10)

## Scope and lineage

V3 is a new safety/treatment-exposure screen after V1 failed at launcher setup
and V2 exposed a local forwarding-proxy version-path defect. Neither earlier
screen is rerun or reclassified. V3 freezes the corrected proxy route policy
and, unlike V2, binds its complete runnable measurement code to approval.

## Frozen identity

- Revision: `qwen35b-context-admission-v3`
- Requested/served model: `local-llamacpp/qwen36-35b-iq3s` /
  `qwen36-35b-iq3s`
- Declared context window: 32,768 tokens
- Manifest SHA-256: `cb9e9ec852b000ddfea4fcdc10cfc1e368c5644d4dce2e5ed8dc6c4f7116ddcc`
- Probe SHA-256:
  `c1d482d6db5a1d6eb535fff94327664befc6435f1c344f76a294521fe885b4fa`
- Context-admission SHA-256:
  `fa48f06ae7d865a71cc468ada847faf16d81620fbbb04221092bc84cc28c6a7b`
- Screen evaluator SHA-256:
  `a0a041558ff41b5b3afe7b1545697f7782cfdb2f01cfab6fce3364baa7d0a68e`
- Local proxy-route SHA-256:
  `5ed9cac3fca57c816862d67fc71778d2803bcb078421a263bc5b070df4fb46a3`
- Approval SHA-256:
  `40bdda224345b3f92085f106066b6d6bc4a912435f3bce8981098cb15253b550`

## Cells and acceptance

V3 has exactly two serial cells in a fresh private Pi directory. The normal
cell permits one forwarded request and requires all of: Pi exit 0,
`context-admission/admitted`, and one proxy count. The oversized cell permits
no forwarded request and requires `rejected` with
`aggregate_budget_exceeded`. Its non-zero Pi exit is expected after the guard
aborts it, but cannot compensate for normal-cell failure.

Normal and oversized cells have 180- and 60-second bounds. There are no retries,
fallback models, calibration calls, or added cells. The proxy retains only
counts and forwarding state; raw prompts, responses, endpoint values, and
model errors remain private or discarded.

A passing V3 is a limited current-source pre-dispatch mechanism receipt only.
It cannot adopt the default or prove capacity, recovery, task quality,
observed-overflow handling, reservations, compaction, or provider-switch safety.
