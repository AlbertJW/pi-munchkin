# Candidate Pruning List — 2026-07

Draft removal recommendations for the dark-candidate roster under
`optimizer/prompt-lab/configs/static/`. Companion to `optimizer/docs/HARNESS_SELF_IMPROVEMENT.md`
(the full ledger — every status claim below is sourced from it) and Tier 1 item #5 of
`UPGRADE_MAP.md` ("Audit #11: 14 dark flags now exist... draft a removal list with per-candidate
removal criteria").

**This document recommends; it does not act.** See the closing statement.

## Scope and roster

`ls optimizer/prompt-lab/configs/static/` was walked in full. In the c25–c38 numbering range used
by tonight's session, **16 files** exist on disk (not the ~14 originally estimated — two numbers
are doubled: `c25` covers two unrelated candidates, and `c31` covers both the standalone
plan-uncertainty candidate and a later combo/investigation config):

```
c25-harness-off.json          c30-context-brief.json        c34-plan-item-guidance.json
c25-plan-subagent-only.json   c31-plan-uncertainty.json     c35-bash-output-guard.json
c26-read-dedup.json           c31-c38-combo.json            c36-spawn-delegation.json
c27-redundancy-nudge.json     c32-sha-guard.json             c37-plan-delegate-all.json
c28-teach-hints.json          c33-subagent-fork-default.json c38-force-plan-write.json
c29-micro-gate-slop.json
```

