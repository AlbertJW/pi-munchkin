# Candidate strategy: why the roster cannot be ranked on outcome yet

**2026-07-31.** Analysis of the whole dark-candidate roster against how the harness actually
works, what the instrument can see, and what 1,839 eval rows actually say.

**The finding that subsumes the ranking:** at the sample sizes this project uses, the gate is a
**one-sided regression detector**. It can find harm. It essentially cannot find help. Every
"neutral" in the ledger is consistent with that alone, with no theory about candidate quality
required.

This document went through an adversarial review that overturned three of its own first-draft
tiers. Where a claim was corrected, both versions are shown — the errors are more instructive
than the conclusions.

---

## 1. The instrument cannot return a positive result

Fisher exact, one-sided, computed directly (no scipy in this env; two-sided values are 2×):

**n=9/arm, base 5/9** — the best discriminating band that exists anywhere in the corpus:

| cand | one-sided p | two-sided |
|---|---|---|
| 6/9 | 0.500 | — |
| 7/9 | 0.310 | — |
| 8/9 | 0.147 | — |
| **9/9** | **0.041** | **0.082** |

A candidate would have to take a 56% task to a **flawless sweep** to reach one-sided
significance — and two-sided, *nothing* is detectable.

**n=9/arm, base 9/9** — the saturated case, which is most of the corpus:

| cand | p |
|---|---|
| 5/9 | 0.041 ✓ detectable |
| 4/9 | 0.015 ✓ detectable |
| 7/9 | 0.235 ✗ |

**n=20/arm, base 15/20:** even 19/20 is p=0.091. Only 20/20 (p=0.024) clears.

So: from a ceiling, only regressions are visible; from the one in-band fixture, only perfection
is. **Every round can return NEUTRAL or HARMFUL and nothing else.** That is the whole
explanation for "8 decisively tested, 1 adopted" — and it predicts the observation that the
only statistically significant candidate result anywhere in the top tiers is a *harm*
(c38 −56pp, p=0.029).

**Corollary that should govern candidate design.** Every measured harm in this corpus is a
*blocking or steering* intervention — c38 −56pp, c7 −44pp, c37 −33pp. The one change ever
adopted was a **subtraction** (governor prose removal, 83%→89%→97%). Additive/inert mechanisms
cannot show a win on this instrument but also cannot hurt; every measured harm so far came from
a blocking or steering **candidate**.

> **Correction 2026-08-03.** This paragraph used to assert "all five `block: true` sites in the
> harness live in `plan-runner.ts`". There are **12, across five files**: `plan-runner.ts` 5 (the
> c25/c37/c38 family), `git-guard.ts` 4, and one each in `loop-breaker.ts`,
> `context-inlet-guard.ts` and `chaos.ts`. The count was wrong when written, not stale. The first
> three of those are **live baseline, not candidates** — and loop-breaker is the project's one
> credited win — while `chaos.ts` is dormant unless `CHAOS` is set. So "blocking mechanisms only
> ever hurt" does not follow from the inventory; it holds only over the candidates measured.

---

## 2. Three corrections to the evidence base

### 2.1 Five candidates were never testable (retired `166e94d`)

`validate_config` accepted `gov_file`/`gov_append`; `render_prompt` reads only
`prompt_variant`/`format`/`scaffold`. Verified by executing the render:

```
BASE                       sha=f688ebfebd08 len=1662
c1 / c5 / c8 / c9 / c15    sha=f688ebfebd08 len=1662  env={}   <- identical to base
c2-scaffold-cot            sha=25bb9aa71364            (scaffold path works)
c46-prompt-lean            sha=7cd4b5bc0196            (prompt_variant path works)
```

**`c9` is named "no-governor" and emitted the live governor byte-for-byte**, measuring +0pp — a
total governor removal moving nothing, while real governor changes measure ±14pp. Deleted, with
a two-layer guard. `c9` is now usable as what it accidentally was: a second **inert positive
control**, alongside c49.

### 2.2 "Failing sessions read less" is a composition artifact — and so was my check for it

Pooled, passing sessions read more (median 3 vs 1). My first draft ranked candidates on the
implied "under-investigation" signature. **The direction inverts inside every model**, and the
control I proposed (excluding <3-tool-call sessions) does *not* detect it — the collapse
population is only 29 of 942 base sessions and does not move the medians. Mann-Whitney AUC
(P(pass > fail)), base arm:

