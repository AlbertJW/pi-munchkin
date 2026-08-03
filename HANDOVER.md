# Handover — pi_munchkin, as of 2026-08-03

> ## ⏸ THE OPTIMIZER IS MOTHBALLED (2026-08-03)
> Read **`optimizer/docs/MOTHBALLED_2026-08-03.md` first.** It states why it stopped, which
> published numbers are void, the one-way surface change, and the shortest path back to a real
> answer if you restart. Nothing is broken and `npm run verify` is green — the measurement side
> is parked because the next result costs more than it is worth, not because it failed.
>
> **The harness is NOT parked.** `harness/` → `~/.pi/agent` is live and in daily use. Everything
> below still applies to it.

You are picking up a harness + measurement project for making small local LLMs competent
multi-turn coding agents. **Read this before touching anything**, because the project's own
documentation was wrong in an important way until today, and some of it still reads as if the old
story were true.

## The one thing you must internalise

For months this project ran A/B rounds, got `NEUTRAL` verdicts, and concluded its candidate
interventions didn't work. **That conclusion was unsupported.** A 2026-07-27 audit of all 1,505
recorded sessions found:

- **n=3/arm** (the 34-candidate sweep) — Fisher's exact detects **no effect of any size**. n=9 needs
  **+56pp**. No harness change delivers that. Most `NEUTRAL`s were guaranteed before the round started.
- The outcome scored was **pass/fail** (capability). Nearly every candidate targets **efficiency**.
  Those come apart completely.
- **40 of 45 candidates could not prove their mechanism fired**, so `NEUTRAL` was indistinguishable
  from "never engaged". 53 of 68 mechanism counters read identically zero.

So: **the dark-candidate roster is a backlog of UNTESTED ideas, not rejected ones.** Any ledger entry
predating 2026-07-27 that says `NEUTRAL` should be read as `UNTESTED`.

Full write-up: `optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md`. Read it first.

## What actually limits a small model (measured, 1,505 sessions)

| | median | p90 | p99 | max |
|---|---|---|---|---|
| turns | 11 | 33 | 89 | 203 |
| tool errors | 3 | 12 | 34 | 150 |
| context tokens | 4,908 | 19,425 | 43,779 | 47,832 |

**Context is not the constraint** — the median session uses ~4.9k tokens and the governor is 6.9%
of that. Optimising prompt size is optimising a rounding error.

**Repeat-call spirals are.** Errors in the longest decile: median 14; shortest half: 1. Repeat calls
track errors ~1:1 in the tail. **The top 10% of sessions carry 43% of all 7,673 wasted tool calls.**

Use this to triage ideas: an intervention that adds turns or context to a model failing from too
many turns and too much context is wrong by construction, however well it measures.

## Repos

| path | what | pushed? |
|---|---|---|
| `~/pi_munchkin` | source of truth, **public** GitHub `AlbertJW/pi-munchkin` | yes |
| `~/.pi/agent` | the live harness Albert actually uses; own local git | **never push** |
| `~/LLM` | serving launchers, model zoo | — |

`harness/` mirrors into `~/.pi/agent` (reverse-sync). After any harness edit, copy the changed files
across and confirm zero drift — a gate round binds `HARNESS_SURFACE_SHA256`, so drift silently
invalidates provenance.

## State today

- **25 extension files, 30 libs.** 36 static configs on disk (incl. 2 investigation combos);
  exposure modes 24 telemetry / 9 configuration / 2 suppression / 1 none. Counts re-derived
  from disk 2026-07-31 (were "21 extensions / 42 configs / 5 combos" — stale since the
  `6192559` and `166e94d` deletions).
- **Roster truth is `optimizer/docs/CANDIDATE_STRATEGY_2026-07-31.md`**, not the roster table in
  `CANDIDATE_PRUNING_2026-07.md`, which is a 2026-07-28 snapshot kept as history. The strategy
  doc supersedes the "active roster is c25-c39" framing: the binding constraint is that at
  n=9/arm the gate can only detect harm, so no candidate is rankable on outcome until graded
  scoring and an in-band fixture exist.
