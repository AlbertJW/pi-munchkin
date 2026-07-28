# Handover — pi_munchkin, as of 2026-07-27

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

- **21 extensions, 30 libs, 7,084 lines.** 42 static configs on disk (incl. 5 investigation
  combos); the active roster is c25-c39 per `CANDIDATE_PRUNING_2026-07.md`.
- **Live by default:** loop-breaker, verify-gate, drift-scanner, ketch, hashline, git-guard, the
  context guards, plan-runner v3. context-watcher is passive telemetry only as of 2026-07-28.
- **Dark:** everything `cNN`, including `MICRO_GATE`.

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
- **`tsconfig` does not set `noUnusedLocals`** — dead imports survive typecheck *and* 289 tests.
  Sweep by hand after a deletion.
- **Regex surgery on structured files corrupts them.** Doing this to `context_telemetry.py` broke it
  twice today. Use explicit line ranges, or `git checkout` and start over.
- **`configuration`-mode exposure is vacuously `targeted`.** It means "config applied", *never*
  "mechanism fired". Easiest way to fool yourself here.
- **Two fixtures are floors on the 4B**: `hygiene-shared-config-reread` (0/6) and
  `sv-ambiguous-spec` (1/6). A null there could never have been anything else.
- `harness/vendor/pi-subagent/index.ts` fails a bare `node` import (imports `./agents.js` against a
  shipped `agents.ts`). **Pre-existing, not a bug** — pi's loader resolves it.

## Where to start

1. `optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md` — why the old verdicts don't hold.
2. `optimizer/docs/ADOPT_OR_RETIRE_PROTOCOL_2026-07.md` — the S1→S3 funnel and the c21 verdict.
3. `optimizer/docs/CANDIDATE_PRUNING_2026-07.md` — per-candidate history.
4. `README.md` — the harness itself.
5. `optimizer/docs/HARNESS_SELF_IMPROVEMENT.md` — the full ledger. **Has a warning banner at the
   top; heed it.**

## Open, in rough priority order

0. **Design and run the pre-registered powered round for c25 on the local 4B** (n≥20/arm,
   effort-scored, decision rule written before data — see the 2026-07-28 section of
   `CANDIDATE_PRUNING_2026-07.md` and `check-detection-floor` discipline). This is the one live
   shortlist signal; do not adopt c25 without it. Related: c38 still needs a third-model
   pass-rate datapoint before its own status settles.
1. **Verify the loop-breaker fix works in the wild.** It is live, reasoned, and unit-tested, but
   `LB_SESSION_REPEAT=25` is a p95 estimate, not a measured optimum. Watch for
   `loop-breaker/session-repeat` firing on legitimately long sessions.
2. ~~Ceremony-flag / context-watcher cleanup~~ **Resolved 2026-07-28.** `context-watcher` is now a
   passive compaction observer (0 fires in all 1,505 gate rows, 0 completions ever; pi-native
   compaction owns the job — ledger entry in `HARNESS_SELF_IMPROVEMENT.md`). The `plan-runner.ts`
   flags were assessed and deliberately kept: they back active-roster candidates with
   pre-registered 2026-09-03 win-or-retire deadlines and the pending c25/c37+c38+c39 combo.
3. ~~Gate measures a different agent~~ **Resolved 2026-07-28.** `subagent` and `write` (same
   defect, found during the fix — live sessions use both routinely) are now in the gate's
   unconditional base list (`GATE_BASE_TOOLS`), guarded against regression; each row records its
   resolved `--tools` (`harness.tools`) and `trajectory.subagent_calls`. Note: rows from before
   this date measured the narrower surface — effort comparisons across the boundary carry that
   caveat.
4. **`q4b-c21-effort-qs` stopped at 36/60 rows** — Albert halted the box deliberately. The verdict
   is already decided against adoption; finishing it is optional.
5. Five retirements proposed but **not executed** (human-gated): c43, the three investigation
   combos, c33.

## Honest caveats about this handover

- The loop-breaker fix and the plan-mode fix are **reasoned from measurement but not yet A/B'd**.
  They are defect fixes, not candidates — but "defect fix" was my judgement call.
- The first-principles triage that retired ~20 planning candidates was **mechanism reasoning, not
  measurement**. It is well-grounded but it is an argument, not a result. If you disagree, the data
  is all in `optimizer/prompt-lab/results/*.jsonl`.
- I made several mechanical errors today (dead import, corrupted file, a safety regression an
  existing test caught). Everything is green now, but treat recent commits with the same suspicion
  you'd apply to anyone's large mechanical change.