| metric | pooled | gemma-e2b | qwen36-35b | 4b-mtp | 4b |
|---|---|---|---|---|---|
| reads | **0.589** | 0.389 | 0.215 | 0.327 | 0.305 |
| unique_reads | **0.614** | 0.394 | 0.208 | 0.339 | 0.307 |

Significant in all four strata, sign flipped in all four. Failing sessions read **more**. The
pooled effect is gemma (median 1 read, 40% pass) filling the failure pool while the 35B
(median 3 reads, 87% pass) fills the pass pool.

Two consequences: the "under-investigation" rationale is void, and `MEASUREMENT_METHODOLOGY` §6's
grinding framing **survives** — the ~20 retirements made on it stand.

**`tool_errors` is the only metric whose direction is stable across every stratum.** Caveat
against my own number: §8 forbids cross-boundary `tool_errors` claims, the corpus spans 17
distinct `harness.surface_sha256` values, and only ~108 rows are post-fix. The within-stratum
direction is consistent, but the pooled magnitude is not clean.

### 2.3 Mechanism-firing counts in circulation are 2× the truth

Recounted with a per-row dedup assertion over all 1,839 rows:

| event | circulated | actual | rows>0 |
|---|---|---|---|
| `plan-runner/force-plan-write-block` | 210 | **105** | 102 |
| `state-lens/view-injected` | 530 | **265** | 24 |
| `plan-runner/write` | 943 | **468** | 103 |

Every mechanism-engagement claim built on the inflated figures needs re-reading. Also
unreproducible: my "plan_write in 5 of 106 rows" — the counter appears on 107 rows, all
**cand-arm**. There is no base-arm measurement of voluntary `plan_write` anywhere in the corpus,
so "models never plan voluntarily" rests on hand-inspection of transcripts, not on rows.

---

## 3. Loop position (secondary lens)

```
before_agent_start ─┐   PREVENTIVE — shapes what the model sees before it acts
   context ─────────┤
      [ tool_call ──┤   PREVENTIVE — the ONLY hook that can stop an action
        tool_result ┤   CORRECTIVE — patches what came back
        ...        ]│
   turn_end ────────┘   CORRECTIVE — costs a full turn to deliver
```

Nothing can see reasoning before it acts, force a tool call, or retry a turn. The harness's
entire vocabulary is: block, reshape context, append to a result, send a message. Candidates
requiring the model to *choose* (plan, delegate, compact) are asking, not making — and the
corpus says asking does not work: **1 voluntary subagent call in 942 base sessions**, and
**2 completed compactions in 1,839 rows** (recounted 2026-08-03; this said "0 ever", which was
wrong — the two are in `c26-4b.jsonl` and `c35-9b.jsonl`. The argument is unaffected: 2/1,839 is
still "essentially never").

---

## 4. The ranking

### Tier 0 — Not candidates. Retired.
`c1`, `c5`, `c8`, `c9`, `c15`. Two near-misses **spared** after checking:
- **c3 is live**: `thresh("LB_STREAK_SOFT", cloud=12, local=8)` — a no-op on cloud, real on
  local. Its one round was the *remote* sweep, a venue where it does nothing. Never measured
  where it acts.
- **`span-screen-on.json` is load-bearing** — `span_screen.py:110-112` loads it as the
  span-screen study's candidate arm.

### Tier A — The instrument. Above every candidate.
Nothing below can return a positive result until this exists.
1. **Graded outcome in rows.** ~~`score` is binary in all 1,839 rows.~~ **DONE 2026-07-31**
   (`31611d1`, `a37494a`): optional `subscores` in the row schema, gate passthrough for any
   `.<name>-grade.json`, and `effort_report --graded`. Proven on audit-sweep's real grader —
   pristine 0/8, shortcut 2/8, gold 8/8, so the two states the binary bit scores identically
   are 0.000 vs 0.250 graded.
