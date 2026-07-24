# Candidate Pruning List — 2026-07

Draft removal recommendations for the dark-candidate roster under
`optimizer/prompt-lab/configs/static/`. Companion to `optimizer/docs/HARNESS_SELF_IMPROVEMENT.md`
(the full ledger — every status claim below is sourced from it) and Tier 1 item #5 of
`UPGRADE_MAP.md` ("Audit #11: 14 dark flags now exist... draft a removal list with per-candidate
removal criteria").

**This document recommends; it does not act.** See the closing statement.

## Scope and roster

`ls optimizer/prompt-lab/configs/static/` was walked in full. In the c25–c39 numbering range,
**19 files** exist on disk (three numbers are doubled: `c25` covers two unrelated candidates,
`c31` covers both the standalone plan-uncertainty candidate and a later combo/investigation
config, and `c39` covers the standalone tool plus two combo/investigation configs pairing it
with c25 and c37):

```
c25-harness-off.json          c31-c38-combo.json             c36-spawn-delegation.json
c25-plan-subagent-only.json   c32-sha-guard.json              c37-plan-delegate-all.json
c25-c39-combo.json            c33-subagent-fork-default.json  c38-force-plan-write.json
c26-read-dedup.json           c34-plan-item-guidance.json     c39-plan-tool-go.json
c27-redundancy-nudge.json     c35-bash-output-guard.json      c37-c39-combo.json
c28-teach-hints.json
c29-micro-gate-slop.json
c30-context-brief.json
c31-plan-uncertainty.json
```

(The earlier c1–c24 batch and the governor `.md`/`span-screen-on.json` files also live in this
directory but are out of scope here — this list covers only the round-5+ delegation/hygiene
ledger, i.e. what the 2026-07-23 UPGRADE_MAP item and the 2026-07-24 c39 activation-path work
actually asked for.)

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
| **c25-harness-off** (`harness-off`, U3b loop-breaker/verify-gate-off control arm) | `NEUTRAL`, its first-ever round (`c25-harness-off-first`, 2026-07-24) — 18/18 on the standard task set, base=cand=100% | Win a discriminating round by 2026-09-03 or retire | Meant to quantify the steering layer's actual ROI (the "harness_roi denominator"); now has a real data point, but `parens`/`equil`/`bigdata` are too easy to show the harness-off delta this control arm is meant to expose |
| **c25-plan-subagent-only** (`plan-subagent-only`, mandatory edit delegation) | `NEUTRAL`, 18/18 across three rounds now (pre-fix, post-tool-grant-fix, and post-c39 `plan_go` activation-path fix, `c25-c39-combo`, 2026-07-24). The activation-path gap is **fixed and unit-tested** (see c39 below) — but the live round still shows **zero** `plan_write` calls in all 9 cand-arm sessions, so the block never got a chance to fire, for the same reason c31 needed c38: this model doesn't plan voluntarily on `parens`/`equil`/`bigdata` | Needs a three-way combo with `FORCE_PLAN_WRITE` (c38) to force planning before c25 can show any real signal — the c31/c38 precedent exactly. Not yet built; a natural next-session item | Activation-path history: see `HARNESS_SELF_IMPROVEMENT.md`'s c37 correction (2026-07-23) and the c39 entry (2026-07-24) |
| **c25-c39-combo** (`c25-c39-combo`, investigation config) | Not an independent candidate — the config's own `prediction` text says so, mirroring `c31-c38-combo`'s framing. The round that used it (`c25-c39-combo`, 2026-07-24) is the one that confirmed the activation-path fix is safe (18/18) but found zero `plan_write` calls in all 9 cand-arm sessions | Retire once c25 gets a clean verdict via the three-way combo with `FORCE_PLAN_WRITE` — no separate timeframe needed | ANDs `PLAN_SUBAGENT_ONLY` with `PLAN_TOOL_GO`; superseded by whatever three-way combo config eventually resolves c25 |
| **c26-read-dedup** (`read-dedup`) | `NEUTRAL`, authoritative — local `c26-35b`, n=3 (supersedes the earlier remote `INCOMPLETE` 17/18). First round against its dedicated `hygiene-shared-config-reread` fixture (`c26-hygiene`, 2026-07-24): base=cand=0/3 — task is genuinely hard for this model, floor effect, no discrimination possible at this n | Win a discriminating round by 2026-09-03 or retire | Purely transient per-call-view dedup; the hygiene fixture didn't help — the failures are correctness misses (broken solutions), not something read-dedup could affect either way |
| **c27-redundancy-nudge** (`redundancy-nudge`) | `NEUTRAL`, authoritative — local `c27-35b`, n=3 (supersedes remote `INCOMPLETE` 15/18). First round against `hygiene-shared-config-reread` (`c27-hygiene`, 2026-07-24): base 0/3, cand 2/3 (**+67% raw delta**, the most promising signal from this fixture batch) — but `fleet_report.py`'s significance test still calls it `neutral` at n=3 | Win a discriminating round by 2026-09-03 or retire | Steer-only nudge toward `compact_context`; the raw delta is worth a deeper n=9+ follow-up before drawing any conclusion, positive or negative — not yet a win by the doc's own significance bar |
| **c28-teach-hints** (`teach-hints`) | `NEUTRAL`, authoritative — local, N=6 (36 sessions); base 100% vs cand 89%, sole miss a known serving-config artifact (malformed pseudo-tool-call), not a regression | Win a discriminating round by 2026-09-03 or retire | First round to break the three-in-a-row remote `INCOMPLETE` streak; safe but not yet a demonstrated win |
| **c29-micro-gate-slop** (`micro-gate-slop`) | `NEUTRAL`, authoritative — local `c29-35b`, n=3, measured alone (`MICRO_GATE` off) for causal cleanliness. First round against its dedicated `qs-error-swallow` fixture (`c29-qs-error`, 2026-07-24): base=cand=3/3, clean pass both arms | Win a discriminating round by 2026-09-03 or retire | Anti-shortcut steer; `qs-error-swallow` didn't surface any corner-cutting temptation this round — still needs a task that actually tempts a shortcut to ever separate from baseline |
| **c30-context-brief** (`context-brief`) | `NEUTRAL`, authoritative — local `c30-35b`, n=3. First round against `hygiene-shared-config-reread` (`c30-hygiene`, 2026-07-24): base 1/3, cand 0/3 (-33% raw, `neutral` by significance) | Win a discriminating round by 2026-09-03 or retire | Environment-brief injection; across all three candidates run against this fixture (c26, c27, c30) the raw deltas point in different directions with no consistent pattern — noisy at n=3 on a genuinely hard task, not read as a real regression |
| **c31-plan-uncertainty** (`plan-uncertainty`) | `NEUTRAL` but **confounded** — both existing rounds ran before the `plan_write` tool-grant fix; the ledger names this round explicitly as superseded by a required post-fix re-run | Win a discriminating round by 2026-09-03 or retire (clock starts at the first clean post-fix round, not the confounded ones already on record) | `real_gate.sh` silently omitted `plan_write` from every gate session's `--tools` list, so the uncertainty-hold mechanism this candidate gates on never had a chance to fire; the `NEUTRAL` verdict on record isn't trustworthy as-is |
| **c31-c38-combo** (`c31-c38-combo`, investigation config) | Not an independent candidate — the config's own `prediction` text says so ("Investigation config, not a new independent candidate"); the round that used it is the one that surfaced the `plan_write` bug (confounded, superseded) | Retire once c31 and c38 each get a clean individual post-fix verdict — no separate timeframe needed | Diagnostic scaffold built to test whether forcing `plan_write` changes uncertainty-declaration rate; should not outlive the investigation it was built for |
| **c32-sha-guard** (`sha-guard`) | `NEUTRAL`, authoritative — local `c32-35b`, n=3. First round against its own dedicated `sv-commit-sha-guard` fixture (`c32-sv-sha`, 2026-07-24): base 3/3, cand 2/3 (-33% raw, `neutral`); the one cand miss is an unrelated assertion failure (`3 !== 4`), and `plan-runner/sha-guard` telemetry never fired across any of the 3 cand sessions — zero fabricated SHAs, same as every prior round | Win a discriminating round by 2026-09-03 or retire | The config's own prediction already names its retirement condition: if fabricated-SHA frequency stays at 0 across rounds, "the guard documents a non-problem and should be dropped" — now confirmed 0 on its own dedicated fixture too, the strongest case yet for the self-scheduled removal clause |
| **c33-subagent-fork-default** (`subagent-fork-default`) | `NEUTRAL` (local `c33-35b`, n=3) — **but already carries a standing removal recommendation, distinct from every other row here** | No timeframe — already recommended for removal now | `HARNESS_SELF_IMPROVEMENT.md` states this candidate "is now in direct philosophical tension with the c36/c37 pivot below" and "should almost certainly be dropped from the active queue rather than measured," since defaulting delegation to `fork` runs directly opposite to c36/c37's deliberate spawn-by-default, self-contained-task direction. It was run anyway ("cheap to include, and the data costs nothing to have") but the ledger's own text is the removal recommendation — kept on disk only as a recorded idea for possible separate re-litigation later, on its own terms, not as an active candidate |
| **c34-plan-item-guidance** (`plan-item-guidance-v2`) | `NEUTRAL` — local `c34-35b`, n=3; ledger hedges this round as "arguably" confounded by the same `plan_write` gate-tool bug | Win a discriminating round by 2026-09-03 or retire (re-run recommended given the hedge) | Smallest, most carefully-reasoned diff in the ledger (one prose swap, external literature-backed); safe, but plan-runner-dependent enough that the `plan_write` bug casts some doubt on the round as measured |
| **c35-bash-output-guard** (`bash-output-guard`) | `NEUTRAL`, authoritative — local, n=9/arm, base=cand=89%; measured across four rounds/models total, mechanism never fired in any of them | Win a discriminating round by 2026-09-03 or retire | Safe, but literally unexercised — no session across any of the four rounds produced bash output anywhere near the 8000-char threshold, so its actual behavior when it fires remains unverified in the field |
| **c36-spawn-delegation** (`spawn-delegation`) | `NEUTRAL`, authoritative — local `c36-35b`, n=3; a real measurement (subagent tool grant confirmed present after the same-session tool-grant fix) | Win a discriminating round by 2026-09-03 or retire | Direct opposite of c33 by design and a core plank of the many-small-contexts pivot; hasn't yet shown a pass-rate or token win over the fork-mode default it replaces |
| **c37-plan-delegate-all** (`plan-delegate-all`) | `NEUTRAL`, 18/18 across three rounds (pre-fix, post-tool-grant-fix, and post-c39 `c37-c39-combo`, 2026-07-24) — the earlier "strongest engagement signal" reading was **retracted 2026-07-23** (higher `bigdata` tool-call counts were direct work, not delegation). The c39 round confirms the activation path itself is now fixed and unit-tested, but shows the identical zero-`plan_write` result as c25's combo — same root cause, same fix needed | Same as c25: needs a three-way combo with `FORCE_PLAN_WRITE` (c38) before it can show any real signal | Was believed best-positioned to win next; still untested in practice, but for a now well-understood and fixable reason (voluntary-planning gap, not architecture) rather than an unfixable one |
| **c37-c39-combo** (`c37-c39-combo`, investigation config) | Not an independent candidate — same framing as `c25-c39-combo`. The round that used it (`c37-c39-combo`, 2026-07-24) confirmed the activation-path fix is safe (17/18, one unrelated base-arm flake) but found zero `plan_write` calls in all 9 cand-arm sessions | Retire once c37 gets a clean verdict via the three-way combo with `FORCE_PLAN_WRITE` — no separate timeframe needed | ANDs `PLAN_DELEGATE_ALL` with `PLAN_TOOL_GO`; superseded by whatever three-way combo config eventually resolves c37 |
| **c38-force-plan-write** (`force-plan-write`) | Cleanly measured post-fix (2026-07-23, `c31-c38-v3` combo): fully working — forces `plan_write` cleanly (4/2/3 successful calls across 3 reps, zero errors, zero retry-looping) | Win a discriminating round by 2026-09-03 or retire | Working as designed; c31's own steering text (not c38's forcing mechanism) is the actual weak link — see `HARNESS_SELF_IMPROVEMENT.md`. Also the natural next dependency for c25/c39 and c37/c39 (see those rows) |
| **c39-plan-tool-go** (`plan-tool-go`, new 2026-07-24) | `NEUTRAL`, 18/18 standalone (`c39-sanity`) — near behavior-neutral as its own prediction expected. Gives the model a `plan_go` **tool** to reach `phase==="executing"` itself, closing the architecture gap that made c25/c37 structurally unmeasurable under `real_gate.sh`'s one-shot `pi -p` invocation (no slash-command dispatch). The fix is proven correct end-to-end by a dedicated unit test (`plan-runner.integration.test.ts`, "plan_go unlocks PLAN_SUBAGENT_ONLY's block... pure tool-only session, no slash commands") — but live combo rounds (`c25-c39-combo`, `c37-c39-combo`) show zero `plan_write` calls, so the newly-open activation path was never exercised in practice on this task set | Win a discriminating round by 2026-09-03 or retire, but really gated on the c25/c37+c38 three-way combo actually getting built first | Standalone tool addition, dark by default (registration itself is the gate — zero surface when off); no engine-owned dispatch (model alone decides to call it) |

