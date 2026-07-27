# Measurement methodology: what a 2026-07-27 audit changed

This project's optimizer was built to be *trustworthy* — HMAC'd telemetry, surface hashes, serving
fingerprints, fixture admission gates, authority rules. All of that works. An audit of the full
1,466-row catalogue found the rigor was aimed at the wrong risk: it made every number defensible
without ever asking whether the number **could move**.

Seven findings, each reproducible from data already in `optimizer/prompt-lab/results/`.

## 1. The detection floor — most rounds could not have found a win

Smallest pass-rate improvement reaching p<0.05 by Fisher's exact test, at the sample sizes actually
used:

| n per arm | smallest detectable improvement |
|---|---|
| **3** (the 34-candidate sweep) | **none — no effect of any size** |
| **6** (the batch screen) | +83pp |
| 9 (most candidate rounds) | +56pp |
| 18 | +28pp |
| 20 | +25pp |

No harness intervention plausibly delivers +56pp. **A large fraction of the ledger's `NEUTRAL`
verdicts were guaranteed before the round started.** The 34-candidate gemma sweep at n=3 could not
have produced a significant result at any effect size, so every delta it reported — including the
headline ±44pp — sits below its own design's detection floor.

Reproduce: `effort_report.py` docstring, or the Fisher enumeration in `CANDIDATE_PRUNING_2026-07.md`.

## 2. Pass/fail is the wrong outcome variable

Almost every candidate targets **efficiency** — less flailing, fewer wasted turns, fewer bad edits.
The gate measures **capability** — can the model solve this task at all. Those come apart
completely.

c21-micro-gate stated its own signature in its config, before any of this:

> *"Expect pass-rate neutral-to-up with LOWER tokens… micro-gate.fired counts the mechanism."*

It delivered exactly that, and the screening rule filed it `PARK_EXPOSED_NO_SIGNAL` because it read
only the gate bit. At n=20/arm the same candidate shows −26% turns, −64% tool errors, −75% repeat
calls, five metrics at p<0.05. **One bit per session cannot see that.**

That the effect then failed to replicate on a second task (§7) does not weaken the point — the gate
bit was blind to a large, real, mechanism-confirmed change either way. Scoring effort is what made
both the apparent win *and* its non-replication visible at all.

Every session already records `trajectory.{turns,tool_calls,tool_errors,repeat_calls,
tool_result_chars}` and `usage.{input,output}_tokens`. Score them: `effort_report.py <gen>`.

## 3. Variance is the binding constraint, not sample size

Effort metrics have far more power than a binary, but session-to-session variance on a small model
is enormous — c21/parens base turns were `4, 25, 35, 56, 56, 119`, a 30× spread. Bootstrapped power
for the **largest effect in the entire dataset**:

| n/arm | power |
|---|---|
| 6 | **22%** |
| 20 | 58% |
| 40 | 84% |

A real 4× efficiency win is missed ~78% of the time at n=6. Budget for variance, not for optics.

## 4. You must be able to prove the mechanism fired

Before this audit, **40 of 45 candidates declared no `exposure` spec**, so `NEUTRAL` was
indistinguishable from *"the mechanism never engaged."* This is not hypothetical: in the batch
screen, `c24/parens` and `c7/parens` both scored a superficially encouraging **+1/6 while firing
zero events**. Without exposure counts, two non-measurements would have entered the ledger as mild
positives.

Related, and worse: across 1,465 sessions, **53 of 68 mechanism counters are identically zero** —
including all 21 counters of the c40–c45 planner family, and `plan_runner_delegation.{blocked,
delegated}` for the entire delegation cluster.

## 5. Exposure has three modes, and two of them are not "did it fire"

| mode | meaning | `targeted` means |
|---|---|---|
| `telemetry` | a declared event firing proves the mechanism acted | mechanism fired |
| `suppression` | candidate turns a mechanism **off**; sense of `target` is **inverted** | target event went to **zero** |
| `configuration` | the treatment *is* the config (prompt/wording); no firing exists | **config applied — NOT "fired"** |

