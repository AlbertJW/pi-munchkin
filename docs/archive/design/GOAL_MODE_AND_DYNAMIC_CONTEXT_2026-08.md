# Persistent goals and dynamic context (2026-08-27)

This source-only slice adds two model-neutral coordination primitives. It is not
mirrored into `~/.pi/agent` by this change.

## Goal mode

Goals are private, project/worktree-scoped state under the Pi agent artifact
directory. Worktree scope hashes the resolved worktree; project scope hashes
the common root of a linked Git worktree (or safely falls back to that cwd).
A ledger can retain completed/cancelled history while only one
non-terminal head is active for a scope. The goal is separate from the plan
graph: `/plan` may end while the goal remains active or resumable.

Skills use `goal_propose` to make an advisory proposal. A proposal never starts
execution; the user accepts it with `/goal-accept`. Users can explicitly start
one with `/goal <objective>`. `/goal-status`, `/goal-pause`, `/goal-resume`, and
`/goal-cancel` provide lifecycle controls; criterion progress is recorded
through the `goal_update` tool.

`/goal-pause` freezes model updates and settlement until `/goal-resume`; an
explicit user pause therefore remains authoritative across the next turn.

The four goal tools are deliberately a deferred `goals` capability family, not
part of the low-context core tool surface. A skill enables that family only when
it needs persistent coordination; the slash commands remain available for
direct user control. The parent process owns the ledger: delegated child
processes may read the ambient goal context but all model-driven goal mutations
are rejected in children, so a branch report cannot silently rewrite the head.

Settlement is evidence-backed. `goal_settle` supports `complete` and
`accepted_80_20`. Required criteria must be met in both cases. 80/20 acceptance
also records delivered value, confidence, residual risk, evidence, and a
value/risk/rationale tuple for every deferred item. The goal remains resumable
after 80/20 acceptance; complete is terminal.

## Dynamic context and handoff

`runtime-truth` derives a bounded `ContextProfile` from the active model's
provider, model ID, declared context window, and the observed serving window.
Each model fingerprint gets a context epoch. The profile calculates a safe
input budget after an output reserve and harness overhead; it does not assume a
single registry-wide context size.

Switching models creates a new epoch. If the current usage is already over the
new model's safe input budget, the harness requests one native compaction and
queues a bounded follow-up handoff. The compaction coordinator prevents races
with `compact_context`; the automatic request is one-shot for that epoch until
usage falls below the rearm threshold, preventing compaction churn. The handoff preserves goal/plan identifiers, verified
facts, changed paths, blockers, and one next action; preserved text is framed
as untrusted data.

At a turn boundary the same check catches a transcript that has crossed the
active model's safe budget without a model switch. `CONTEXT_HANDOFF=off` is the
rollback. Profiles are exposed only as bounded doctor/telemetry metadata; raw
messages and user content are never used to calibrate them.

Active calibration is opt-in with `CONTEXT_DISCOVERY=on`. It sends one local-only
synthetic OpenAI-compatible handshake (`max_tokens: 1`, no tools, no transcript
content) per serving fingerprint. This validates the serving path; it is not a
capacity benchmark and does not invent a smaller context window. The response is
not added to the session, evidence ledger, or efficacy corpus. Unsafe/public
hosts, non-2xx responses, and network errors fail closed to the
metadata/serving-probe profile.

## Validation and rollout

- `harness/tests/goal-state.test.ts` covers proposal acceptance, private ledger
  persistence, multiple retained goals, project/worktree identity, malformed
  input rejection, UTF-8 byte caps, criterion validation, and 80/20 settlement.
- `harness/tests/context-profile.test.ts` covers model-specific budgets,
  serving metadata, Pi's native 0–100 usage percentages, invalid metadata
  bounds, calibration isolation, and automatic model-switch handoff/re-arm.
- Final offline verification on 2026-08-27: `npm run verify` passed all six
  stages, including 646/646 harness tests, typecheck, health, package smoke,
  optimizer self-tests/dry gate, and secret scan. `npm run mirror:check` still
  reports the expected source-only drift because this slice is intentionally not
  mirrored or loaded.
- New model-visible goal tools and the handoff behavior are source-only here.
  Mirror/apply and any powered measurement remain explicit operator actions.