## First retirement dry-run: c33-subagent-fork-default (PROPOSED, awaiting sign-off)

Per `optimizer/docs/adr/0006-candidate-graduation-and-retirement-playbook.md`'s retirement
checklist, applied here as its first real exercise — no dark candidate registered in this doc's
roster has ever actually been retired, so this is deliberately the lowest-controversy candidate to
prove the mechanics on first. **Nothing below has been executed.** This is the exact, reviewable
diff — present for Albert's explicit sign-off before any of it lands.

1. **Delete** `optimizer/prompt-lab/configs/static/c33-subagent-fork-default.json` (the whole
   5-line file).
2. **Remove** the `"SUBAGENT_DEFAULT_MODE": ["spawn", "fork"]` entry from
   `optimizer/prompt-lab/configs/schema.json`'s `thresholds.fields` (currently lines 181-184).
3. **Collapse the gated branch** in `harness/vendor/pi-subagent/types.ts:14-21`'s
   `parseDelegationMode` — this file is core subagent infrastructure, not c33-dedicated, so only
   the `if (raw === undefined) { ... }` body changes, from:
   ```ts
   if (raw === undefined) {
     // Dark candidate c33 (SUBAGENT_DEFAULT_MODE=fork): ...
     return process.env.SUBAGENT_DEFAULT_MODE === "fork" ? "fork" : DEFAULT_DELEGATION_MODE;
   }
   ```
   to:
   ```ts
   if (raw === undefined) {
     return DEFAULT_DELEGATION_MODE;
   }
   ```
