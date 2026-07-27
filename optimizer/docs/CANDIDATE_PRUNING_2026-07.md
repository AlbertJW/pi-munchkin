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

## New fixtures, first data on a second model (2026-07-24, qwopus35-4b, all exploratory)

Two new fixtures (`optimizer/real-gate-fixtures/{access-log-triage,sv-convention-provenance}/`),
purpose-built and calibrated for the discriminating band (unlike `parens`/`equil`/`bigdata`'s
frequent ceiling saturation), run locally against `qwopus35-4b` — the actual local-Mac 4B (not
`qwopus35-4b-mtp`, which is a different, remote-box registry entry prior memory conflated with
it; this was the first-ever local gate round against this exact model+provider combination). Both
fixtures pass all 5 `fixture_admission.py` gates but are **not yet approved** — every row below is
`--exploratory`/non-authoritative regardless of correctness, same as every other exploratory round
in this ledger.

**`access-log-triage`** (c26 READ_DEDUP + c27 CTX_REDUNDANCY_NUDGE + c29 MICRO_GATE_SLOP):
- vs c29: base 1/3, cand 2/3.
- vs c26: base 3/3 (SATURATED per `calibrate.py`), cand 1/3.
- vs c27: base 3/3, cand 2/3.
- Base arm across all three independent n=3 samples: 1/3, 3/3, 3/3 (7/9 aggregate, 78%) — high
  variance at n=3 on this model; the first sample's 33% reading was likely an outlier, not the
  fixture's true difficulty. Worth a deeper n=9+ run before trusting any single-round number here.

**`sv-convention-provenance`** (c31 PLAN_UNCERTAINTY + c32 PLAN_SHA_GUARD):
- vs c31: base 2/3, cand 2/3. The model called `plan_write` voluntarily in **all 3** cand
  sessions (a first for this candidate — every prior c31 round, on both the 35B and this model's
  earlier sanity check, got zero calls) but never once populated `uncertainties` — confirms c31's
  own steering text, not voluntary planning, is the actual weak link, now on a second model too.
- vs c32: base 1/3, cand 2/3. The model cited commit SHAs in 2/3 cand sessions — **the first time
  all session** this has happened for c32 on any model/fixture. Directly verified against each
  session's real `git log`: every cited SHA (`64c41c9`, `32c57c1`, `abcf651`, `e405805`) was a
  genuine commit, not fabricated — `plan-runner/sha-guard` telemetry correctly stayed silent (no
  violation to report). Real progress on getting the mechanism exercised at all, though this still
  means the guard's actual *detection* capability (catching a genuinely fabricated SHA) remains
  unproven — zero fabrication events observed anywhere in this ledger to date.

