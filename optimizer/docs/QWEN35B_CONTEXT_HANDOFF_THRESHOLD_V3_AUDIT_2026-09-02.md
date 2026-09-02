# Qwen 35B context-handoff threshold v3 — audit (2026-09-02)

**Classification: INCOMPLETE MECHANISM PROBE; FAILED CLOSED.** The two-turn
driver established a prior provider turn, but its second payload reached Pi's
native 90% compaction threshold before the harness-specific handoff outcome
could be emitted. The resulting native compaction and retry are not evidence
that the dynamic pre-request handoff fired.

## Bound execution

The run used source commit `8f5d475` and loaded surface
`59d7c389326745faa2d11e865c7a09b58ed1e69fd518ef465a1d68a3a47ca82f`, with
subject `local-llamacpp/qwen36-35b-iq3s`, `CONTEXT_HANDOFF=on`, and
`CONTEXT_DISCOVERY=off`. A disposable RPC driver sent a small first prompt,
waited for settlement, then sent the deterministic padding as a separate
second prompt. Raw prompts, responses, and stderr are not retained.

## Safe observations

- The driver completed two provider requests and exited after the second
  settlement. Telemetry contained 47 authenticated rows, all bound to the
  loaded surface hash, with no raw payload or endpoint keys.
- The second assembled context was 56,195 tokens (91.46% of the declared
  61,440-token window). Pi emitted one `context-watcher/compacted` row with
  `reason=threshold` and then a second provider timing row with status 200.
- No `runtime/context-handoff` row was emitted. The native compactor therefore
  owns this receipt; it cannot validate the new prior-turn guard or handoff
  rearm behavior.

## Decision

Keep this run quarantined as a native-compaction diagnostic. The next fixture
must stay below Pi's native 90% threshold while remaining at or above the
harness's dynamic 85% threshold. A new preregistration is required before that
run; no handoff-safety, capacity, quality, or adoption claim is valid.
