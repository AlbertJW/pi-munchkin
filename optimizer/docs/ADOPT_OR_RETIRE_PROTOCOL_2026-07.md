# Adopt-or-retire protocol for the dark-candidate roster

> **HISTORICAL / UNSUPPORTED:** Recorded `NEUTRAL` labels predating 2026-07-27 are preserved as
> historical data; their current interpretation is **UNTESTED**, not evidence of no effect.

Goal: reach a **defensible adopt or retire decision on every candidate**, at a cost that is
actually payable. Written after the 2026-07-27 audit found that of 45 candidates, exactly **one**
(c21) had ever been decisively tested.

> **AMENDED 2026-07-31.** Two corrections to the arithmetic this protocol is built on.
> (1) The roster is now **36 static configs**, not 45 — nine were deleted (`6192559`, `166e94d`),
> and five of those nine (`c1`/`c5`/`c8`/`c9`/`c15`) were **structurally inert**: their cand arm
> rendered byte-identically to base with an empty env, so they could never have been adopted or
> retired on evidence. Exposure census is now 24 telemetry / 9 configuration / 2 suppression /
> 1 none, so the "S1 covers 30" arithmetic below no longer matches disk.
> (2) More seriously — the S1/S2 ladder assumes a round can return a positive result. At the
> sample sizes it prescribes it cannot: at n=9/arm from base 5/9, only a flawless 9/9 reaches
> one-sided p<0.05 (two-sided: nothing), while regressions from a ceiling ARE detectable.
> **Read `CANDIDATE_STRATEGY_2026-07-31.md` §1 before costing any round against this protocol.**

## Why the obvious plan doesn't work

A flat sweep at the sample size the power analysis demands:

| design | sessions | wall-clock (4.1 min/session, single-slot) |
|---|---|---|
| 45 × n=20/arm | 1,800 | **123 h — 5.1 days** |
| 45 × n=40/arm | 3,600 | 246 h — 10.2 days |

And n=20 on pass/fail still only detects **+25pp**, so most of that spend would buy 45 more
uninterpretable nulls. Paying more for the same mistake is not a plan.

## The asymmetry that makes it affordable

**Adoption needs statistical power. Retirement usually doesn't.**

A mechanism that never fires on a fixture purpose-built to trigger it is retireable on six
sessions with no statistics at all. Most of the roster can be resolved this way, so the protocol
is a funnel that spends power only where a candidate has already earned it.

| stage | candidates | sessions | hours |
|---|---|---|---|
| S1 firing probe (cand arm only, n=6) | ~40 | 240 | 16 |
| S2 effort screen (n=12/arm) | ~20 | 480 | 33 |
| S3 confirmation (n=30/arm) | ~5 | 300 | 20 |
| **total** | | **~1,020** | **~70 h** |

Same order of cost as the flat sweep, but it ends in decisions rather than nulls.

## Stage 0 — free, no box time

1. **Add an `exposure` spec to the 40 candidates that lack one.** Today 40/45 cannot prove they
   fired, so "NEUTRAL" is indistinguishable from "never engaged". Config-only, zero sessions.
   **This gates everything else** — S1 is unreadable without it.
2. **Retire 5 without testing** (no round can inform them):
   - `c43-plan-plannotator-bridge` — interactive-only; `real_gate.sh` refuses it by design. Not
     measurable in this harness at any n. Retire here or move to a different venue.
   - `c25-c39-combo`, `c31-c38-combo`, `c37-c39-combo` — investigation scaffolds, not independent
     candidates by their own config text. Retire when their parent resolves.
   - `c33-subagent-fork-default` — standing retirement recommendation, philosophically opposed to
     the c36 spawn direction.
3. **Reclassify `c25-harness-off`** as a permanent control instrument, not a candidate. It measures
   the harness's own ROI; it is never adopted or retired.

## Stage 1 — firing probe (the cheap kill)

Per candidate: **n=6, candidate arm only**, on a fixture chosen to trigger its mechanism. No base
arm — the question is not "does it help" but "does it do anything".

**Pre-registered rule:**
- `target_count ≥ 1` in ≥2 of 6 sessions → **advance to S2**.
- fires in exactly 1 of 6 → one retry on a better-matched fixture, then decide.
- `0/6` **and** no fixture in the suite could plausibly trigger it → **RETIRE: unreachable.**
- `0/6` **but** a suitable fixture is missing → **PARK: needs fixture**, and name the fixture. Not
  a verdict on the candidate.

This immediately resolves the 4 structurally-dead candidates (`c25-plan-subagent-only`,
`c36-spawn-delegation`, `c37-plan-delegate-all`, `c38-force-plan-write`): delegation needs
`phase:"executing"`, which no headless session reaches, so they are unreachable **until** the
`plan_go` activation path is on. Run them with `PLAN_TOOL_GO=on` or retire them as
interactive-only.

## Stage 2 — effort screen

Per surviving candidate: **n=12/arm**, one eligible task (30–70% calibration band), scored with
`effort_report.py` on turns, tool_calls, tool_errors, repeat_calls, tool_result_chars and tokens.