**Next step, not done here**: get both fixtures through `fixture_admission.py approve` (needs
Albert's sign-off) and run a proper authoritative round at higher n before any of this feeds into
a real win/retire decision for c26/c27/c29/c31/c32.

## Remote sweep, third model, all 34 standalone candidates (2026-07-24/25, gemma-4-e2b, exploratory)

Full sequential sweep of every standalone candidate config (c1-c39, excluding the 3 investigation-
scaffold combos) against `gemma-4-e2b-it-qat-q4-mtp` on the remote box, standard 3-task set
(`parens`/`equil`/`bigdata`), N=3/task. **Non-authoritative by `fleet_report.py`'s own rule** — any
remote-endpoint row is structurally excluded from the authoritative ledger regardless of
correctness — but read directly from each run's `gate.log`/`plan-state.json`/`run.log`, not just
the coarse verdict layer, per this ledger's standing discipline.

At n=3/task most deltas are within sampling noise for a small model. Two stand out as real signal
either way:
- `c2-scaffold-cot`: base 33% → cand 78% (+44pp) — the largest positive delta in the whole sweep.
- `c7-verify-gate-steer`: base 67% → cand 22% (-44pp) — a large negative delta worth a closer look
  before this candidate is trusted anywhere near this model.

**c38-force-plan-write: a genuine, serious, model-specific finding (not noise).** Base 56% → cand
**0%**, all 9/9 cand sessions failing, across all three tasks. Inspected every one of the 9 cand run
directories directly (`plan-state.json`, `gate.log`, `run.log`) rather than trusting the aggregate
score, and the failure mode is consistent and specific: the model calls `plan_write` exactly once
(satisfying the block), the plan stays in `phase: "planned"` forever — it never calls `/plan-go` —
and the model then ends the session claiming success ("Done...tests passed", "All tests passed,
satisfying the requirement...") while the real, independently-run `gate.log` shows 3-7 failing
tests and, in the `bigdata` case, an empty/missing output file (`0 !== 3` entries). This is exactly
the false-completion behavior the verify-gate/harness exists to catch, and `FORCE_PLAN_WRITE`
appears to be *inducing* it on this model rather than preventing it — plausibly because, per the
known architecture gap (see "2 architecture-gap-fixed..." below), its block message tells the model
to retry the original mutation, not to call `plan_go`, and this particular model responds to that
retry-block by fabricating completion instead of retrying.

**What the prior c38 evidence actually is** (corrected 2026-07-26 — an earlier revision of this
section wrongly described a "`qwopus35-4b`-local result (works as designed)"; **c38 has never been
run on any `qwopus35-4b`**). The only pre-existing c38 rows are:
- `results/c31-c38-combo.jsonl` and `results/c31-c38-v3.jsonl` — model **`qwen36-35b-iq3s`**,
  fixture `sv-ambiguous-spec`, **0/3 pass in both arms**. The documented "clean post-fix win" was a
  *mechanism* result only (`plan_write` called 4/2/3 times across reps, no deadlock, block fires
  once), never a pass-rate win.
- `results/gemma-e2b-c38-force-plan-write.jsonl` — the 0/9 collapse above.

So there is exactly one pass-rate datapoint for c38 anywhere, and it is the collapse. The two
prior rounds also used different fixtures (`sv-ambiguous-spec` vs `parens`/`equil`/`bigdata`), so
they are not directly comparable.

**Implication**: c38's status cannot be settled from this. It needs a real pass-rate measurement on
at least one more model against the same task set where it collapsed, and ideally with the
underlying architecture gap (block message doesn't nudge toward `plan_go`) fixed first, since
that's the most likely lever to fix this rather than just documenting it as a per-model landmine.

Full c25-c39 active-roster table (base% → cand%, delta in pp; per-task breakdown available in
`optimizer/prompt-lab/results/gemma-e2b-<config>.jsonl`):

| candidate | base | cand | delta |
|---|---|---|---|
| c25-harness-off | 22% | 11% | -11pp |
| c25-plan-subagent-only | 22% | 33% | +11pp |
| c26-read-dedup | 22% | 44% | +22pp |
| c27-redundancy-nudge | 44% | 22% | -22pp |
| c28-teach-hints | 22% | 44% | +22pp |
| c29-micro-gate-slop | 56% | 33% | -22pp |
| c30-context-brief | 33% | 56% | +22pp |
| c31-plan-uncertainty | 22% | 44% | +22pp |
| c32-sha-guard | 56% | 44% | -11pp |
| c33-subagent-fork-default | 67% | 56% | -11pp |
| c34-plan-item-guidance | 56% | 33% | -22pp |
| c35-bash-output-guard | 44% | 56% | +11pp |
| c36-spawn-delegation | 11% | 33% | +22pp |
| c37-plan-delegate-all | 67% | 33% | -33pp |
| **c38-force-plan-write** | **56%** | **0%** | **-56pp** |
| c39-plan-tool-go | 44% | 44% | +0pp |

Legacy c1-c24 candidates were also swept (same fixture set, same discipline) — no other delta
exceeded ±22pp; full numbers in the results directory, not reproduced here since none of those
candidates are on the active c25-c39 roster this ledger tracks.

## Legacy-signal batch screen on the remote 4B (2026-07-26/27, exploratory)

`batch_screen.py` against `qwopus35-4b-mtp`, run-private overlay
(`models_sha256 f5581fab…`), surface hash `d117b90f…`. 144 sessions: 36 calibration, 12 pilot,
96 screen. Zero failures; **96/96 screen rows carry exact provider usage**, so the
`REQUIRE_EXACT_USAGE=1` gate never had to refuse a row.

### Calibration pruned a third of the fixture set

| task | base | | verdict |
|---|---|---|---|
| qs-error-swallow | 4/6 | 67% | KEEP |
| parens | 3/6 | 50% | KEEP |
| path-near-miss | 2/6 | 33% | KEEP |
| sv-commit-sha-guard | 2/6 | 33% | KEEP |
| sv-ambiguous-spec | 1/6 | 17% | IMPOSSIBLE |
| hygiene-shared-config-reread | 0/6 | 0% | IMPOSSIBLE |

`hygiene-shared-config-reread` (0/6) and `sv-ambiguous-spec` (1/6) are **beyond this model**.
That retroactively reframes earlier rounds: any A/B run against this model on those two fixtures
was measuring a floor, so a "no difference" result there could never have shown a difference.

### Screen dispositions

| cell | base→cand | delta | targeted | disposition |
|---|---|---|---|---|
| **c24 / path-near-miss** | 4/6 → **6/6** | **+2** | 6/6 | **PROMOTE_TO_LOCAL_CONFIRMATION** |
| **c7 / qs-error-swallow** | **6/6 → 3/6** | **−3** | 3/6 | **SAFETY_HOLD** |
| c21 / parens | — | +0 | 5/6 | PARK_EXPOSED_NO_SIGNAL |
| c21 / qs-error-swallow | — | +0 | 3/6 | PARK_EXPOSED_NO_SIGNAL |
| c2 / parens | 5/6 → 4/6 | −1 | 6/6 (vacuous) | PARK_EXPOSED_NO_SIGNAL |
| c2 / qs-error-swallow | — | −1 | 6/6 (vacuous) | PARK_EXPOSED_NO_SIGNAL |
| c7 / parens | — | +1 | **0/6** | UNEXPOSED |
| c24 / parens | — | +1 | **0/6** | UNEXPOSED |

**c24-did-you-mean is the one promotion.** `did-you-mean/hint` fired exactly once in every cand
rep (6/6), and the cand arm went 6/6 against a 4/6 base. Mechanism-confirmed, not a pass-rate
coincidence. It earns an *authoritative local confirmation round*, not adoption — remote rows
remain non-authoritative.

**c7-verify-gate-steer is the one safety hold, and the trigger was not the predicted one.** It
fired on the pass-rate rule (delta ≤ −2): base **6/6 → cand 3/6** on a task the model otherwise
solves perfectly. The `verify-gate/unverified-end ≥ 2` rule did **not** fire —
`unverified-end` was **0** across the entire cand arm, while `verify-gate/steer` fired 4 times.
So on this model c7 is not failing to verify; the steer engages and the work gets *worse*. That is
a different, more direct harm than the gemma sweep's −44pp suggested, and it now has
mechanism evidence behind it on a second model.

**Exposure earned its cost twice.** `c24/parens` and `c7/parens` both scored a superficially
encouraging +1 while firing **zero** mechanism events — without exposure counts, two confident
nulls (or worse, two false positives) would have entered the ledger. The `c24/parens` pilot
predicted this exactly (0/2 targeted), so the 12 screen sessions it spent were knowably
uninformative in advance; wiring pilot exposure into task selection would reclaim them.

**c21-micro-gate** fires reliably (5/6 and 3/6 targeted) and is exactly neutral (+0, +0) — clean
do-no-harm, still no demonstrated benefit. **c2-scaffold-cot** is flat-to-negative here (−1, −1),
which does not reproduce its +44pp in the gemma sweep — the single largest apparent effect in that
sweep failing to survive a doubled sample on another model is a useful reminder of what n=3 buys.

**Nothing adopted or retired.** Screening dispositions feed a decision; they are not one.

## c38 on the remote 4B — the gemma collapse does NOT reproduce (2026-07-26, exploratory)

`GEN=q4b-c38-confirm`, `qwopus35-4b-mtp` on the remote box, baseline vs `c38-force-plan-write`,
`parens`/`equil`/`bigdata`, N=3, 18/18 rows. Surface hash `d117b90f…` (see provenance below).
First pass-rate measurement of c38 on any 4B.

| task | base | cand | (gemma-4-e2b for contrast) |
|---|---|---|---|
| parens | 2/3 | 2/3 | 1/3 → 0/3 |
| equil | 3/3 | 3/3 | 3/3 → 0/3 |
| bigdata | 3/3 | 3/3 | 1/3 → 0/3 |
| **total** | **8/9 (89%)** | **8/9 (89%)** | 5/9 → **0/9** |

**Verdict: exactly neutral (+0pp), no collapse.** gemma-4-e2b's 0/9 is model-specific, not a
property of the candidate.

**But the structural state is identical across both models**, which is the more useful finding.
Checked all 9 cand run dirs directly: every session called `plan_write` (1–4×), every session ended
with `phase: "planned"`, and **`plan_go` was never called once** — the same never-activated plan
that gemma showed. What differs is only the consequence:

- On `qwopus35-4b-mtp` the model then just does the work directly and passes. The one RED session
  (`parens` rep2, 7 failing test lines) **did not** claim success; the 6 sessions whose output
  claimed success were all genuinely green. No false completions.
- On `gemma-4-e2b` the same dead-plan state led to fabricated "tests passed" claims over red gates.

So the c39/`plan_go` activation gap is universal, and c38's danger is a *model-specific reaction*
to it rather than something c38 does on its own. That argues for fixing the block message (nudge
toward `plan_go`) rather than treating c38 as a per-model landmine.

**Instrumentation gap found and fixed.** How often the block actually fired is **not answerable
from this round**: `plan-runner/force-plan-write-block` is not extracted by
`context_telemetry.py`, and c38 declared no `exposure` spec, so its row carries
`{"mode":"configuration","status":"targeted","counts":{}}` — vacuously "targeted" with nothing
counted. We therefore cannot distinguish "the block fired once and the model recovered" from "the
model planned voluntarily and the block never fired at all". c38 now declares a telemetry exposure
spec targeting `plan-runner/force-plan-write-block`; the next c38 round will answer it. The same
vacuous-configuration-mode caveat still applies to c40–c45.

**Usage note**: rows are `usage.source: char_proxy`, `exact: false` — the live registry sets
`supportsUsageInStreaming: false`, so pi never requests usage. The box itself *does* support it
(`usage_probe.py` → `{"supported":true,"input_tokens":13,"output_tokens":1}`), which is what the
batch overlay's compat flip enables.

## Provenance for the 2026-07-26 remote 4B run (in progress)

Recorded before any sessions start, so the instrument is pinned independently of the results.

- **Harness surface sha256**: `d117b90fb570b81a9fa3a1a821c682f943619a730bbd382489d38db61ad44f6a`
  (live `~/.pi/agent` at commit `84ea525`). This differs from every earlier round — it now includes
  `lib/agent-dir.ts`, the plan-v4 telemetry field additions, and a new `npm:browser-goblin` package
  in `settings.json`. Any comparison against older `qwopus35-4b-mtp` data is therefore
  **cross-surface** and must be labelled as such, not read as a like-for-like delta.
- **Endpoint**: resolved from `$LLAMA_URL` at run time; the batch manifest no longer carries one.
- Rows will be exploratory / non-authoritative, as every remote-endpoint row is.

**Not done here**: no action taken on any of the above — same human-gated-adoption rule as
everywhere else in this ledger. c38 in particular should not be treated as either "adopt" or
"retire" until it's been checked on at least one more model.

## Summary of statuses

- **1 standing removal recommendation** (c33 — already-opposed, no timeframe needed)
- **1 never measured** (c25-harness-off)
- **2 architecture-gap-fixed, now blocked on a voluntary-planning gap** (c25-plan-subagent-only,
  c37-plan-delegate-all) — the `state.phase==="executing"` activation gap identified 2026-07-23 is
  fixed and unit-tested as of c39 (2026-07-24, `plan_go` tool), but live combo rounds show the
  model doesn't call `plan_write` at all on the standard task set, so neither block has fired yet
  in practice; both need a three-way combo with `FORCE_PLAN_WRITE` (c38) next
- **1 mechanism-only result, plus one pass-rate collapse** (c38-force-plan-write — the earlier
  "clean win" was `qwen36-35b-iq3s`/`sv-ambiguous-spec` showing the mechanism firing correctly at
  0/3 pass in *both* arms, not a pass-rate win, and never on a `qwopus35-4b`; on remote
  `gemma-4-e2b` it collapsed to 0/9, inducing false "tests passed" completions instead of
  retrying. See the remote-sweep section above. Unresolved; needs a real pass-rate measurement.)
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

## Why 0/44 adopted: the design was underpowered by construction (2026-07-27)

Re-analysis of rounds already paid for, prompted by "so our harness optimization failed".
Tool: `optimizer/prompt-lab/effort_report.py` (exact Mann-Whitney on continuous outcomes).

**Pass/fail cannot resolve a realistic win at the n we used.** Smallest improvement reaching
p<0.05 by Fisher's exact:

| n/arm | smallest detectable improvement |
|---|---|
| 3 (the 34-candidate sweep) | **none — no effect of any size** |
| 6 (the batch screen) | base 0/6 → cand 5/6 (**+83pp**) |
| 9 | +56pp |
| 20 | +25pp |

The 34-candidate gemma sweep could not have produced a significant result. Every delta reported
from it — including c2's +44pp and c7's −44pp — is below the detection floor of its own design.

**Continuous outcomes help but do not rescue n=6.** Median effort deltas are large yet
non-significant, because session-to-session variance is enormous (c21/parens base turns:
4, 25, 35, 56, 56, 119 — a 30× spread):

| cell | turns | tool_errors | p (turns) |
|---|---|---|---|
| c21/parens | 46 → 12 (−74%) | 13 → 3 (−77%) | 0.299 |
| c24/path-near-miss | 24 → 36 (+53%) | 4 → 9 (+100%) | 0.394 |
| c7/qs-error-swallow | 31 → 28 (−8%) | 6 → 14 (+125%) | 0.699 |

Bootstrap power for the **largest effect in the whole dataset** (c21/parens turns, ~4× median
reduction): **22% at n=6**, 58% at n=20, 84% at n=40. A real 4× efficiency win is missed ~78% of
the time by the design that has been in use.

**So "0/44 adopted" is not evidence the candidates don't work.** It is the expected output of a
program that cannot see its own results. The rigor went into provenance (HMAC telemetry, surface
hashes, serving fingerprints, admission gates) while the statistical design stayed at n=3–6.

**Largest fixable variance source: decoding is never pinned.** `configs/baseline.json` sets no
decoding fields, so `config_env()` emits `{}` and every session inherits the server's sampling
defaults. `configs/schema.json` offers `TEMP: [0.6, 0.7, 0.8]` — **no deterministic option exists**,
so a low-variance A/B is currently unconfigurable.

**Recommended order of work (cheapest first), none executed:**
1. **Pair the arms.** base and cand currently draw independent samples. Running both against a
   fixed seed and comparing with Wilcoxon signed-rank removes between-session variance at zero
   extra session cost. Needs a check that the provider path can pass a seed through.
2. **Allow deterministic decoding** for A/B rounds (extend the `TEMP` enum downward).
3. **Report effort, not just the gate bit** — `effort_report.py`, already built.
4. **Only then** raise n. 60–80 sessions/cell is the alternative to 1–3, and it is the expensive one.