2. **n ≥ 20/arm**, and a fixture in-band, or the round is a regression detector by construction.
3. **An in-band venue — CORRECTED 2026-07-31 (post-QA), and the news is good.** The first
   version of this item called for building one and mislabelled the inventory. Recomputed over
   every model×task cell with n≥6:

   | cell | base | authority | recoverable? |
   |---|---|---|---|
   | gemma-4-e2b / `bigdata` | 71/102 = 69.6% | non-auth | **No** — remote endpoint, structural |
   | 4b-mtp / `path-near-miss` | 6/12 = 50% | non-auth | **No** — remote, structural |
   | 4b-mtp / `sv-commit-sha-guard` | 2/6 = 33% | non-auth | **No** — remote, structural |
   | **qwopus35-4b (LOCAL) / `sv-convention-provenance`** | **3/6 = 50%** | non-auth | **YES** — the reason recorded on those rows is `"missing expiry"`: the fixture was *unapproved when they were collected*. It has been **approved since 2026-07-29**, expiring 2026-10-27. |

   **So the venue already exists.** Re-running `sv-convention-provenance` on the local 4B today
   yields authoritative in-band rows. The task is not "build a fixture", it is "re-run the one
   we have at n large enough to trust the band" — 3/6 is one flipped session from 33% or 67%.
   For the 35B nothing exists between 94–99% and 0–11%; that gap is real and unaddressed.

### Tier B — Safe to run once Tier A exists
- **c48 state-lens (view)** — additive, no blocking mechanism, so it cannot produce the harm
  signature; 265 injections; an authoritative round already exists (`c48-view-35b`) and was
  informationless only because its fixtures were one floor plus two ceilings. Cost to weigh:
  the per-call tail breaks the KV prefix every call (`session-blackboard.ts:167-177`) — and
  **`prefix_stable_rate` cannot see it**: it reads 1.0 on both arms of both c48 rounds despite 148
  and 117 lens injections, because `context-surface` (readdir index 6) hashes the messages before
  `session-blackboard` (index 19) appends. Read that 1.0 as *unmeasured*, not *stable*, and note
  that c26/c30 name the same field as their non-regression guardrail
  (`MEASUREMENT_METHODOLOGY_2026-07.md` §13).
- **c21 micro-gate, re-specified.** Its "7/7 metrics better" is a **count-not-rate artifact** —
  the headline −64% error count sits on a −31.3% call-volume reduction (1544 → 1060 calls), and
  in the parens round alone volume fell −49.5%. But the first draft of this entry cited *three*
  pairings ("worse in two of three rounds") when **seven** exist across five result files, and
  all four it omitted favour c21 — including `c21-screen-qs-error-swallow`, the direct sibling of
  the one `screen` round it did include. Every pairing, errors per tool call:

  | round | task | n/arm | base err/call | cand err/call | Δ | pass base→cand |
  |---|---|---|---|---|---|---|
  | `gemma-e2b-c21-micro-gate` | bigdata | 3 | 0.536 | 0.471 | **−12.2%** | 3/3 → 3/3 |
  | `gemma-e2b-c21-micro-gate` | equil | 3 | 0.714 | 0.568 | **−20.5%** | 1/3 → 1/3 |
  | `gemma-e2b-c21-micro-gate` | parens | 3 | 0.750 | 0.500 | **−33.3%** | 0/3 → 1/3 |
  | `q4b-c21-effort-qs` | qs-error-swallow | 18 | 0.311 | 0.322 | **+3.4%** | 13/18 → 12/18 |
  | `q4b-c21-effort` | parens | 20 | 0.300 | 0.208 | **−30.5%** | 15/20 → 13/20 |
  | `c21-screen-parens` | parens | 6 | 0.298 | 0.344 | **+15.6%** | 5/6 → 5/6 |
  | `c21-screen-qs-error-swallow` | qs-error-swallow | 6 | 0.371 | 0.356 | **−4.2%** | 6/6 → 6/6 |

  The three gemma cells are n=3/arm — below the noise floor (§10), listed for completeness, not
  as evidence. Accurate summary: **improved in 5 of 7; pooled −5.9%** (520/1544 → 336/1060), or
  **−4.2%** excluding the three n=3 cells.

  **c21 stays in Tier B regardless**, because the correction does not touch the disqualifying
  confound: cand cuts call volume ~31%, so error *counts* fall largely by truncation, and pass
  rate fell in **both** large-n rounds (15/20→13/20 p=0.73; 13/18→12/18 p=1.0).
  `RETROSPECTIVE_2026-07-30.md:18` records it **REJECTED**, not parked (this cited `:24`, which is
  the c38 row). Steelman that survives:
  surfacing a parse error at `turn_end` instead of five turns later legitimately shortens
  sessions. Re-run only with **errors-per-call as the pre-registered primary** and a fixed turn
  budget to close the truncation channel.

### Tier C — Requires a behaviour the models do not exhibit
`c25`, `c31`, `c32`, `c34`, `c36`, `c37`, `c39`. c37 is 0-for-2 with adverse effort. c32 has met
its own declared retirement condition (zero fabricated SHAs, ever).

