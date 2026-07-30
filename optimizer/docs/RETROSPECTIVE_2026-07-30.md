# Retrospective, 2026-07-30: why "we keep hitting neutral" — and what the neutrals were hiding

Written the morning after the c25 powered round, at Albert's prompt: *"It just feels like it
has failed. I wanted to improve my harness for small models over long, multi-turn tasks, with
tool accuracy and code quality and thoroughness being the observable metrics. But it just
feels like we keep on hitting neutral."*

The feeling is pointing at something real. It is not that the approach failed. It is that
three structural facts guaranteed neutrality regardless of candidate quality, and all three
became measurable this week.

## The tally, honestly

~50 candidates built across c1–c50. Decisively tested to a real verdict: **eight**.

| candidate | verdict | note |
|---|---|---|
| c21 micro-gate | REJECTED | 7/7 metrics at n=20 on task 1; failed task 2. Prereg killed it. |
| c25 subagent-only | INVALID + non-replication | −44% p=.030 at n=12 became −14% p=.665 at n=113 |
| c28 teach-hints | NEUTRAL | first authoritative local verdict of the queue |
| c33 fork-default | RETIRED | philosophical conflict, unmeasured by design |
| c35 bash-output-guard | NEUTRAL (unexercised) | guard never fired on any task tested |
| c37 delegate-all | 0-for-2, adverse | +70% turns / +200% errors when activated |
| c38 force-plan-write | NEUTRAL ×2, collapse ×1 | e2b collapse proven model-specific (3rd model 9/9) |
| c40–c45 planner family | DELETED | 21 telemetry counters read zero across 1,465 sessions |

Adopted from a measured A/B: **one** — the governor prose removal (83% → 89% → 97% as prose
was deleted; the README's headline finding). Everything else that improved the harness came
from a different pipeline entirely (below).

## The three structural causes of neutrality

### 1. The task set saturated underneath us

Measured base pass rates, standard set (parens/equil/bigdata):

| model | base pass | source |
|---|---|---|
| qwopus35-4b | **93%** (56/60) | c25-4b-powered, 2026-07-30 |
| qwen36-35b DD | ~**100%** | every recent round; 9/9 base in c38-solo |
| gemma4-26b | 100% (smoke) | tools-surface-smoke |

And the "hard" fixtures: hygiene-shared-config-reread **0/6**, sv-ambiguous-spec **1/6**,
retry-trap **0/12**. The band between too-easy and impossible is nearly empty. A pass-rate
delta cannot exist at a 93% ceiling; every "discriminating band" sighting (c25's base 5/9)
was a low draw — the same config drew 9/9 the same day. **Most NEUTRALs measured the fixture
set, not the candidate.** The models improved underneath fixtures that never followed.

### 2. The instrument never measured the stated goals

The goals: long multi-turn tasks, tool accuracy, code quality, thoroughness.
The instrument: a **binary pass** on **short tasks** (median gate session ≈ 11 turns, ~5k
tokens). Code quality has never been scored once. Thoroughness has never been scored once.
Long-horizon behavior exists only in live sessions the gate has never contained. And binary
outcomes are the lowest-power measurement available — the 2026-07-27 audit's own table:
at n=9/arm Fisher needs +56pp. A graded 0–8 outcome with realistic spread gives Mann-Whitney
detection at n=9 that binary needs n≈40 for. **We were asking the least sensitive possible
question about a different goal than the one we held.**

### 3. The wins came from the other pipeline

Every material improvement to date: governor prose removal; the loop-breaker grinding fix
(43% of all wasted calls); the plan_write tool-grant bug; `find -exec` unblocking; the
compaction-coordinator sharing bug; the gate-surface fix (subagent/write); the unhashed-skills
provenance hole. **All found by reading real transcripts and provenance, none by candidate
A/B.** The A/B machinery's proven contributions are (a) truth enforcement — it killed c21 and
c25, both of which looked adoption-worthy and were noise — and (b) forcing the exposure/
provenance instrumentation that keeps finding real bugs. A loop that mostly says "no" and
catches its own wishful thinking is doing its job; it was never going to manufacture wins on
saturated binary tasks.

## The uncomfortable datapoint, stated plainly

`c25-harness-off` (steering layer disabled): **18/18, base = cand = 100%** on the standard
set (2026-07-24). On short, easy tasks, these models may barely need the steering layer at
all. If that is true, "neutral" is the CORRECT verdict there — and the harness's value, if it
exists, lives exactly where the goal statement points: long, hard, messy tasks. That round
has never been run on fixtures that could show it. It is now Phase 3 of the re-aim plan
(HARNESS-ROI, graded, on the discriminating fixtures).

## The reframe (now standing policy)

- **Discovery engine**: transcript mining of live + gate sessions. This is where every real
  fix has come from. Formalized as a recurring ledger pass: worst sessions, new failure
  classes, mechanism proposals.
- **Confirmation engine**: the gate, on fixtures that can express an effect, with graded
  outcomes and pre-registered rules.
- **Candidate admission rule**: a candidate may enter the roster ONLY from an observed
  failure class with a named sensor gap (c49 pseudo-tool-calls and c50 spec-guessing are the
  template). No new ambient/steering candidates.
- **The legacy queue** resolves by the 2026-09-03 win-or-retire sweep, on the new instrument
  where applicable, mechanically otherwise.
- **Instrument v2** (in flight): graded subscores in rows; the `audit-sweep` thoroughness
  fixture (long, multi-stage, seeded defects); a calibrated code-quality judge over final
  diffs; tool-accuracy rate surfaced as a first-class metric.

The project's own methodology doc said it in July: *defensibility and informativeness are
different properties.* The last three days made the instrument defensible AND finally showed
exactly why it wasn't informative. That is not failure; that is the prerequisite for aiming.
