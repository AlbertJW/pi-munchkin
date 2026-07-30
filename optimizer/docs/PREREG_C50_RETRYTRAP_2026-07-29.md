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

---

## RESULT (2026-07-30): INVALID — the fixture's spec was never on disk

**Not neutral. Not a rejection of the mechanism. The round measured nothing.**

Observed: `qwopus35-4b`, retry-trap, N=9/arm — base **0/9**, cand **0/9**.
Exposure: `spec-adherence/armed` = **0**, `spec-adherence/steered` = **0**, status `unexposed`
on all 9 candidate rows.

### Why

`real_gate.sh:437-439` materializes fixtures from an allowlist (`src`, `test`, `package.json`,
`data`, `scripts`) that omits `docs/`. So `docs/naming.md` — the authoritative transliteration
spec this fixture is built around and which the prompt names explicitly — **was absent from
every session's working directory**. `spec-adherence` looks for prompt-named files that exist
on disk, found none, and correctly never armed. See MEASUREMENT_METHODOLOGY §9.

Diagnosis was by elimination, each step checked rather than assumed: the extension loads in the
live agent and registers all four handlers; `extractSpecPaths` returns `['docs/naming.md']` when
pointed at the real run directory; `SPEC_ADHERENCE=on` is correctly emitted by `config.py` into
the child env; the telemetry catalog entry is present and correctly typed; and `c48-view-35b`
recorded 148 events from the same harness on the same day, proving telemetry works. The
remaining difference was the filesystem — `docs/` has an mtime *during* the run in the candidate
dirs and is **absent entirely** from the base dirs, because the model created it itself.

### The premise this retracts

The pre-registration justified c50 with: *"retry-trap: 12/12 sessions on the 4B edited the right
file with invented mappings while `docs/naming.md` sat unread."*

**That is withdrawn.** The models did not leave an available spec unread — the harness never
put one there. They invented mappings because inventing was the only option. The observed
behaviour was a harness artifact wearing the costume of a model failure, and it is exactly the
kind of story that is easy to believe because it flatters the candidate you already want to
build.

Compounding it: `docs/naming.md` deliberately specifies `ä å → a` and `ö ø → o`, contradicting
the usual German `ae`/`oe`. A model reasoning from convention is *guaranteed* to fail. That is
the trap working as designed — but only when the spec is readable.

### Disposition

- c50 `spec-adherence` returns to **queued, unmeasured**. Its mechanism is untested, neither
  supported nor refuted. Do not count this round against it.
- Re-run after the materialization fix lands, on the same pre-registered thresholds.

> **AMENDED 2026-07-30 — this disposition was wrong and would have wasted the re-run.**
> It originally said *"No changes to the candidate or the prereg are warranted by this round"*,
> and the diagnosis above certified that *"the extension loads in the live agent and registers
> all four handlers."* **Registering a handler is not the same as the handler working.** A deep
> QA then found that `spec-adherence.ts` read `event.args` on `tool_execution_end`, and pi puts
> `args` on `tool_execution_start`/`_update` but **not** on `_end` — it builds each event
> explicitly (`agent-session.js:487-514`). Read-detection was therefore **dead code from the
> start**: `readSpecs` could only ever be filled by the post-steer self-mark, so the steer
> degraded into an unconditional "you have not read this" nag after two failing mutations —
> false whenever the model *had* read the spec, and it would still have stamped
> `spec-adherence/steered`, making the round read as properly exposed while measuring an
> entirely different treatment. Fixed the same day (carry args from `_start` keyed by
> `toolCallId`); both widening `as` casts deleted, since the cast is what hid this from `tsc`.
> **Precondition for the re-run: that fix must be mirrored to `~/.pi/agent` and present in the
> surface hash.** Verify `spec-adherence/armed > 0` on the candidate arm before reading any
> delta — an unexposed round is still not a result.
- Check the base arm's pass rate on the re-run **before** reading any delta: if base is still
  ~0/9 with the spec present, the fixture is too hard for the 4B and the round is powerless for
  a different reason (see `check-detection-floor` discipline).
