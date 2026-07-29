# Pre-registration: c50 unread-spec-steer vs retry-trap

**Committed before any session of this round ran** (2026-07-29). Motivation: the retry-trap
calibration round (`c48-trap-4b`) measured a new failure class — **12/12 sessions on the 4B
found the causal file yet guessed transliteration conventions from prior knowledge instead of
reading `docs/naming.md`, which the prompt explicitly names as authoritative**. c50 is the
sensor built for exactly that class; this is its first round, and the fixture's 0/12 baseline
floor makes it the rare candidate whose plausible effect is capability-scale — so pass rate,
not effort, is pre-registered as primary.

## Design

| | |
|---|---|
| GEN | `c50-trap-4b` |
| model | `qwopus35-4b` (local) |
| arms | `baseline.json` vs `c50-unread-spec-steer.json` |
| task | `retry-trap` only |
| reps | N=9 per arm (18 sessions) |
| surface | post-registration-bundle surface (c49/c50 registered, mirrored, hash recomputed) |

## Pre-registered decision rule

**Primary**: all-sessions pass rate, Fisher's exact, one-sided (cand > base), p<0.05.
At the observed baseline floor (0/12 across both prior arms), 0/9 vs ≥5/9 clears the bar.

**Guards:**
1. *Exposure floor*: ≥7/9 cand sessions record `spec-adherence/armed` (the fixture's prompt
   names two on-disk files, so arming should be near-universal — a lower rate means the
   extractor failed, and the round is **INVALID**, not negative). Additionally ≥1 `steered`
   event must exist across cand sessions that accumulated ≥2 failing mutations; if no session
   ever met the trigger conditions, the round is **UNEXERCISED** (also invalid).
2. *Do-no-harm*: on passing sessions, `effort_report.py c50-trap-4b --only-passing` shows no
   significant adverse move on turns or tool_result_chars.

**Verdict:**
- **ADOPT-RECOMMEND** — primary significant AND both guards pass.
- **INVALID/UNEXERCISED** — guard 1 fails (fix the mechanism, re-run; no candidate verdict).
- **RETIRE-RECOMMEND (exercised, didn't help)** — `steered` fired in ≥5 cand sessions and
  cand pass rate is still 0.
- **EXTEND-ONCE** — anything else: extend to N=18/arm once, same rule, then final
  ADOPT-RECOMMEND / RETIRE-RECOMMEND with no further extension.

No post-hoc metric substitution; anything interesting outside this rule is ledger hypothesis.

## Conduct

Single round on the local box; no harness/gate/registration edits mid-round; rows must carry
the post-bundle surface hash uniformly (a surface change voids and restarts, c26-4b precedent).
