# The optimizer is mothballed — 2026-08-03

> **SUPERSEDED OPERATIONALLY 2026-08-15 by [`UNMOTHBALL_2026-08.md`](UNMOTHBALL_2026-08.md);
> the programme parked again 2026-08-21 — see [`MOTHBALLED_2026-08-21.md`](MOTHBALLED_2026-08-21.md),
> which stops for the OPPOSITE reason (the instrument works; the subject cannot drive the harness).**
> This document remains the authoritative history of *why* the programme stopped, and every
> void-claim in it stands; the restart terms, outcomes, and admission rule now live in the
> charter and [`PREREG_FIXTURE_ADMISSION_2026-08.md`](PREREG_FIXTURE_ADMISSION_2026-08.md).

> **HISTORICAL / UNSUPPORTED ARCHIVE:** Preserve the code, raw results, methodology, and tests,
> but do not use this directory as a current recommendation engine. Recorded `NEUTRAL` labels
> predating 2026-07-27 are historical; their current interpretation is **UNTESTED**.

**Status: PARKED, not abandoned, not finished.** Nothing here is broken. `npm run verify` is
green, the harness is live and in use, and the measurement side still runs. It is parked because
the next real result costs more than it is worth right now, and this document says exactly why,
so nobody has to re-derive it.

Read this before restarting anything. If you read only one section, read **"Why it stopped"**.

---

## Why it stopped

**The instrument cannot show a win, and fixing that is a fixture problem, not a code problem.**

At n=9/arm — the round size box-hours actually allow — Fisher's exact from a 5/9 base needs a
flawless 9/9 to reach one-sided p<0.05, and from a 9/9 base a regression to 4-5/9 is detectable.
That asymmetry is the whole story: **the gate is primarily a one-sided regression detector at
these sample sizes.** It can guard against large harm but cannot establish realistic benefit.

Two things were built to break that deadlock, and both are done:

- **Graded subscores** (partial credit, so a 1/8→6/8 improvement stops reading as NEUTRAL).
  Proven on `audit-sweep`'s real grader: pristine 0/8, shortcut mutant 2/8, gold 8/8 — the two
  states the binary bit scores *identically* separate cleanly.
- **`audit-sweep`**, a graded long-horizon fixture, admitted and approved.

**Neither had ever been run against a model at mothball time.** (Update 2026-08-05:
`audit-sweep` now has its first 9 rows — base-arm on `maple-20b`, all authoritative, graded
0/8 across the board: a hard floor for that model, and end-to-end proof the graded instrument
works. The **local-4B** run — the original B2 question in `../../HANDOVER.md` — is still
unrun.)

The blocker underneath is unchanged: **no fixture sits in a 30–70% band for the two models that
matter, locally.** The 35B ceilings at 100%; the candidate 4B floors. A candidate cannot move a
number that is already pinned at either end.

## What is actually true about this corpus

- **1,839 rows across 134 result files.** The largest, most careful part of the project.
- **Zero candidates adopted.** The one change ever adopted was a *subtraction* (governor prose
  removal, 83%→89%→97%). The only statistically significant candidate result in the whole ledger
  is a **harm** (c38, −56pp, p=0.029).
- **Asking a small model to choose does not work.** 1 voluntary subagent call in 942 base
  sessions; 2 completed compactions in 1,839 rows.
- **What limits small models is repeat-call spirals, not context.** The median session uses
  ~4.9k tokens. The top 10% of sessions carry 43% of all wasted tool calls.

The last of those is the project's real finding, and it is already banked: the loop-breaker
grinding fix shipped on it and is live.

## What is NOT trustworthy, and must not be cited as-is

This matters more than the results, because a future reader will otherwise repeat the mistakes.

| claim | status |
|---|---|
| `hygiene-shared-config-reread` 0/6 is a floor | **VOID.** The gate never copied `config/`, so the hidden grader died on `readFileSync("config/schema.json")` for any model. Uncalibrated since the tree-copy fix, not a floor. |
| `sv-ambiguous-spec` 1/6 is a floor | **VOID.** Measured on a fixture that no longer exists (v3 removed the pre-implemented source, `f6318c4`). |
| `prefix_stable_rate` is a KV-cache guardrail | **BLIND** to any context-injecting candidate. Reads 1.0 against 148 lens injections. c26 and c30 both pre-register it as their guardrail. §13. |
| c21 "worse in 2 of 3 rounds" | **CHERRY-PICKED.** 7 pairings exist; per call it improves in 5 of 7, pooled −5.9%. Still Tier B — the truncation confound, not the sign, is what disqualifies it. |
| Any pre-2026-07-27 `NEUTRAL` verdict | Read as **UNTESTED**. n=3/arm detects no effect of any size. |
| "all five `block: true` sites are in plan-runner" | Wrong: 12 sites in 5 files. |
| The 40 deep-QA findings are "closed" | **True as of the 2026-08-03 judgment pass** — all 40 dispositioned (27 fixed, 2 refuted, 4 pre-corrected, 5 duplicates, 2 moot). Earlier "closed" claims predated this and were false. |