- **Live by default:** loop-breaker, verify-gate, drift-scanner, ketch, hashline, git-guard, the
  context guards, plan-runner v3. context-watcher is passive telemetry only as of 2026-07-28.
- **Dark:** everything `cNN`, including `MICRO_GATE`.
- **Harness surface `0b37a62371f7…`** as of 2026-08-03 (moved — see below). `npm run verify` is
  green at 346 harness tests + 16 optimizer, plus the optimizer battery. The `~/.pi/agent` mirror
  is zero-drift, and its own suite runs 283 tests with **8 failures that are a tsx artifact, not
  defects**: that directory has no `package.json`, so tsx transforms to CJS and every test file
  using top-level `await` fails to load (`Top-level await is currently not supported with the
  "cjs" output format`). The repo suite is authoritative. (This entry previously blamed
  "incomplete dev dependencies" — measured 2026-08-03, that was wrong.) Verify a mirror by
  diffing the failure-set *by name* before and after, never by counting passes.

### Landed 2026-08-03 (5 commits, `51b8792`..`e5ad6a7`) — instrument fixes

> **THE SURFACE HASH MOVED to `0b37a62371f7…`.** The verify-gate fixes below are model-visible
> (defect fixes, so no `cNN` flag). Rows written before and after are on **different surfaces**:
> re-baseline before the next round and do not pool across the boundary.

The 2026-07-31 deep QA left 40 findings whose refuters all died on a session limit. Nine were
verified by hand that day; the remaining ten instrument-class ones were checked by three agents
on 08-03 — **8 real and fixed, 1 refuted, 1 sub-claim refuted**. A later judgment pass closed
the balance: of the "21 unexamined", content-matching showed 4 already corrected, 5 duplicate
twins of fixed defects, 2 moot, and 10 genuinely open — all 10 fixed 2026-08-03. **All 40 are
now dispositioned**; the reconciliation table is at the top of
`QA_FINDINGS_2026-07-31_UNVERIFIED.md`.

1. **`verify-gate` had two disarm defects, both live in every gate round, both untested.**
   `buildRe()` appended the detected gate command outside the command-position group — `|` has
   the lowest precedence, so the branch had no anchor and `echo "Run npm test to verify" >>
   README.md` armed and disarmed the gate in one turn. And `VERIFY_COMMAND_RE` listed `test\b`
   first, so the POSIX file-test builtin (`test -f dist/app.js && echo ok`) counted as a suite.
   `harness/tests/verify-gate.test.ts` is new; there was **zero** coverage before.
2. **The graded artifact is now pinned by the manifest** (`tests.fail_to_pass.grade_artifact`),
   not found by globbing `.*-grade.json` and taking `sorted()[0]` out of a model-writable
   workdir. Ambiguity is a refusal (`subscores_blocked` on the row), never a pick.
   `prompt-lab/grade_artifact.py` is the single extraction; `integrity_selftest` calls it instead
   of its own copy. `rm -f` before grading would NOT have closed this: `node --test` runs outside
   the sandbox and imports model-authored `src/`, so model code runs during grading.
3. `loop-breaker` drops its steer anchor on `agent_start` (turnIndex is not monotonic — pi zeroes
   it on retry and compaction, so `turns_since` went negative); `plan-runner` clears
   `__pi_active_plan_context` on `session_start`; the static half of the reserved-envelope-field
   guard landed.
4. **Two of this project's own claims were wrong and are corrected.** The c21 entry cited 3 of 7
   base/cand pairings and all four it omitted favoured c21 — per tool call it improves in **5 of
   7, pooled −5.9%**. Tier B is unchanged (the truncation confound disqualifies it, not the sign).
   And `prefix_stable_rate` **cannot see a context-injecting candidate** — it reads 1.0 while the
   lens breaks the serving prefix every call, and c26/c30 both name it as their guardrail
   (METHODOLOGY §13).

