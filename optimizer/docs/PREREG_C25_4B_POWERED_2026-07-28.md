# Pre-registration: powered c25 round on the local 4B

**Committed before any session of this round ran.** Written 2026-07-28, following the
c25-on-4B shortlist signal (`combo3-c25-4b`: pass 5/9→7/9, all five effort metrics
directionally better, tool_result_chars −44% p=.030 on passing sessions). That result is
c21-shaped — first-round promise, post-hoc metric attention — and this document exists so
the follow-up cannot be read flexibly after the numbers arrive.

## Design

| | |
|---|---|
| GEN | `c25-4b-powered` |
| model | `qwopus35-4b` (local Mac entry — NOT the remote `-mtp` twin) |
| arms | `baseline.json` vs `c25-c38-c39-combo.json` (as committed in `cc71303`) |
| tasks | `parens`, `equil`, `bigdata` (standard set) |
| reps | **N=20 per task per arm** → 60 sessions/arm, 120 total |
| surface | post-2026-07-28 gate surface (`GATE_BASE_TOOLS` incl. subagent+write, both arms) |

## Power basis (computed before the round, from `combo3-c25-4b` passing rows)

Bootstrap resampling (2,000 draws, seed 20260728, Mann-Whitney normal-approx, α=0.05) of the
observed passing-session distributions:

| metric | power @ 20 passing/arm | @ 30 | @ 40 |
|---|---|---|---|
| tool_result_chars | ~100% | ~100% | ~100% |
| turns | 55% | 68% | 81% |

At N=20 reps/arm/task and the observed ~55–100% pass band, expected passing sessions/arm is
≈40+, giving ≥81% power on `turns` and saturated power on `tool_result_chars` — **if the
observed effect is real**. Caveat, stated up front: resampling from 12 observed points
overstates certainty; that is exactly why the decision rule below has an insufficient-effect
branch rather than "extend until significant".

## Pre-registered decision rule

**Primary metric**: `tool_result_chars` on passing sessions (`effort_report.py
c25-4b-powered --only-passing`), Mann-Whitney, two-sided p<0.05, direction: cand lower.

**Secondary (supporting, not required)**: `turns`, same test.

**Guards (both required for any positive verdict):**
1. *Do-no-harm*: cand all-sessions pass rate not significantly worse than base
   (Fisher's exact, one-sided, p<0.05).
2. *Exposure floor*: ≥50% of cand sessions show the mechanism exercised
   (`plan-runner/subagent-only-block` ≥ 1 **or** `trajectory.subagent_calls` ≥ 1).
   If the floor fails, the round is **INVALID** (mechanism unexercised) — not a negative.

**Verdict:**
- **ADOPT-RECOMMEND** — primary significant in the right direction AND both guards pass.
  (Adoption itself remains human-gated; this round only earns the recommendation.)
- **RETIRE-RECOMMEND** — primary significant in the wrong direction, OR guard 1 fails.
- **EXTEND-ONCE** — primary not significant and no retire condition: extend the same GEN by
  N=20 further reps/arm/task (total 40) exactly once, then re-apply this rule. If still not
  significant: **RETIRE-RECOMMEND (insufficient effect)** — no second extension, no metric
  substitution, no post-hoc subgrouping.

No other outcome may be claimed from this round. Anything interesting outside the rule goes
to the ledger as hypothesis for a future pre-registered round.

## Conduct constraints

- Single round on the local box; nothing else runs against llama-swap while it runs.
- No harness or gate edits during the round (`HARNESS_SURFACE_SHA256` binds rows; editing
  `real_gate.sh` mid-run corrupts the running script).
- Rows appended by extension (if EXTEND-ONCE fires) must carry the identical surface hash and
  config shas; a surface change during extension voids the round.

## Conduct addendum (2026-07-29, before any further rows)

The round was operator-paused at 2 rows on 2026-07-29 (box needed for model work). Those 2
rows were then **deleted** rather than resumed: a same-day gate-surface change (`--no-skills`,
closing the unhashed-skills provenance gap) means resumed rows would mix surfaces under one
GEN — the exact confound the c26-4b precedent forbids. The round restarts from zero,
unchanged in design, when the box frees up. The decision rule above is untouched.

---

# RESULT (2026-07-30): INVALID — exposure floor failed; effect absent at high power

Round completed 120/120 rows, all authoritative, all `complete`, single uniform surface hash
(`37fad84abd8d…`). Rule applied mechanically, guards first.

## Guards

| guard | threshold | measured | outcome |
|---|---|---|---|
| Exposure floor | ≥50% of cand sessions with `subagent-only-block`≥1 **or** `subagent_calls`≥1 | **25/60 = 41.7%** (by task: parens 7/20, equil 7/20, bigdata 11/20) | **FAIL** |
| Do-no-harm (pass) | cand not significantly worse | base 56/60 (93%) vs cand 57/60 (95%), p=0.781 | pass |

Per the pre-registered rule, a failed exposure floor makes the round **INVALID (mechanism
unexercised)** — *not* a negative verdict on c25. Mechanism did engage substantially (24
blocks, 133 delegations, 341 `plan_write` calls, zero `go-blocked`), just below the line I
committed to before seeing data. The line stands.

## Primary metric, recorded for the record (NOT a verdict — guard failed first)

`effort_report.py c25-4b-powered --only-passing` (base n=56, cand n=57):

| metric | base | cand | change | p |
|---|---|---|---|---|
| turns | 18 | 16 | −11% | 0.739 |
| tool_calls | 17 | 15 | −12% | 0.679 |
| tool_errors | 4 | 3 | −25% | 0.675 |
| repeat_calls | 3 | 3 | +0% | 0.912 |
| **tool_result_chars** (primary) | 5742 | 4963 | **−14%** | **0.665** |

**The shortlist signal did not replicate.** The 2026-07-28 round reported −44% at p=0.030 on
n=5-vs-7 passing sessions; at n=56-vs-57 the same metric moves −14% at p=0.665. Directionally
consistent, statistically absent, and an order of magnitude more powered.

## The load-bearing discovery: the "discriminating band" was a sampling artifact

Base pass rate on this task set, same model, same config:

| round | base pass |
|---|---|
| `combo3-c25-4b` (2026-07-28, n=9) | 5/9 = **56%** |
| `combo3-c37-4b` (2026-07-28, n=9) | 9/9 = **100%** |
| `c25-4b-powered` (n=60) | 56/60 = **93%** |

The 4B's true pass rate on parens/equil/bigdata is ~93%. The 5/9 that made c25 look like it
was operating in a discriminating band was a low draw, and the 5/9→7/9 "pass improvement" was
noise around a saturated ceiling. This is `MEASUREMENT_METHODOLOGY_2026-07.md` §3 (variance is
the binding constraint) demonstrated on our own most-promising candidate — and it is exactly
why the powered round was worth 11 hours of box time even though it produced no adoption.

## Disposition

- **c25 is NOT adopted and NOT retired.** Its 2026-09-03 win-or-retire clock continues.
- **Do not re-run this design.** parens/equil/bigdata is saturated for the 4B (93% base
  ceiling): no pass-rate effect is detectable, and the effort effect is now bounded well below
  the shortlist estimate. Any future c25 round needs the discriminating-band fixtures
  (`retry-trap`, `access-log-triage`, `sv-convention-provenance`) or a harder task set.
- **Methodology note for the ledger**: an exposure floor set from a 9-session pilot is itself
  a noisy estimate. Future floors should be stated as "mechanism engaged in ≥1 session per
  task" plus an absolute event count, not a session percentage calibrated on n=9.