## The one-way door: the surface moved

`HARNESS_SURFACE_SHA256` is now **`e829c72dd1b8…`** (it moved three times on 2026-08-03: the
verify-gate defect fixes, then the state-bug fixes, then the judgment-pass adoptions — every
one model-visible). **Rows before and after are on different
surfaces.** Any restart re-baselines; it does not pool across that boundary. This is the single
easiest way to silently produce a wrong result here.

## If you restart: the shortest path to a real answer

Do these in order. Stop after step 2 if the answer is discouraging — that *is* a result.

1. **Run `audit-sweep` base-arm only, local 4B, n≥9.** It is graded; exit criterion: base pass
   rate + the `graded_rate` distribution. **Partially answered 2026-08-05** — run on `maple-20b`
   (not the 4B): 0/9 gate, 0/8 graded on every rep, 0/72 sub-checks — a hard floor for that
   model, with 5/9 sessions never mutating a file (ledger, `maple20b-audit-base`). The graded
   instrument itself is proven end-to-end. **The 4B run — the original question — is still
   open.** If the 4B also floors, the programme is blocked on fixture-building, not candidates.
2. **Re-calibrate `hygiene-shared-config-reread`** now that the gate copies the whole tree. Its
   0/6 was a harness artifact; it may be the in-band fixture the project spent months lacking.
3. Only then candidates. Default-on mechanisms remain reversible and mechanism-observed; benefit
   still requires a powered trial on the correct outcome.

Do **not** start by writing a new candidate. The roster has 27 configs and the binding
constraint has never been candidate supply.

**Post-mothball judgment pass (2026-08-03, later):** the roster was then dispositioned by
judgment — 3 additive candidates adopted live (c48-view, c28, c24), 5 retired on their own
pre-registered grounds (c7, c14, c32, c37, c50), the rest tiered with explicit reasoning. See
`DARK_CANDIDATE_VERDICTS_2026-08-03.md`; the surface hash moved again with the adoptions.

## What is safe to leave running

- **The harness (`harness/` → `~/.pi/agent`) is live and unaffected by this.** loop-breaker,
  verify-gate, git-guard, hashline, ketch, plan-runner v3, the context guards. Mothballing the
  optimizer does not park the agent.
- Every remaining `cNN` is **dark** by default. (Three former candidates — c48-view, c28, c24 —
  are now adopted live baseline per `DARK_CANDIDATE_VERDICTS_2026-08-03.md`; each has an `=off`
  kill switch.) Nothing else model-visible turns on by itself.
- The gate, fixtures and admission tooling all still work. `npm run verify` covers them.

## Known, accepted, documented residuals

Not defects to fix on restart — decisions already taken, recorded so they are not re-litigated:

- **`grade_artifact.py` closes decoy-at-another-name, not forgery at the pinned name.** Model
  code imported by the grader runs in the same process and can write the pinned file. Closing it
  needs the grader in a separate process; out of scope for a parked instrument. See its docstring.
- **`verify-gate` does not recognise `time npm test` or `if npm test; then …`.** Deliberate: the
  only way to match them also re-matches `grep -rn "if npm test" .`, trading a nag for a silent
  disarm. Pinned by a test.
- **A historical `~/.pi/agent` suite run reported failures.** This was a *tsx* artifact, not a defect: that
  directory has no `package.json`, so tsx transforms to CJS and every test file using top-level
  `await` fails to load. The dynamically discovered repo suite is authoritative. Adding
  `{"type": "module"}` there would fix it, but it changes how the live agent resolves modules —
  verify pi still loads before doing it. (The ledger previously blamed "incomplete dev
  dependencies"; that was wrong.)

## Where the rest of the truth lives

| file | what |
|---|---|
| `../../HANDOVER.md` | start here; state, constraints, the B1–B4 queue |
| `MEASUREMENT_METHODOLOGY_2026-07.md` | §9 invalidity boundary, §10 noise floor, §11 why three rounds gave zero information, §12 the graded instrument, §13 the `prefix_stable` blindness |
| `CANDIDATE_STRATEGY_2026-07-31.md` | §1 is the one-sided-detector argument; the tiered roster |
| `HARNESS_SELF_IMPROVEMENT.md` | the full ledger, newest entry last |
| `QA_FINDINGS_2026-07-31_UNVERIFIED.md` | 40 raw findings; fully dispositioned 2026-08-03 (reconciliation table at the top) |
| `RETROSPECTIVE_2026-07-30.md` | why the standard task set is saturated |