### Landed 2026-07-28 (4 commits, `7ad9fbc`..`9c82acf`)

1. **context-watcher demoted to passive observer** — 0 fires in 1,505 gate rows, 0 completions
   ever; pi-native compaction owns the job (`reserveTokens` 4096→16384 in live settings).
2. **The gate now grants the live surface**: `subagent` + `write` unconditional both arms,
   `harness.tools` + `trajectory.subagent_calls` recorded per row, base-surface guard fails
   closed. Pre-2026-07-28 rows measured the narrower surface — comparability caveat in the ledger.
3. **Three-way combos built and run** (35B + local 4B): delegation cluster activates at last.
   c25-on-4B is the live shortlist signal (needs a pre-registered n≥20 round); c37 0-for-2 with
   adverse effort; 1 voluntary delegation in 36 baseline sessions across 3 models.

### Landed 2026-07-27 (14 commits, `d09ab1d`..`d3c61c4`)

1. **`64103be` loop-breaker grinding fix (the important one).** `resetEpisode()` fired on *any*
   progress — including a turn with **no tool calls** — so `fail, fail, fail, one edit, repeat`
   never tripped a tier. It caught stalls, never grinding. 8 of the 24 worst sessions **passed**
   while burning hundreds of repeats. Added a session-cumulative counter (`LB_SESSION_REPEAT`,
   default 25) that `resetEpisode()` does not clear. **Shipped live** — defect fix, 43% of waste.
2. **`f366cf9` deleted the v4 planner** — 2,832 lines whose 21 telemetry counters read zero across
   1,465 sessions. It also removed a `registerPlanV4` dispatch that **returned early**, so a
   `schema_version: 4` file on disk could silently divert the whole extension onto an unmeasured path.
3. **`d3c61c4` plan mode stopped blocking investigation.** Real failure: a session needed to count
   ~200 files to size its plan, was blocked 5×, gave up. `command-policy.ts` contradicted itself —
   `CMD_POS` treats `-exec ` as a command position, but a blanket rule made *any* `find -exec`
   mutating, so `find … -exec grep` was blocked while `find … | xargs grep` was allowed. Also added
   tool steering to the plan prompt and a block message that names the alternative.
4. **`5046398`/`d256131` exposure on all 45 candidates** — 28 telemetry, 15 configuration,
   2 suppression. Plus `real_gate.sh` now *imports* `exposure.py` instead of duplicating its logic.

### c21-micro-gate: rejected, and it matters why

The most promising candidate in the catalogue — ranked #1 **and** #2 by the effort sweep, 7/7
metrics better at n=20 on `parens` (tool_errors −64%, repeat_calls −75%). On its second task it
managed **4/7**, with input tokens *significantly worse* (+72%, p=0.038), pass rate down on both.

It **fails** the rule pre-registered in `ADOPT_OR_RETIRE_PROTOCOL_2026-07.md` a day before the
numbers existed. It stays dark. Do not adopt it without new evidence — and note that the previous
agent (me) spent a day arguing it was the one thing that worked. Pre-registration is the only reason
this reads as a rejection.

## Tools you'll want

- `optimizer/prompt-lab/effort_report.py <gen>` — score a round on continuous per-session effort
  (turns, tool_calls, tool_errors, repeat_calls, tokens), exact Mann-Whitney with a normal-approx
  fallback above n≈9. `--only-passing` removes the failed-run length confound. `--sweep` re-scores
  every paired round — **a shortlist generator, not findings** (~650 comparisons).
- `optimizer/real_gate.sh` — the gate. `--dry` previews. `--exploratory` for unapproved fixtures.
- `npm run verify` — tests + typecheck + health + pack smoke + optimizer battery. Must be green.

## Standing constraints (non-negotiable)

- **Never echo `LLAMA_API_KEY` or any credential.** Secret-scan every diff for `sk-44a024`,
  `172.16.16.122`, `csk-`, `Bearer sk-` before pushing.
