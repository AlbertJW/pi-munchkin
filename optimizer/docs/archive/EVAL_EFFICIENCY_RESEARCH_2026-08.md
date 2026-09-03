# Shortening harness evaluation: research synthesis (2026-08-25)

Commissioned by Albert ("still too long!") after the semantic-loop calibration's honest
projection reached overnight-plus and the preregistered powered trial priced at a week of
single-box compute. Three parallel research passes: statistical efficiency, agent-scaffold
evaluation practice in the wild, and offline/counterfactual evaluation. Full cited reports are
archived in the session transcript; this document keeps the conclusions and the design they
imply. Nothing here weakens the prereg discipline — every shortcut below states what it can and
cannot conclude.

## Where the time actually goes

Cost = session length (20–30 min on this subject/fixture tier) × sessions needed. Sessions
needed is driven by variance: session-to-session spread on a small model is enormous (30×
turn-count spread was measured in July), and the current analysis (bootstrap on independent arm
means) pays full price for it. The field's headline lesson is NOT "run fewer sessions" — it is
**extract more effective n per session**, via pairing, conditioning, and branching.

## The five levers, ranked for this repo

### L1 — Pair everything (2–4× effective n; free)

Run candidate and control on identical (fixture, seed) blocks, back-to-back, order randomized;
analyze per-block differences (sign-flip permutation test as primary; negative-binomial with
fixture fixed effects as secondary). Variance shrinks by 1/(1−ρ); with fixture identity plausibly
explaining most outcome variance, ρ≥0.5–0.7 is realistic → the 40/arm powered design gains the
power of ~100+/arm unpaired. This is Anthropic's "Adding Error Bars to Evals" (arXiv:2411.00640)
recommendation and HarnessFix's (arXiv:2606.06324) practice — the closest published analog to
this project used ~100 paired tasks × 3 runs and one-sided paired sign tests. Deterministic
fixtures + a single-slot local server make true pairing feasible here in a way cloud evals can
only approximate. ALSO: cluster standard errors by fixture — naive SEs on clustered designs run
~3× too small, so the current bootstrap is simultaneously underpowered and overconfident.

### L2 — Branch at logged trigger points instead of replaying whole sessions (≈5–10× more exposed comparisons per box-hour)

The intervention only matters after a failure episode opens; most live-session minutes are spent
getting there. The published protocol (The Replay Gap, arXiv:2608.08239; Causal Agent Replay,
arXiv:2606.08275; SWE-Replay, arXiv:2601.22129): restore state at a logged trigger point, then
run only the SUFFIX live — k steered vs k unsteered continuations from the same state, paired.
The unsteered arm doubles as the resample-noise floor (mandatory: control forks on a small
quantized model diverge on most forks — a single-rollout comparison is a coin flip). The
run-capsule + recovery-brief machinery already built here is most of the required engineering.
What it honestly concludes: the causal effect of the steer GIVEN a loop state — mechanism-to-
conditional-adoption grade. It does not give the deployed-effect number (enforcement from
session start may prevent the branched-from states ever arising).

Explicitly rejected on the evidence: log-stitching replay (scoring an injected steer against
the LOGGED suffix) — the Replay Gap measured it mispredicting essentially every success-relevant
outcome; and OPE/importance-sampling — formally undefined here (deterministic logging policy,
zero propensity on the intervene action) and horizon-degenerate for LLM agents regardless.

### L3 — Audit the shadow data you already have (free; kills or tunes the trigger before any box time)

