# 0005-evidence-ladder-for-trajectory-checks

- **Status:** active
- **Date:** 2026-07-23
- **Superseded by:** none

## Decision

A trajectory check (e.g. `TRAJECTORY`/`SPAN_TOOLS`, verifying a claimed tool
call actually happened) must state which evidence-ladder rung it relies on,
not claim a blanket property like "unforgeable". Canonical reference:
`optimizer/docs/EVIDENCE_LADDER.md`.

## Rationale

"Unforgeable evidence" was an overclaim, generalizing one mechanism's
strength to trajectory verification as a whole. Weaker rungs silently
inherit that weakness unless a check's claim is scoped to the mechanism it
actually uses.

## Evidence / incident that triggered it

An "unforgeable evidence" claim for a trajectory check, made earlier this
session, was found inaccurate and corrected. Fix: an explicit evidence
ladder, with each check naming its rung instead of the strongest-sounding
default.

## Relevant paths / subsystems

`optimizer/docs/EVIDENCE_LADDER.md` (canonical), `TRAJECTORY`/`SPAN_TOOLS`
flags and their enforcement in `optimizer/real_gate.sh`.

## Review / invalidation condition

Revisit if a new trajectory check ships without naming its rung, or if
`EVIDENCE_LADDER.md`'s rungs change in a way that reclassifies an existing
check.