4. **Delete** the entire dedicated test at `harness/tests/subagent-hardening.test.ts:29-48`
   (`test("c33: SUBAGENT_DEFAULT_MODE=fork flips the default...")`) — every assertion in it exists
   solely to test the flag being removed in step 3.
5. **Update `README.md`**: remove the `SUBAGENT_DEFAULT_MODE=fork` row (currently line 161) from
   its dark-candidate table.
6. **Update this doc**: remove the c33 row from "The roster" table above and its count from
   "Summary of statuses" below, once the deletion actually lands.

No `optimizer/real_gate.sh` change needed — `SUBAGENT_DEFAULT_MODE` never appears in that file's
tool-grant logic. `harness/lib/telemetry-catalog.ts` needs no change either — c33 never emitted its
own telemetry kind.

## Summary of statuses

- **1 standing removal recommendation** (c33 — already-opposed, no timeframe needed)
- **1 never measured** (c25-harness-off)
- **2 architecture-gap-fixed, now blocked on a voluntary-planning gap** (c25-plan-subagent-only,
  c37-plan-delegate-all) — the `state.phase==="executing"` activation gap identified 2026-07-23 is
  fixed and unit-tested as of c39 (2026-07-24, `plan_go` tool), but live combo rounds show the
  model doesn't call `plan_write` at all on the standard task set, so neither block has fired yet
  in practice; both need a three-way combo with `FORCE_PLAN_WRITE` (c38) next
- **1 clean post-fix win, newly measured** (c38-force-plan-write — works as designed)
- **1 new standalone candidate, near-neutral by its own prediction** (c39-plan-tool-go)
- **2 confounded / need a clean post-fix re-run** before their existing `NEUTRAL` can be trusted (c31-plan-uncertainty, c34-plan-item-guidance), plus the investigation scaffold that exposed the bug (c31-c38-combo, which should simply retire once those resolve)
- **3 investigation scaffolds**, not independent candidates (c31-c38-combo, c25-c39-combo, c37-c39-combo) — each retires once the candidate it was built to unblock gets a clean verdict
- **8 authoritative `NEUTRAL`** results (c26, c27, c28, c29, c30, c32, c35, c36) — safe, do-no-harm-clean, none yet a proven win

## This is a recommendation only

No dark-candidate configuration, schema.json threshold, or code path has been deleted, disabled,
or modified in producing this document. Every removal criterion above is a proposal for Albert's
review, not an executed action — per this codebase's standing rule that adoption and deletion of
any dark candidate are always human-gated. Any actual removal of a flag, its config file, its
`schema.json` entry, or its telemetry registration requires Albert's explicit sign-off.