Live telemetry already holds 50 sessions with failure-episode events — 19 with observed
episodes, 11 where a shadow tier would have fired (28 tier-observed events) — plus ~1,500
historical transcripts. The fraud-industry shadow-rule playbook applies directly: measure
trigger PRECISION (label a sample of would-have-fired points: was the agent actually stuck?),
RECALL against known-bad endings (dead episodes, budget exhaustion — did a tier fire, and early
enough to matter?), and REMAINING BUDGET at first fire (a trigger that fires with nothing left
to save cannot help at any steer quality). Multi-surface data, so descriptive only — but if
precision is poor or first-fire is late, the candidate dies tonight for free. What shadow data
can never show: the downstream effect of enforcing (Waymo's counterfactual-simulation caveat).

### L4 — Sequential stopping (≈1.3–1.5× on winners; more on losers)

Group-sequential looks (O'Brien-Fleming alpha-spending after ~16/28/40 pairs) with non-binding
futility bounds: expected sessions ~60–80% of fixed-n when the effect is real, and futility
stops losers early — which, given the gate's one-sided history, is the common case. GSD
dominates mSPRT/always-valid at this session cost (planned looks suffice; unlimited peeking
buys nothing but wider bounds). E-process/confidence-sequence methods add one genuinely useful
property: optional continuation — a suggestive round can be topped up later without alpha
damage. Prereg-native; a pure analysis-plan change.

### L5 — More bits per session (validates existing doctrine; small additions)

The field's cheap-credible toolkit is mostly what this repo already does: graded/partial-credit
scoring (TheAgentCompany checkpoints ≈ our graded_rate), mechanism-event counts as primary
endpoints (our exposure discipline; one training paper reports stuck-in-loop incidence
53.85%→8.79% as a headline metric), trajectory-quality indices over logged runs (AgentLens:
~11% of "resolved" labels are lucky passes; rankings flip under trajectory scoring — a caution
for any small-n outcome-only delta). Additions worth taking: per-fixture discrimination
screening from calibration data (tinyBenchmarks logic — drop fixtures that cannot express the
effect; the detection-floor rule formalized) and concentrating repeat budget on the unstable
fixtures where the variance actually lives.

### The adoption endgame — enrichment + dilution (10–20 live sessions, not hundreds)

For the deployed-effect number: run live paired sessions only on high-trigger-rate fixtures,
identify triggered sessions counterfactually in BOTH arms (the trigger is a deterministic
function of the event stream — the usually-hard symmetry condition is free here), analyze the
triggered subset, then scale by the fleet trigger rate from shadow telemetry (Deng & Hu,
WSDM 2015 dilution correction). Adoption-grade for the stated conditional claims.

## What NOT to copy from the field

Single-run pass@1 deltas as scaffold findings; cross-system comparisons sold as harness
evidence (NVIDIA AVO's own caveat); outcome-only scoring at small n; post-hoc subset selection;
middleware thresholds tuned by issue-tracker anecdote (OpenHands' stuck detector has no
published ablation); ignoring fixture clustering in error bars.

## Revised pipeline for the semantic-loop candidate

| Stage | Cost | Concludes | Grade |
|---|---|---|---|
| 1. Shadow audit (telemetry + transcripts) | hours, zero box time | trigger precision/recall/timing on real work — kill or retune cheaply | screening |
| 2. Calibration, 3 fixtures (running) | overnight, already paid | admission bands, baseline overrun distribution, per-fixture discrimination, pairing ρ | instrument |
| 3. Mechanism screen (6 cand-arm sessions, prereg §5's) | ~2–3 h | tiers fire AND deliver through the arbiter | mechanism |
| 4. Branching study at logged trigger points (k×2 suffixes × ~10–15 points) | hours | steer effect GIVEN a loop state, paired, with noise floor | conditional adoption |
| 5. (only if a powered deployed-effect number is wanted) enriched paired A/B, sequential looks | ~1–2 days worst case | deployed effect on triggered sessions + diluted fleet estimate | adoption |

Tier-1/2 judgment adoption (Albert-approved path, prereg §5b) can sit after stage 3 or 4 with
strictly better evidence than the original plan at a fraction of the cost. Tier 3 (walls,
abort) waits for stage 5 if it is ever wanted.

One build item: the branching harness (capsule-restore → inject steer → run suffix → score),
estimated at roughly a day of work on top of the existing run-capsule/recovery machinery, plus
a fidelity check per the Replay Gap's discipline (verify prefix re-execution against logged
tool outputs before trusting a fork).

## Standing rule this adds

Before designing any future round: (1) pair by (fixture, seed) and analyze differences —
never independent arm means; (2) ask whether the mechanism has a trigger point that permits
branching instead of full sessions; (3) audit shadow data first — a round that a free offline
audit could have killed is a wasted round.