### Tier D — c38, demoted from first place
Its own design comment (`plan-runner.ts:92-98`) says it exists because *"every mechanism gated
behind a plan_write call has no surface to fire on"* — **it is an enabler for Tier C, not a
standalone intervention**. One-shot by construction (fires only when no plan state exists;
99 of 102 rows fired exactly once). It does not induce reading: across its rounds
unique_reads 2.57 → **2.45** and first mutation gets marginally *earlier*. And its only round
with power (gemma, base 5/9 = 56% — genuinely in-band) produced **0/9, p=0.029, the only
significant pass-rate result in the whole top of the roster** — a harm.

### Tier E — Never observed the phenomenon they target
- **c24 did-you-mean, demoted from second.** It fires **8/8 on `path-near-miss` and 0/8 on
  parens** — outside the fixture built to make it fire, it has never fired. That is verbatim
  this tier's criterion. Worse, two base draws of the *identical* config/model/fixture measured
  **2/6 and 4/6** — a 34-point swing — so the claimed +33pp effect is smaller than the fixture's
  own draw noise, and the "base 6/12 = 50%" I quoted pools two heterogeneous groups.
- `c35` (fired 3×, one session), `c49` (0 detections — tested on the model that does not
  collapse), `c50` (two fatal defects, now fixed, unmeasured), `c14` (hypothesis refuted, AUC
  0.614), `c7` (**SAFETY HOLD** — 6/6→3/6).

Note on prevalence-weighting, which I considered as an alternative principle: it does not
rescue c49. The collapse class is 62 sessions but only 9.4% of failures, and 44 of 62 are
lfm25 — which passes **0 of its 26 non-collapsed sessions**. Fixing the collapse buys zero
passes.

---

## 5. A refuted alarm, recorded so it is not re-raised

The review flagged that `loop-breaker.ts:326` (`isLocal = provider.startsWith("local")`) might
misclassify 1,387 of 1,839 rows as cloud, running ~2× looser thresholds on local models. It was
appropriately hedged as unverified. **It is a false alarm, from conflating two different
`provider` fields.** `msg.provider` comes from the model registry
(`agent-session.js:1520`), and `~/.pi/agent/models.json` registers the daily drivers under
provider key **`local-llamacpp`** — `qwen36-35b-iq3s` and `qwopus35-4b` both — while the mtp /
lfm25 family sit under `remote-llamacpp`. Classification is correct. The row field
`execution.provider` (`"llama"`) is the gate's `MODEL_CONTROL`, a different value that
loop-breaker never sees.

---

## 6. What to do

**Do not run a candidate round next.** Not because the candidates are bad — because §1 shows the
round cannot come back positive.

1. Build Tier A: graded outcome, n≥20, one local in-band fixture for the 4B.
2. Then Tier B, c48 first (additive, cannot produce the harm signature), c21 second and
   re-specified on a rate primary.
3. Keep using the two **inert positive controls** (c9's shape, c49) to re-measure the noise
   floor whenever the instrument changes.

**The frame worth keeping.** Every material improvement this project has shipped — governor
prose removal, the loop-breaker grinding fix, the `plan_write` tool-grant bug, the gate-surface
fix, the docs/-materialization bug, the five inert candidates — came from **reading transcripts
and provenance**, not from a candidate A/B. The A/B machinery's demonstrated value so far is as
a bug detector for the harness. That can change once it can see effort and quality. It has not
changed yet.

---

## 7. Standing rules earned

- **Compute the power before designing the round.** If the base arm is at a ceiling, the round
  can only detect harm — know that before spending it.
- **Stratify by model before believing any aggregate.** §2.2 inverted a headline, and the
  obvious control failed to catch it.
- **Normalize rate metrics by volume.** §4's c21 entry: a −64% error count under a −49.5% call
  count is not a −64% improvement.
- **Enumerate every pairing, or cite none.** The correction above was itself selective: it quoted
  3 of 7 c21 pairings and all 4 it dropped pointed the other way. Debunking a cherry-pick with a
  cherry-pick is the same error with the sign flipped — count the cells first, then write.
- **A mechanism that fires only on its own purpose-built fixture has not been shown to
  generalise.** §4's c24 entry.
- **Recount before citing a mechanism-firing number** (§2.3 — the circulating figures were 2×).
- **A config that renders identically to base with an empty env is not a candidate** — now
  enforced in `validate_config`.