- **The repo is public** and `172.16.16.122` is *already in its pushed history* since 2026-07-13
  (17+ commits). Don't add more; scrubbing would need `filter-repo` + force-push.
  Note `git grep origin/main` searches the **tree**, not history.
- **Single-slot serving.** One gate round per box at a time. Local `127.0.0.1:8080` and remote
  `172.16.16.122:8080` are separate boxes and may run concurrently.
- **Adoption and deletion are human-gated.** Prepare the diff; Albert decides.
- **Model-visible changes ship dark** behind an env flag + numbered `cNN` config, unless they are
  defect fixes.
- **Never edit any `context-pressure*` file.**
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Gotchas that cost real time

- **Editing a running bash script corrupts it.** `real_gate.sh` is read by byte offset; editing it
  mid-round can make bash seek into shifted bytes. Kill and relaunch instead.
- **`tsconfig` does not set `noUnusedLocals`** — dead imports survive typecheck *and* 345 tests.
  Sweep by hand after a deletion.
- **A regression test that passes is not yet evidence.** Revert the fix and confirm the test goes
  red, every time. Four guards shipped vacuous this week — three found by others, one of mine
  found only by running the counterfactual (a six-turn loop-breaker sequence reached tier 3,
  whose abort cleared the very state under test, so the test passed with the fix removed).
- **Regex surgery on structured files corrupts them.** Doing this to `context_telemetry.py` broke it
  twice today. Use explicit line ranges, or `git checkout` and start over.
- **`configuration`-mode exposure is vacuously `targeted`.** It means "config applied", *never*
  "mechanism fired". Easiest way to fool yourself here.
- **The "two floors on the 4B" are NOT floors — both readings are void.** This entry used to say
  `hygiene-shared-config-reread` (0/6) and `sv-ambiguous-spec` (1/6) could never have been
  anything else. In fact the 0/6 came from the gate never copying `config/`, so the hidden grader
  died on `readFileSync("config/schema.json")` for any model (`MEASUREMENT_METHODOLOGY` §9 forbids
  carrying that pass rate forward), and the 1/6 predates the v3 rebuild that removed the
  pre-implemented source (`f6318c4`). Both are **uncalibrated** since the tree-copy fix. Either
  could be an in-band venue; nobody has looked.
- `harness/vendor/pi-subagent/index.ts` fails a bare `node` import (imports `./agents.js` against a
  shipped `agents.ts`). **Pre-existing, not a bug** — pi's loader resolves it.

## Where to start

1. `optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md` — why the old verdicts don't hold.
   §9 invalidity boundary, §10 noise floor, §11 why three rounds yielded zero information,
   §12 the graded instrument, **§13 why `prefix_stable` cannot be trusted as a guardrail**.
2. `optimizer/docs/CANDIDATE_STRATEGY_2026-07-31.md` — the tiered roster and, in §1, the single
   most important fact about this instrument: at n=9/arm the gate detects harm and almost
   nothing else.
3. `optimizer/docs/ADOPT_OR_RETIRE_PROTOCOL_2026-07.md` — the S1→S3 funnel and the c21 verdict.
4. `optimizer/docs/CANDIDATE_PRUNING_2026-07.md` — per-candidate history (2026-07-28 snapshot).
5. `README.md` — the harness itself.
6. `optimizer/docs/HARNESS_SELF_IMPROVEMENT.md` — the full ledger. **Has a warning banner at the
   top; heed it.**
7. `optimizer/docs/QA_FINDINGS_2026-07-31_UNVERIFIED.md` — raw QA output. Read its disposition
   table first: 19 of 40 examined (17 fixed, 2 refuted), **21 never examined**.

## The route (2026-07-29 — ordered by evidence-per-box-hour)

> **2026-07-30 re-aim:** read `RETROSPECTIVE_2026-07-30.md` before adding any candidate. The
> standard task set is SATURATED (4B base 93%); pass-rate neutrals there measure the fixtures,
> not the candidate. Instrument v2 (graded subscores, `audit-sweep` long fixture, calibrated
> quality judge) and the graded HARNESS-ROI round supersede further candidate rounds on the
> old set. Candidate admission now requires an observed failure class with a named sensor gap.

