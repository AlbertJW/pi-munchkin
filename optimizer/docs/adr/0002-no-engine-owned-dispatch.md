# 0002-no-engine-owned-dispatch

- **Status:** active
- **Date:** 2026-07-23
- **Superseded by:** none

## Decision

The harness blocks and steers; it never dispatches on the model's behalf. No
external component decides *when* or *what* to delegate, run, or execute next
— that judgment stays with the model, working from a model-owned TODO/plan
state. Harness machinery may gate a transition (verify-gate), nudge toward a
strategy (steer text, retry ladder), or refuse a step until a condition is
met — but it does not itself choose and invoke the next action.

## Rationale

An engine-owned dispatcher duplicates the model's own planning loop with a
second, less-informed one, and the two disagree in exactly the cases that
matter (partial progress, ambiguous next step, crash mid-plan). Every
mechanic that plan-weaver's dispatcher tried to own (retry strategy, item
sequencing, resume-after-crash) turned out to work better as steering *into*
the model-owned TODO loop than as a harness process making the call directly.

## Evidence / incident that triggered it

`plan-weaver` (v4, dark, `harness/extensions/plan-weaver.ts`) implemented a
verification-aware compiler with engine-owned subagent dispatch. It shipped,
was iterated on through ~9 QA-found bug fixes (crash-resume, gate-mode
disarm, dispatch ignoring abort signals, stale-plan resurrection), and was
ultimately deleted: commit `e4aaebb` ("Remove plan-weaver (v4); port its best
mechanics into plan-runner") states plainly — "Weave's engine-owned dispatch
model didn't work out in practice." Three of its mechanics (gate retry
ladder, `depends_on` item dependencies, crash/abort resume) were kept, but
ported into `plan-runner.ts`'s model-owned TODO paradigm instead of staying
in a dispatcher that acted independently of the model.

## Relevant paths / subsystems

`harness/extensions/plan-runner.ts` (the model-owned plan/TODO loop that
absorbed weave's mechanics), any future extension that considers invoking
tools or choosing next steps on the model's behalf.

## Review / invalidation condition

Revisit only with a new incident showing the model-owned loop hitting a
ceiling that steering-only mechanics structurally can't fix (not "it would be
more efficient" — weave's premise was efficiency too). A proposal to
reintroduce any form of engine-initiated tool dispatch should cite this ADR
and explain what's different from weave's failure mode.
