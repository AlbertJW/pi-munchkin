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