**Filter on direction-consistency, not p.** At n=12 power for a c21-sized effect is ~40%, which is
too low to confirm but ample to eliminate. Consistency across 7 metrics is robust where a single
p-value is not.

**Pre-registered rule:**
- ≥5 of 7 metrics better **and** pass rate not down by >1/12 → **advance to S3**.
- ≤2 of 7 better → **RETIRE: no effect**.
- pass rate down ≥2/12, or ≥5 of 7 metrics worse → **RETIRE: harmful**.
- anything else → **PARK: inconclusive**, revisit only if a cheaper mechanism appears.

## Stage 3 — confirmation

Per finalist: **n=30/arm on two tasks** (60 sessions), effort primary, pass rate as a do-no-harm
guard. 73% power for a c21-sized effect.

**Pre-registered rule:** adopt only if effort improves with ≥5/7 metrics agreeing **on both
tasks**, pass rate is non-inferior, and the mechanism fired in ≥50% of cand sessions. Otherwise
PARK. **Adoption remains a human decision** — this produces the evidence, not the verdict.

## Non-negotiables

- **Pre-register before running.** We have already run a 650-comparison sweep; the shortlist it
  produced is hypothesis-generating only. Rules above are fixed in advance precisely so S2/S3
  results are not another exercise in picking winners after the fact.
- **No sampling-parameter changes.** Decoding stays as it is. Variance is handled by sample size
  and by scoring effort instead of a single gate bit.
- **Single-slot discipline.** One round per box at a time.
- **Fixture honesty.** Don't judge a candidate on a fixture that floors or ceilings for the model.
  **The two this rule used to name are void and must not be re-cited** (`MEASUREMENT_METHODOLOGY`
  §9 and §14): `hygiene-shared-config-reread` 0/6 was the gate failing to copy `config/`, not the
  model failing the task, and `sv-ambiguous-spec` 1/6 predates the v3 rebuild (`f6318c4`). Both
  are **uncalibrated**, not floors.
- **Every round scored on effort, not just pass/fail.** The gate bit is one bit per session and is
  what hid c21 for weeks.

## Expected outcome

Rough shape based on what the audit already shows: ~5 retired without testing, ~15–20 retired at
S1 as unreachable or fixture-blocked, ~10–15 retired at S2 as no-effect, and 2–5 reaching S3. c21
is already through S3 in all but name.

The honest headline is that the roster is a backlog of **untested** ideas, not rejected ones — so
this protocol is expected to produce far more retirements than the evidence has so far justified,
and possibly two or three genuine adoptions.

## Appendix — c21 as the worked example (completed 2026-07-27)

`q4b-c21-effort`, n=20/arm on `parens`, `qwopus35-4b-mtp`, 40/40 rows with exact usage.

| metric | base | cand | change | p |
|---|---|---|---|---|
| turns | 19 | 14 | −26% | **0.030** |
| tool_calls | 18 | 13 | −26% | **0.023** |
| tool_errors | 6 | 2 | **−64%** | **0.014** |
| repeat_calls | 4 | 1 | **−75%** | **0.001** |
| tool_result_chars | 6,938 | 4,127 | −41% | **0.024** |
| output_tokens | 6,199 | 3,692 | −40% | 0.229 |
| input_tokens | 17,782 | 16,908 | −5% | 0.409 |

Pass rate: base 15/20, cand 13/20. `micro-gate/fired` 50× across 14/20 cand sessions.

**7/7 metrics move the better way; 5 reach p<0.05.** Restricted to passing sessions only (removing
the failed-run length confound) the direction holds on all seven and `repeat_calls` stays
significant at p=0.007, though the smaller n costs the rest their significance — which is expected,
not a contradiction.

This is what an S3 result looks like, and it also shows why the protocol scores effort: the same
sessions read **5/6 vs 5/6 on pass rate at the screen stage** and were filed
PARK_EXPOSED_NO_SIGNAL. The gate bit could not see a 64% reduction in tool errors.