`configuration` mode is vacuously `targeted` by construction. Reading it as engagement is the
single easiest way to fool yourself with this system.

Suppression rows are also **not self-interpreting**: zero firings in cand proves nothing if base was
zero too. Use `exposure.suppression_confirmed(base_total, cand_total)` for the paired verdict, which
distinguishes *confirmed* from *unexercised*.

## What follows from this

- **Score effort by default**, pass rate as a do-no-harm guard. `effort_report.py`.
- **Declare exposure on every candidate.** A candidate that cannot prove it fired cannot be
  retired for failing to help.
- **Adoption needs power; retirement usually doesn't.** A mechanism that never fires on a fixture
  built to trigger it is retireable on six sessions with no statistics. This asymmetry is what
  makes a full roster verdict affordable — see `ADOPT_OR_RETIRE_PROTOCOL_2026-07.md`.
- **Pre-register decision rules.** A 650-comparison re-score (`effort_report.py --sweep`) is a
  shortlist generator; anything chosen after seeing results is hypothesis, not finding.
- **Check the fixture can express the effect.** `hygiene-shared-config-reread` (0/6) and
  `sv-ambiguous-spec` (1/6) are floors on the 4B — a null there was never capable of being anything
  else.

## The reframing

"0 of 44 candidates adopted" was read for weeks as evidence the candidates don't work. It is
better explained as the expected output of a design that could not see its own results. The roster
is a backlog of **untested** ideas, not rejected ones — which is why the first properly powered
round produced a candidate with 7/7 metrics moving the right way. That candidate then failed on a
second task (§7), so the corrected reading is narrower and more useful: the roster is untested, and
testing it properly mostly produces rejections — but *earned* ones.

Defensibility and informativeness are different properties. This project had the first and,
for a long time, not the second.

## 6. The real binding constraint is repeat spirals, not context (2026-07-27)

Re-derived from 1,505 sessions when the goal was restated as *"small models effective over long
multi-turn tasks, minimal context"*:

| | median | p90 | p99 | max |
|---|---|---|---|---|
| turns | 11 | 33 | 89 | **203** |
| tool errors | 3 | 12 | 34 | **150** |
| context tokens | 4,908 | 19,425 | 43,779 | 47,832 |

**Context is not the constraint.** The median session uses 4,908 tokens; the governor is 6.9% of
that. Minimal-context work on prompts optimises a rounding error.

**Repeat spirals are.** Errors in the longest decile: median 14; in the shortest half: 1. Repeat
calls track errors ~1:1 in the tail (150 errors / 164 repeats; 76/68; 62/49). The top 10% of
sessions carry **43% of all 7,673 wasted tool calls**.

And the cause was a live defect, not a missing feature: `loop-breaker` reset its episode on *any*
progress — including a turn with no tool calls — so `fail, fail, fail, one edit, repeat` never
tripped a tier. **8 of the 24 worst sessions passed.** They were not stuck, they were grinding.
Fixed in `64103be` with a session-cumulative counter.

**Consequence for candidate design:** an intervention that adds turns or context to a model failing
from too many turns and too much context is wrong by construction, regardless of how it measures.
That reasoning retired ~20 planning/delegation candidates and deleted the v4 family outright —
cheaper and more reliable than 13 h of probing would have been.

## 7. Pre-registration earned its keep immediately

c21-micro-gate was the single most promising candidate in the catalogue — ranked #1 **and** #2 by
the effort sweep, 7/7 metrics better at n=20 on `parens`. On its second task it managed 4/7 with
input tokens significantly *worse*, and pass rate down on both. It stays dark.

The rule was written a day before those numbers existed. Written afterwards, 4/7-with-a-regression
is exactly the shape that becomes "directionally positive, adopt with monitoring".
