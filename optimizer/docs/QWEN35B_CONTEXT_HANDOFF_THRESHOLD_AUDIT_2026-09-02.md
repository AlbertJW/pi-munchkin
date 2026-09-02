# Qwen 35B context-handoff threshold screen — audit (2026-09-02)

**Classification: INCOMPLETE MECHANISM PROBE; SOURCE DEFECT IS CONFIRMED.** The
run below exercised the loaded pre-fix surface and cannot establish handoff
safety, capacity, quality, or adoption.

## Bound execution

The probe followed the prepared threshold preregistration against
`local-llamacpp/qwen36-35b-iq3s`, with `CONTEXT_HANDOFF=on` and
`CONTEXT_DISCOVERY=off`. It used source commit `6ef1464`, package-source
surface `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`,
and loaded surface `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca`.
The synthetic padding and a read-only usage probe lived outside the repository;
neither raw input nor model text is retained here.

## Observed facts

- Pi exited at the bounded probe timeout with the sentinel response already
  written and no stderr. The safe telemetry stream contained 25 rows.
- The profile began with a 52,224-token safe input budget. Serving discovery
  then raised it to 56,320; the budget row reported no handoff because the
  completed-turn usage was below the revised threshold.
- No `runtime/context-handoff` outcome was emitted.
- An isolated usage probe at the same lifecycle boundary observed 55,022
  tokens (89.55%) in `before_provider_request`, then 46,130 tokens (75.08%) at
  `turn_end` and `agent_settled`. The probe emitted only token counts and
  percentages, not payloads, endpoints, or prompts.

## Diagnosis and source repair

The runtime checked the threshold at `turn_end`, after the provider response.
That misses a queued follow-up whose assembled context is already over budget
when the next provider request is about to start; the response can be smaller
and clear the later check. A targeted regression was first run against the
unfixed source and failed with zero compactions, then passed after commit
`aad8e84`, which invokes the existing single-flight handoff at
`before_provider_request`. Pi's `ctx.compact()` aborts the active operation
before compacting and queues the follow-up from its completion callback.

The repaired source surface is
`704ca8201022509eba1be456966b840689adc2f370146e1ba23be6e2d539ae83`. The live
mirror still carries the earlier loaded hash, so this source fix is **pending
rollout** and has not been live-smoked.

## Decision

Treat the pre-fix probe as a diagnostic receipt only. Do not pool it with the
startup epoch smoke or infer that automatic handoff works. After a separately
approved mirror, run the new hash-bound preregistration
`PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V2_2026-09-02.md`; require one
outcome-bearing handoff, no duplicate trip before rearm, and no raw endpoint or
payload leakage before considering the mechanism screen complete.