**Caveat carried forward:** pass rate is nominally down 2/20 (15→13). Well inside noise at this n
(Fisher's floor here is +25pp), but it is the one thing S3's do-no-harm guard exists to catch, so
c21 needs its second task before adoption — exactly as the protocol requires. It is not yet a
finished decision. **(Resolved below: the second task failed the bar. c21 stays dark.)**

## Stage 0 — EXECUTED 2026-07-27

**1. Exposure specs: done. All 45 candidates declared one** (as of 2026-07-27; on disk today it
is 35 of 36 — `span-screen-on.json` has none, correctly: it is a `span_screen.py` study arm,
not a `real_gate` candidate).

| | before | after |
|---|---|---|
| telemetry mode (firing observable) | 5 | **28** |
| configuration mode (firing NOT observable) | 0 | **17** |
| no exposure at all | 40 | **0** |

Specs were derived from the code, not guessed: every `record()`/`planEvent()`/`telemetry()`
emission was extracted per file and matched to the flag that guards it. Battery green
(`verify` + `verify:optimizer`), every config passes fail-closed `validate_config`, and every
declared event resolves against `telemetry-event-catalog.json`.

**The 17 configuration-mode candidates are an honest negative result, not an oversight.** No
dedicated firing event exists for them, so S1 cannot be run on them as specified:

- *prompt/governor variants* — c1, c5, c8, c9, c15, c19, c46, c47
- *wording-only threshold changes* — c14, c18, c18b, c33, c34, c36
- *mechanism-OFF arms* — c10-no-verify-gate, c25-harness-off. An absence cannot be observed as a
  firing; for these the correct S1 evidence is the **inverse** (the disabled event must drop to
  zero in the cand arm), which the current `status_for` logic does not express.

For all 17, `status: "targeted"` means **"config was applied"** and must never be read as
"mechanism fired". This is the same vacuousness previously flagged for c2 and c40–c45 — now
explicit in every affected config rather than implied by absence.

**2. Retirements: PROPOSED, not executed.** Deletion is human-gated, so nothing was removed.
Awaiting sign-off:

| candidate | ground |
|---|---|
| `c43-plan-plannotator-bridge` | interactive-only; `real_gate.sh` refuses it by design. Unmeasurable in this harness at any n. |
| `c25-c39-combo`, `c31-c38-combo`, `c37-c39-combo` | investigation scaffolds, not independent candidates by their own config text |
| `c33-subagent-fork-default` | standing recommendation; opposed to the c36 spawn direction |

**3. `c25-harness-off` reclassified** as a permanent control instrument (harness ROI denominator),
not a candidate. It is never adopted or retired. Recorded here rather than in the config, because
`validate_config`'s fail-closed key allowlist correctly rejects a free-text `disposition` field —
the schema refusing to carry a decision is the right behaviour.

**Consequence for S1:** the probe covers **28 candidates**, not 40. The other 17 need either a new
firing event added to their mechanism, an inverse-exposure rule for OFF-arms, or acceptance that
they can only ever be judged on outcome rather than engagement.

## Amendment (2026-07-27): S1 entry rules by exposure mode

S0 established that the 45 candidates split three ways. S1 asks "does the mechanism fire", which
is only a meaningful question for two of them.

| mode | count | S1 | rationale |
|---|---|---|---|
| `telemetry` | 28 | **runs** | a declared event firing proves the mechanism acted |
| `suppression` | 2 | **runs, inverted** | treatment lands when the target event drops to **zero**; verdict needs the paired base arm via `suppression_confirmed()` |
| `configuration` | 15 | **SKIPPED — enter at S2** | the treatment *is* the config; there is no firing to observe |

**S1 therefore covers 30 candidates, not 45.**

The 15 skippers are prompt/governor variants (c1, c5, c8, c9, c15, c19, c46, c47) and wording-only
threshold changes (c14, c18, c18b, c33, c34, c36). Skipping S1 is not leniency — they forfeit the
cheap retirement path and must earn their verdict on **outcome** at S2, where a null is a real
result rather than an unreadable one. Where a mechanism could plausibly be instrumented later,
adding a firing event and re-entering at S1 is strictly cheaper than an S2 round.

**Suppression arms need their base arm.** Unlike telemetry mode, a suppression row is not
self-interpreting: zero firings in cand proves nothing if base was also zero. S1 for c10 and
c25-harness-off must therefore run **both arms** (n=6 each, 12 sessions) rather than cand-only.
Revised S1 cost: 28 × 6 + 2 × 12 = **192 sessions ≈ 13 h**.

## c21 VERDICT: does not meet the bar (2026-07-27)

The second task landed and c21 **fails the rule that was pre-registered before the numbers existed**.

| | `parens` (n=20) | `qs-error-swallow` (n=18) |
|---|---|---|
| effort metrics better | **7/7** | **4/7** |
| worse | — | output_tokens; **input_tokens +72%, p=0.038** |
| pass rate | 15→13 | 13→12 |
| mechanism fired | 14/20 | 15/18 |

Rule required ≥5/7 better **on both tasks** and non-inferior pass rate. It gets 4/7 on the second,
is *significantly worse* on input tokens, and pass rate is down on both. **PARK — stays dark.**

The `parens` result was task-specific, not a general property. This matters beyond c21: it was the
single most promising thing in the entire 1,505-session catalogue, ranked #1 and #2 by the effort
sweep, and it still did not replicate. Treat one-task effort wins as hypotheses, always.

**Pre-registration is the only reason this reads as a rejection.** The author (me) had spent the
day arguing c21 was the one candidate that worked, and 4/7-with-a-significant-regression is
exactly the shape that gets rationalised into a win when the rule is written afterwards.

**Also note the protocol's own S1 stage never ran.** It was superseded by a first-principles pass
that retired ~20 candidates on mechanism grounds — planning ceremony adds turns and context to a
model failing from too many turns and too much context — rather than spending 13 h probing them.
The funnel remains the right shape for anything that survives that reasoning.
