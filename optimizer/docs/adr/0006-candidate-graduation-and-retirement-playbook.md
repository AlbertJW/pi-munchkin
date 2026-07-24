# 0006-candidate-graduation-and-retirement-playbook

- **Status:** proposed
- **Date:** 2026-07-24
- **Superseded by:** none

## Decision

When a dark candidate reaches a real `fleet_report.py` verdict (`ADOPT-*` or a
sustained `REJECT`) and a human decides to act on it, execute one of the two
checklists below rather than improvising the mechanics case by case. ADR
0004 already establishes that adoption and deletion are always human-gated —
this ADR is the concrete "what actually changes on disk" checklist for
executing that decision once a human has made it, not a change to who
decides.

**Graduation checklist** (candidate wins, becomes the unconditional default):

1. Remove the `process.env.FLAG` gate in its extension file; replace with the
   unconditional behavior; delete now-dead conditionals that only existed to
   branch on the flag.
2. Remove its threshold entry from `optimizer/prompt-lab/configs/schema.json`'s
   `thresholds.fields`.
3. Retire its static config under `optimizer/prompt-lab/configs/static/` — once
   the flag is gone, that config's `cand` arm is identical to `base` and can
   no longer produce a measurement.
4. Update or remove any test asserting "flag off ⇒ dormant/legacy" behavior.
5. **Only if the candidate also touches `optimizer/real_gate.sh`'s tool-grant
   logic** (e.g. a flag needing `subagent`, `search_spans,read_span`, or the
   `plan_write`-family instrument-consistency checks per ADR 0001): simplify
   the conditional grant to unconditional, and drop the now-unnecessary
   consistency check for that flag.
6. Telemetry-catalog entries (`harness/lib/telemetry-catalog.ts`) need no
   change — they key on event name, not flag name.

**Retirement checklist** (candidate loses, or times out unmeasured):

1. Delete the extension file, or the specific gated code block if the
   candidate isn't a whole file.
2. Delete its static config, its `schema.json` threshold entry, and any
   telemetry-catalog entries exclusively its own.
3. Delete its dedicated tests.
4. Requires the same explicit human sign-off as graduation — this checklist
   documents mechanics, it does not authorize skipping that sign-off.

## Rationale

`fleet_report.py` already has a fully objective statistical layer (a
one-sided Fisher's-exact test at `ALPHA=0.05`, an overfit-gap check, a cost
ceiling, and five deterministic verdict labels through `ADOPT-UNIVERSAL`).
Nothing currently connects that objective verdict to an actual action —
every dark candidate that ever wins or loses still requires someone to
figure out, from scratch, exactly which files change. A written checklist
turns "win a round" into a mechanical, low-risk operation instead of a
bespoke exercise invented under whatever time pressure exists when the
decision finally has to be made.

## Evidence / incident that triggered it

A full-history audit (2026-07-24) found **zero** commits in this repo's
entire history that remove a `process.env.FLAG === "on"|"1"` gate from
`harness/extensions/*.ts` to make its behavior the unconditional default —
no dark candidate registered in `optimizer/prompt-lab/configs/schema.json`
has ever been graduated. (The closest analog, the dd1 minimal-governor swap
in commit `6888a19`, operates on which system-prompt file is loaded — a
different mechanism entirely, not an env-flag removal.) Retirement has
happened exactly once: `c22-plan-weaver` (commit `e4aaebbe`, 2026-07-20),
which deleted `harness/extensions/plan-weaver.ts`,
`harness/lib/plan-contract.ts`, their tests, and
`optimizer/prompt-lab/configs/static/c22-plan-weaver.json` — but that
candidate predates and falls outside the c25-c39 roster
`optimizer/docs/CANDIDATE_PRUNING_2026-07.md` tracks, and its own flag
(`PLAN_MODE === "v4"`) was never registered in `schema.json` to begin with.
The 16-candidate active roster has never had a single graduation or
retirement executed against it, with the 2026-09-03 "win or retire"
deadline approaching.

The graduation checklist above is generalized directly from a worked
example audited the same day: graduating `c29-micro-gate-slop`
(`MICRO_GATE_SLOP`) would require editing `harness/extensions/micro-gate.ts:32,36,62,93`,
removing `optimizer/prompt-lab/configs/schema.json:157-160`, retiring
`optimizer/prompt-lab/configs/static/c29-micro-gate-slop.json`, and updating
four `process.env.MICRO_GATE_SLOP = "on"` lines in
`harness/tests/micro-gate-policy.test.ts` — a "cheap," `real_gate.sh`-free
example, contrasted with candidates like `PLAN_SUBAGENT_ONLY`/`PLAN_DELEGATE_ALL`/
`PLAN_TOOL_GO` that would additionally require simplifying
`optimizer/real_gate.sh`'s tool-grant conditionals (step 5).

## Relevant paths / subsystems

`harness/extensions/*.ts` (every flag listed in
`optimizer/docs/CANDIDATE_PRUNING_2026-07.md`'s roster), `optimizer/prompt-lab/configs/schema.json`,
`optimizer/prompt-lab/configs/static/*.json`, `optimizer/real_gate.sh` (tool-grant
logic, per ADR 0001), `optimizer/prompt-lab/fleet_report.py` (the verdict
layer this checklist acts on), `optimizer/docs/CANDIDATE_PRUNING_2026-07.md`
(the roster this checklist is executed against).

## Review / invalidation condition

Promote this ADR's status to `active` once it has actually been used for a
real graduation or retirement (the c33-subagent-fork-default retirement
proposal is the intended first exercise). Revisit the checklist itself if a
future candidate's shape doesn't fit either list cleanly — e.g. a candidate
that changes a schema field's *values* rather than gating a boolean, or one
that spans multiple extension files — and extend rather than replace it.