**Strategy invariants:** box-hours are the scarce resource — spend them only on
decision-grade (pre-registered) rounds; fixtures are the instrument factory — the current set
caps what any candidate can show (35B saturates at 100%, two 4B floors, no spiral inducer, no
large-repo task); the live env is now a free telemetry stream for dark candidates armed live
(c48) — use it for mechanism evidence, NEVER for adoption verdicts; WIP limit — no new
candidates until c25 and c48 resolve.

### Track A — fixture platform sprint (box-free, start now)
1. **Spiral fixture** (unlocks c48's gate round): a task whose natural failure mode is
   naive-retry looping — model it on the loop-breaker tail sessions (the 36- and 29-repeat
   grinders are the templates). Through `fixture_admission.py`; pre-register calibration.
2. **Approve the two calibrated fixtures already built** (`access-log-triage`,
   `sv-convention-provenance`, built 2026-07-24, never approved) — they unlock discriminating
   rounds for c26/c27/c29 and c31/c32.
3. **Large-repo navigation fixture** (explorer blocker 2): dozens of files, answer requires
   locating something — the fixture where delegation/c25 SHOULD pay off most, and the
   prerequisite for ever measuring span-tools (c13) or a repo map.

### Track B — THE BOX QUEUE (strict order; one item mid-GEN at a time)

> **REPLACED 2026-07-31. Items 1-6 below are DONE or SUPERSEDED — kept only as history.**
> All three rounds in the old queue ran and produced **zero information** (METHODOLOGY §11);
> the registration bundle (item 4) landed; c50's premise was retracted and its mechanism was
> dead code. Do not work this list.
>
> **The queue is now instrument-first, because no candidate round can return a positive result
> until it is done** (METHODOLOGY §12 / `CANDIDATE_STRATEGY_2026-07-31.md` §1: at n=9/arm the
> gate detects harm and essentially nothing else).
>
> **Before B1: the surface changed on 2026-08-03** (`0b37a62371f7…`). Every pre-08-03 row is on
> the old surface, so the B1/B2 base rates must be collected fresh — do not compare them against
> the historical `sv-convention-provenance` 3/6 as if it were the same instrument. The graded path
> B2 exercises also changed: `subscores` now requires the manifest's `grade_artifact` pin, and a
> row that could not resolve it carries `subscores_blocked` instead of silently having no
> subscores. Check that field before concluding a round is ungraded.
>
> **B1. Re-run `sv-convention-provenance` on the local 4B, base arm, n≥20.** CORRECTED
> 2026-07-31 after the QA: this is already an in-band LOCAL venue (3/6 = 50%), and its rows are
> non-authoritative only because the fixture was **unapproved when they were collected**
> (`authority_reason: "missing expiry"`). It has been approved since 2026-07-29. Re-running it
> today produces AUTHORITATIVE in-band rows — no new fixture needed. Exit: a base rate at n≥20
> confirming the band holds (3/6 is one flipped session from 33% or 67%).
> **B2. Run `audit-sweep` once, base-arm only, on the local 4B.** It is graded, has NEVER been
> run (0 rows), and its band is unknown. Cheap, and the only way to learn whether the graded
> instrument has a fixture that exercises it. Exit: base pass rate + `graded_rate` distribution.
> **B3. Judge rubric + calibration** (task #12) — code quality, which subscores do not capture.
> Calibrate gold > shortcut on existing fixtures BEFORE trusting it.
> **B4. Then, and only then, candidates** — c48 first (additive, so it cannot produce the harm
> signature; an authoritative round already exists and was informationless only because its
> fixtures were one floor plus two ceilings), then c21 **re-specified** with errors-per-call as
> the pre-registered primary and a fixed turn budget.
>
> Re-baseline the noise floor with an inert positive control (c49's shape, or c9's) whenever the
> instrument changes.

Standing rules: docs commits are always safe; harness commits are safe; `~/.pi/agent` mirror,
`configs/schema.json`, `config.py`, and `configs/static/` changes only BETWEEN rounds.

1. **(running)** `c25-4b-powered` chain + `c38-solo-35b` — exit: mechanical verdicts written
   per `PREREG_C25_4B_POWERED_2026-07-28.md`; c38's third-model answer recorded.
2. `c48-view-35b` — STATE_LENS=view on the DD, retry-trap + standard set, N=6/arm,
   exploratory — exit: injection rate + directional effort read on a non-floored model.
3. **payload-audit runs** — one interactive-style + one gate-style session with
   `PAYLOAD_AUDIT=on` — exit: wire-truth report in the ledger; thinking-replay branch decided
   (spawns a c51 view-trim candidate OR a context-estimate correction fix).
4. **Registration bundle** (c49/c50 configs + schema/config.py knobs — verbatim in
   `CANDIDATE_PRUNING_2026-07.md`) → verify → commit → mirror + zero-drift.
5. `c50-trap-4b` — per `PREREG_C50_RETRYTRAP_2026-07-29.md` (mechanical verdict; pass-rate
   primary against retry-trap's 0/12 floor).
6. `c49-nat-35b` — exploratory occurrence/revival round for tool-call-rescue (N=9/arm,
   standard tasks, DD); prereg a powered round only if the artifact rate supports one.
7. **c25 follow-through** — adoption or retirement diff per its prereg verdict (human-gated),
   c37's 2026-09-03 clock, and the September win-or-retire sweep for the legacy queue.

### Track C — continuous, free
- Live lens telemetry review (c48 armed live): `state-lens/*-injected` counts, spiral stats
  before/after arming — mechanism evidence only. Loop-breaker `session-repeat` watch
  continues (healthy at 25).
- Cockpit friction notes from real use feed the tldraw v2 decision.

### Track D — scheduled decisions
- **2026-09-03 win-or-retire deadlines** (c26/c27/c29/c30/c31/c32/c34/c35/c36/c37): Track A+B
  give each a fair shot first; whatever hasn't won retires mechanically. c37 already has two
  adverse rounds on record; its retirement diff shape is drafted in
  `CANDIDATE_PRUNING_2026-07.md`.
- **Assistant-duty baselines** (ChatGPT-replacement tie-in): when Albert picks the box's chat
  LLM, run its baseline on the standard set (exploratory) to seed spiral/delegation data for
  the model that will actually serve chat; blackboard cockpit + lens are already built for
  that duty.

## Honest caveats about this handover

- The loop-breaker fix and the plan-mode fix are **reasoned from measurement but not yet A/B'd**.
  They are defect fixes, not candidates — but "defect fix" was my judgement call.
- The first-principles triage that retired ~20 planning candidates was **mechanism reasoning, not
  measurement**. It is well-grounded but it is an argument, not a result. If you disagree, the data
  is all in `optimizer/prompt-lab/results/*.jsonl`.
- I made several mechanical errors on 2026-07-27 (dead import, corrupted file, a safety regression
  an existing test caught). Everything is green now, but treat recent commits with the same
  suspicion you'd apply to anyone's large mechanical change.

**Added 2026-08-03:**

- **The instrument fixes are unmeasured by construction.** All eight are defect fixes with
  counterfactual-checked regression tests, but no A/B round has run on the new surface. "The
  gate now measures what it claims to" is a reasoned assertion, not a result.
- **21 of the 40 QA findings have never been examined.** They are not "clean" — they are
  unread. Two of the ten that were examined turned out to be wrong, so expect roughly half of
  the remainder to evaporate, and expect the other half to be real.
- **The c21 correction was itself a cherry-pick, and I wrote both versions.** The first cited
  the 3 pairings that made it look worst; there are 7. That is the second time in this project
  a confident summary survived because nobody counted the cells. Count the cells.
- **`prefix_stable` was believed to be a working guardrail for months.** It is not, for any
  candidate that injects context — and c26 and c30 both pre-register it as theirs. Nothing
  downstream of that has been re-examined.