(The earlier c1–c24 batch and the governor `.md`/`span-screen-on.json` files also live in this
directory but are out of scope here — this list covers only the round-5+ delegation/hygiene
ledger, i.e. what tonight's UPGRADE_MAP item actually asked for.)

## Removal criterion, generically stated

Unless noted otherwise per-row: **win a discriminating round (a task landing in `calibrate.py`'s
30–70% pass band for the specific branch the candidate touches) by 2026-09-03 (~6 weeks out) or
retire the flag.** Every candidate below is currently `NEUTRAL` at best on `parens`/`equil`/`bigdata`
— tasks the ledger itself says are "too easy and too small to give most of these mechanisms
anything real to do." The stress-fixture work landing the same day as this draft
(`sv-ambiguous-spec`, `sv-commit-sha-guard`, `qs-error-swallow`,
`hygiene-shared-config-reread`, the t4 delegation hardening) is what should feed the rounds this
clock is waiting on. A flag that has burned six weeks of stress-fixture availability without ever
posting a win is very likely not earning the schema/telemetry/tool-grant surface area it costs to
carry.

## The roster

| Candidate | Current measured status | Removal criterion | Rationale |
|---|---|---|---|
| **c25-harness-off** (`harness-off`, U3b loop-breaker/verify-gate-off control arm) | Never locally measured — no round for this config appears anywhere in the ledger | Win a discriminating round by 2026-09-03 or retire | Meant to quantify the steering layer's actual ROI (the "harness_roi denominator"); exists on disk, registered, but has never produced a single data point |
| **c25-plan-subagent-only** (`plan-subagent-only`, mandatory edit delegation) | `NEUTRAL`, 18/18 both pre- and post- `plan_write` tool-grant fix — but **structurally unmeasurable as designed**: confirmed via 4 independent signals (direct call counts across 18 sessions, harness telemetry, and two adversarial code-trace verify passes) that `PLAN_SUBAGENT_ONLY`'s block requires `state.phase==="executing"`, reachable only via the `/plan-go` slash command, which `real_gate.sh`'s one-shot `pi -p --approve` invocation can never issue | Not a timeframe candidate — needs an activation-path redesign (a tool-callable phase transition, or accept interactive-only and retire) before "win a round" is even possible | See `HARNESS_SELF_IMPROVEMENT.md`'s c37 correction (2026-07-23) for the full investigation; identical root cause affects both this and c37 |
| **c26-read-dedup** (`read-dedup`) | `NEUTRAL`, authoritative — local `c26-35b`, n=3 (supersedes the earlier remote `INCOMPLETE` 17/18) | Win a discriminating round by 2026-09-03 or retire | Purely transient per-call-view dedup; safe, but no session yet has had enough repeat reads to show the token/pass benefit it predicts |
| **c27-redundancy-nudge** (`redundancy-nudge`) | `NEUTRAL`, authoritative — local `c27-35b`, n=3 (supersedes remote `INCOMPLETE` 15/18) | Win a discriminating round by 2026-09-03 or retire | Steer-only nudge toward `compact_context`; needs a genuinely redundancy-heavy fixture before the nudge has anything to fire on |
| **c28-teach-hints** (`teach-hints`) | `NEUTRAL`, authoritative — local, N=6 (36 sessions); base 100% vs cand 89%, sole miss a known serving-config artifact (malformed pseudo-tool-call), not a regression | Win a discriminating round by 2026-09-03 or retire | First round to break the three-in-a-row remote `INCOMPLETE` streak; safe but not yet a demonstrated win |
| **c29-micro-gate-slop** (`micro-gate-slop`) | `NEUTRAL`, authoritative — local `c29-35b`, n=3, measured alone (`MICRO_GATE` off) for causal cleanliness | Win a discriminating round by 2026-09-03 or retire | Anti-shortcut steer; needs a fixture with real corner-cutting temptation to ever separate from baseline |
| **c30-context-brief** (`context-brief`) | `NEUTRAL`, authoritative — local `c30-35b`, n=3 | Win a discriminating round by 2026-09-03 or retire | Environment-brief injection; the discovery-turns-saved it predicts need a task with real exploration cost to show up |
| **c31-plan-uncertainty** (`plan-uncertainty`) | `NEUTRAL` but **confounded** — both existing rounds ran before the `plan_write` tool-grant fix; the ledger names this round explicitly as superseded by a required post-fix re-run | Win a discriminating round by 2026-09-03 or retire (clock starts at the first clean post-fix round, not the confounded ones already on record) | `real_gate.sh` silently omitted `plan_write` from every gate session's `--tools` list, so the uncertainty-hold mechanism this candidate gates on never had a chance to fire; the `NEUTRAL` verdict on record isn't trustworthy as-is |
| **c31-c38-combo** (`c31-c38-combo`, investigation config) | Not an independent candidate — the config's own `prediction` text says so ("Investigation config, not a new independent candidate"); the round that used it is the one that surfaced the `plan_write` bug (confounded, superseded) | Retire once c31 and c38 each get a clean individual post-fix verdict — no separate timeframe needed | Diagnostic scaffold built to test whether forcing `plan_write` changes uncertainty-declaration rate; should not outlive the investigation it was built for |
| **c32-sha-guard** (`sha-guard`) | `NEUTRAL`, authoritative — local `c32-35b`, n=3 | Win a discriminating round by 2026-09-03 or retire | The config's own prediction already names its retirement condition: if fabricated-SHA frequency stays at 0 across rounds, "the guard documents a non-problem and should be dropped" — closest thing to a self-scheduled removal clause already on file |
| **c33-subagent-fork-default** (`subagent-fork-default`) | `NEUTRAL` (local `c33-35b`, n=3) — **but already carries a standing removal recommendation, distinct from every other row here** | No timeframe — already recommended for removal now | `HARNESS_SELF_IMPROVEMENT.md` states this candidate "is now in direct philosophical tension with the c36/c37 pivot below" and "should almost certainly be dropped from the active queue rather than measured," since defaulting delegation to `fork` runs directly opposite to c36/c37's deliberate spawn-by-default, self-contained-task direction. It was run anyway ("cheap to include, and the data costs nothing to have") but the ledger's own text is the removal recommendation — kept on disk only as a recorded idea for possible separate re-litigation later, on its own terms, not as an active candidate |
| **c34-plan-item-guidance** (`plan-item-guidance-v2`) | `NEUTRAL` — local `c34-35b`, n=3; ledger hedges this round as "arguably" confounded by the same `plan_write` gate-tool bug | Win a discriminating round by 2026-09-03 or retire (re-run recommended given the hedge) | Smallest, most carefully-reasoned diff in the ledger (one prose swap, external literature-backed); safe, but plan-runner-dependent enough that the `plan_write` bug casts some doubt on the round as measured |
| **c35-bash-output-guard** (`bash-output-guard`) | `NEUTRAL`, authoritative — local, n=9/arm, base=cand=89%; measured across four rounds/models total, mechanism never fired in any of them | Win a discriminating round by 2026-09-03 or retire | Safe, but literally unexercised — no session across any of the four rounds produced bash output anywhere near the 8000-char threshold, so its actual behavior when it fires remains unverified in the field |
| **c36-spawn-delegation** (`spawn-delegation`) | `NEUTRAL`, authoritative — local `c36-35b`, n=3; a real measurement (subagent tool grant confirmed present after the same-session tool-grant fix) | Win a discriminating round by 2026-09-03 or retire | Direct opposite of c33 by design and a core plank of the many-small-contexts pivot; hasn't yet shown a pass-rate or token win over the fork-mode default it replaces |
| **c37-plan-delegate-all** (`plan-delegate-all`) | `NEUTRAL`, 18/18 — the "strongest engagement signal" reading was **retracted 2026-07-23**: direct telemetry (`plan_runner_delegation: {blocked:0, delegated:0}`, 18/18) and zero `plan_write`/`subagent` calls in every session (pre- and post-fix alike) show the higher `bigdata` tool-call counts were more direct work, not delegation. Same structural gap as c25 — `state.phase==="executing"` is unreachable from `real_gate.sh`'s one-shot invocation | Not a timeframe candidate — same as c25, needs an activation-path redesign before it can be measured at all | Was believed best-positioned to win next; now known this candidate has literally never been tested — the compliance telemetry it needed was wired in, but the mechanism it measures cannot activate under the current harness invocation mode regardless |
| **c38-force-plan-write** (`force-plan-write`) | Not cleanly measured — its only real trial (inside the `c31-c38-combo` round) is the one that surfaced the `plan_write` tool-grant bug; the block now fails open when `plan_write` is unavailable (fixed same session), but no clean post-fix round exists yet | Win a discriminating round by 2026-09-03 or retire | The one trial on record produced 88–131K-char sessions retry-looping a block with no escape hatch (76 of 102 tool calls in one rep) — a harness bug, not a verdict on the mechanism; needs a first honest measurement before it can be judged at all |

## Summary of statuses

- **1 standing removal recommendation** (c33 — already-opposed, no timeframe needed)
- **1 never measured** (c25-harness-off)
- **2 structurally unmeasurable as designed**, not a timeframe problem (c25-plan-subagent-only,
  c37-plan-delegate-all) — confirmed 2026-07-23 that `state.phase==="executing"` is unreachable
  from `real_gate.sh`'s one-shot invocation mode; need an activation-path redesign before "win a
  round" is even possible
- **3 confounded / need a clean post-fix re-run** before their existing `NEUTRAL` can be trusted (c31-plan-uncertainty, c34-plan-item-guidance, c38-force-plan-write), plus the investigation scaffold that exposed the bug (c31-c38-combo, which should simply retire once those three resolve)
- **8 authoritative `NEUTRAL`** results (c26, c27, c28, c29, c30, c32, c35, c36) — safe, do-no-harm-clean, none yet a proven win

## This is a recommendation only

No dark-candidate configuration, schema.json threshold, or code path has been deleted, disabled,
or modified in producing this document. Every removal criterion above is a proposal for Albert's
review, not an executed action — per this codebase's standing rule that adoption and deletion of
any dark candidate are always human-gated. Any actual removal of a flag, its config file, its
`schema.json` entry, or its telemetry registration requires Albert's explicit sign-off.
