# Qwen 35B context-handoff rearm audit — 2026-09-02

## Verdict

**CLEAN MECHANISM RECEIPT.** The hash-bound three-cycle screen proved that the
automatic handoff latch does not repeatedly fire while context remains high,
and that it rearms after compaction lowers usage below the 70% threshold.
This is protocol evidence only, not a capacity benchmark, quality result,
gate row, optimizer result, or adoption recommendation.

## Bound identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Telemetry: one fresh private file, one session identity, 96 rows, and no
  retained raw prompts, responses, endpoints, or tool arguments.

## Safe observations

The driver exited `0` with zero stderr and settled five agent lifecycles. The
first large turn crossed the dynamic threshold, produced one cancelled
provider timing, one `model-handoff` compaction, and one `ok=true` outcome.
After the post-compaction continuation settled below the 70% rearm threshold,
the second large turn produced the same sequence once more. The final
continuation returned successfully.

The two handoff outcomes remained on epoch 0 and had
`reason_class=budget_threshold`. Provider timing statuses were
`200, null, 200, null, 200`, and the compaction observer recorded exactly two
`requester=model-handoff` rows with no native `pi` compaction. No duplicate
handoff occurred between either threshold crossing.

## Interpretation and next gates

This closes the no-goal one-shot/rearm mechanism gate for the current Qwen
serving epoch. It does not prove that the same behavior preserves an active
goal or survives provider/model/window changes. Those are the next separate
screens; keep the default flags unchanged and do not pool this receipt with
gate or efficacy evidence.
