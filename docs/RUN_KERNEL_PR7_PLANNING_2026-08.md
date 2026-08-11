# Run Kernel PR 7 — adaptive planning and delta status

PR7 is a dark, independently reversible candidate. `PLAN_MODE=forced` remains
the deployed behavior. `adaptive` adds stable-ID progress updates, a private
run-capsule plan store, and an explicitly invoked bounded direct path. `off`
disables these candidate additions; it does not silently remove the deployed
plan safety guards. No live mirror, default flip, adoption, or gate round is
part of this change.

## Contract

`plan_write` remains the only creation/replan tool: it owns the complete item
set, titles, order, dependencies, and gates. Adaptive `plan_update` accepts
only `{item_id, status, note?, failure_class?}` deltas. Unknown IDs,
conflicting duplicate updates, multiline/unbounded notes, and invalid failure
classes are rejected. Applying a delta preserves every item and its order;
identical updates are idempotent. Marking a gated item done still runs the
existing read-only gate and publishes the same one-shot receipt semantics.

New adaptive plans are written privately below the active run-capsule directory
with the same bounded atomic writer. Existing `.pi/plan-state.json` and
`.pi/TODO.md` remain read-only import sources. `/plan-export` is the explicit
human-facing export path and is the only adaptive command that writes
`.pi/TODO.md`.

`/plan-direct` is not a classifier or dispatcher. It requires one explicit,
single-line request of at most 240 characters and rejects destructive,
deployment, secret, and credential operations. It bypasses only the initial
plan-ceremony guard; the ordinary mutation, verification, and user-confirmation
guards remain authoritative. Direct mode clears at agent end and never creates
an engine-owned work queue.

## Rollback and measurement

- `PLAN_MODE=forced` restores the deployed whole-plan surface.
- `PLAN_MODE=off` hides `plan_update`, private storage, and `/plan-direct`.
- Adaptive telemetry reports only delta counts, bounded request byte counts,
  and accepted/rejected reason classes.
- The candidate primary must be preregistered as calls before first source
  mutation or non-productive planning calls. Repeat calls, semantic failures,
  tokens, latency, and correctness are secondary; correctness remains a harm
  guard. No default flip occurs without powered replicated evidence and explicit
human approval.
