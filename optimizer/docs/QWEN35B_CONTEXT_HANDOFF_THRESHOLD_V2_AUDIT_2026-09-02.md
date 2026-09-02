# Qwen 35B context-handoff threshold v2 — audit (2026-09-02)

**Classification: INCOMPLETE MECHANISM PROBE; FAILED CLOSED.** The repaired
pre-request hook fired on the loaded surface, but this run used an oversized
first prompt with no prior compactable turn. It is not a capacity, quality, or
adoption result.

## Bound execution

The run used source commit `aad8e84`, package-source surface
`704ca8201022509eba1be456966b840689adc2f370146e1ba23be6e2d539ae83`, and the
then-loaded mirror `2c3449b84ab1ca3ca8cb5b88bfe2dfa79399def57301e20406d5be969dae11f6`.
The subject was `local-llamacpp/qwen36-35b-iq3s`, with
`CONTEXT_HANDOFF=on` and `CONTEXT_DISCOVERY=off`. Synthetic input, stdout, and
stderr were disposable and are not part of this audit.

## Safe observations

- The bounded process exited with status 1. Stdout was empty; stderr was 16
  bytes and classified only as an aborted request.
- The temporary authenticated telemetry stream contained 68 rows, all stamped
  with the loaded surface hash. It recorded one `runtime/context-profile` at
  epoch 0 with a 52,224-token safe budget and one
  `runtime/context-handoff` outcome with `ok=false` and
  `reason_class=budget_threshold`.
- No provider timing settled with a successful status, no serving-window update
  occurred, and no follow-up response was accepted. The run-kernel closed as
  `paused`, so it cannot be treated as a successful handoff.

## Diagnosis

The synthetic input was the initial provider turn. Pi's compactor cannot remove
the only user request, so `ctx.compact()` aborted that request and returned a
bounded failure (`Nothing to compact`). The pre-request hook was therefore
correctly reached but was applied to a state where no handoff was possible.

A counterfactual regression was then run against the source without the new
guard: it attempted one compaction for the oversized initial prompt and failed
the assertion. Restoring the guard passed all 12 context-profile tests. Commit
`8f5d475` now moves the current timing record before the check and permits
pre-request handoff only when a provider turn already exists; initial-prompt
overflow remains Pi's native responsibility. The repaired source surface is
`18d9b372b936bd9d00ae1ebcc9fee504ab4771fe110ef6c0e792fa170f769e27`.

## Decision

Keep this run as a diagnostic receipt only. The previous source repair is not
enough to claim handoff safety, and this run does not test the queued-follow-up
case. A fresh mirror and hash-bound v3 preregistration must use a genuine
multi-turn near-budget fixture: establish at least one completed provider turn,
then cross the threshold before the next request. Require one outcome-bearing
handoff, no duplicate trip before rearm, and no raw endpoint or payload data.
