# Harness audit and repairs — 2026-09-10

## Scope and conclusion

Bottom-up pass — lib → extension → integration → optimizer → cross-cutting — followed
by a definitive disposition of every dark candidate, plus a completed retirement batch.
This is a source audit and offline verification receipt, not a claim of exhaustive
security review or live model effectiveness; it follows the same posture as
`HARNESS_AUDIT_2026-09-06.md`, which this pass treats as its baseline.

The strongest findings were a real, reproducible race (two continuation receipts for
one lifecycle boundary) and a fully mechanical retirement backlog five weeks
overdue on its own paperwork. Both are repaired below with failing-before,
passing-after evidence. Three consumers of a moved config file were only found by
running `verify:optimizer` after the move — grepping for the literal joined path
string missed all three, because each builds the path from separate segments; this
is recorded as a process lesson, not just a fix.

## Repairs

| Area | Reproduced problem | Result |
|---|---|---|
| Continuation ownership | A pending `compact_context` resolves its own continuation asynchronously, after its tool call returns; `plan-runner`'s `agent_end` handler offers a competing goal continuation for the same turn synchronously. Under real timing the two land in separate arbiter flushes and both dispatch — two receipts for one lifecycle boundary, reproduced 1/40 runs | `offerGoalContinuation` defers to `currentCompactionOwner()` (the existing cross-extension compaction-coordinator signal) while a compaction is in flight; 0/60 under the same loop after the fix |
| Test-runner hangs | A pre-fix dev run of `preserveContextSections` (the infinite spin itself already fixed in `8cd551c`) left three `node --test` children orphaned at PPID 1, ~80% CPU each, for 3 days — `run-tests.mjs`'s `spawnSync` and `plan-graph.integration.test.ts`'s child spawns had no wall-clock ceiling, so a hang could not fail, only linger | `spawnSync` gets a 900s hard timeout (SIGKILL) plus `--test-timeout=120000` per test; the 4 `execFileSync` child runners get a 120s timeout; the one `spawn` gets `unref()` + a SIGTERM→SIGKILL escalation. A hang now fails the build in minutes instead of running for days |
| ADR-0006 status | Read `proposed` since 2026-07-24, but its own promotion condition — a real graduation or retirement having executed — was satisfied 2026-07-29 by the c33-subagent-fork-default retirement (`6192559`, `50f21d9`). The status field was never updated; two later audits (this session's own earlier draft included) repeated the "never executed" claim without checking | Promoted to `active`; the record now states the actual history. Checklist extended with a third, "value/mode-field retirement" list for candidates that are one value of a multi-value schema field rather than their own boolean gate |
| Dark-candidate backlog | Four candidates had reached their own recorded end state (dead code, or an explicit retire verdict) but never had the schema/`real_gate.sh` paperwork finished — `PLAN_TOOL_GO` (c39, zero remaining clients since 2026-08-12), `PLAN_UNCERTAINTY` (c31) and `PLAN_ITEM_GUIDANCE_V2` (c34) (code gates deleted by the 2026-08-24 planning refactor, `dbf90f4`, schema/gate paperwork left behind), `LOOP_EPISODE_MODE=enforce` (register verdict: retire the hypothesis) | All four retired per ADR-0006 (mechanics in `optimizer/docs/archive/CANDIDATE_RETIREMENTS_2026-09.md`); `retired-surface.test.ts` extended and enforces it going forward. One dedicated test (`plan-graph.integration.test.ts`'s "ordinary subagent startup never reclaims a parent research lease") called the now-deleted `plan_go` tool directly — found only by running the suite, not by the earlier grep sweep — and is corrected to assert the surviving `/plan-go` command's rejection instead |
| Judgment-adoption paperwork | `FORCE_PLAN_WRITE` (`41ab87b`) and `VERIFICATION_PLATEAU=enforce` (`079cc9b`, both 2026-08-24) were adopted by judgment in kill-switch form but never formally recorded as distinct from a full ADR-0006 graduation. An earlier draft of this very record cited the wrong commit (`d971638`, an unrelated telemetry fix) for the `VERIFICATION_PLATEAU` flip — caught by re-deriving it from `git log -S` against the actual code change, not trusted from the first citation | Recorded in `optimizer/docs/DARK_CANDIDATE_VERDICTS_2026-09-10.md` with verified commit SHAs; both kill switches and schema fields are explicitly retained, not removed |
| Retired-config fallout | Moving `configs/pending/semantic-loop-enforce.json` to `configs/retired/` (bytes unchanged) broke two optimizer scripts that hardcode its old path from separate string segments (`os.path.join(HERE, "configs", "pending", ...)` and `CONFIG_ROOT / "pending" / ...`) — invisible to a literal-substring grep, only surfaced by `verify:optimizer` actually running `make_episode_manifest.py --selftest` | Both `make_episode_manifest.py` and `failure_episode_trial.py` repointed at `configs/retired/`; both selftests pass against the identical file bytes |
| Grader-doc accuracy | `trajectory_check.py`'s `check_sv_ambiguous_spec` docstring described its primary signal (`plan_write`'s `uncertainties[]` field) as sometimes-absent because small tasks skip planning — true when written, but the field was removed from the schema entirely in the c31 retirement, making that path *permanently* unreachable, not merely occasionally silent | Docstring corrected to state the primary path is now dead code kept only because removing it changes nothing observable; the text-fallback path (unaffected, still live) is unchanged |

Three new unit test files were added for lib modules with no unit-level test of their
own (`extension-lifecycle.ts`, `control-charge.ts`); a persistent-sink-failure case
was added to `telemetry-async.test.ts` rather than a new file, once its existing
coverage of `telemetry-writer.ts` turned out — on inspection — to already be
extensive (ordering, permissions, overflow accounting, rotation, session lifecycle).
That existing coverage directly contradicted this pass's own working assumption of
"no dedicated test"; the correction is recorded here rather than silently dropped.

## Validation receipt

- `npm run verify`: all six stages passed, 162.9s (serial by design —
  `verify-all.mjs` runs stages serially because the corpus contains process-
  contention-sensitive fixtures).
- Harness: 882 tests passed, zero failed (`harness/tests/*.test.ts`, 103 files).
- Package smoke: 218 packaged files; the installed tarball loads 32 extension entry
  points and 2 skills.
- `optimizer/prompt-lab/config.py --selftest`, `real_gate.sh --dry`,
  `make_episode_manifest.py --selftest`, `failure_episode_trial.py --selftest`, and
  every other optimizer selftest: all pass.
- `retired-surface.test.ts`: all three checks pass against the four newly retired
  options and the pre-existing retired roster.
- `npm run secret-scan:diff`: clean, 5114 added lines inspected against
  `origin/main`.
- All new defect probes (the continuation-ownership race, the process-timeout
  hardening, the moved-config fallout) were observed failing before their
  corresponding fix and passing after.
- No task-model or optimizer-model inference, calibration, or campaign ran.
- Source surface: `c5ede8b116ad260929abf6bdc44f3570251c7bc4719efc330a8e27c3b71922e5`.
- Read-only mirror check: 15 of 138 first-party files differ from the live
  `~/.pi/agent` mirror. This is expected source-ahead-of-live drift (the ordinary
  state through a working session) — no sync was attempted; not a release claim.

## Dark-candidate disposition

The authoritative current roster is
`optimizer/docs/QWEN_EXPERIMENTAL_CANDIDATE_REGISTER_2026-09-10.md`; this section
records only what changed as a direct result of this pass.

**Retired (4):** `PLAN_TOOL_GO`, `PLAN_UNCERTAINTY`, `PLAN_ITEM_GUIDANCE_V2`,
`LOOP_EPISODE_MODE=enforce` — see the repairs table above and
`CANDIDATE_RETIREMENTS_2026-09.md`.

**Recorded, not changed (2):** `FORCE_PLAN_WRITE`, `VERIFICATION_PLATEAU=enforce` —
already-shipped judgment adoptions, formally documented this pass; kill switches
and schema fields deliberately retained. See `DARK_CANDIDATE_VERDICTS_2026-09-10.md`.

**Unresolved, unchanged by this pass — every one requires its own acceptance screen
before any adoption decision, per the register:** `VISION` / `VISION_GROUNDING=sam`
(pHash and the observation/cache pipeline are done and tested; SAM has a working
runner but it lives in ephemeral storage and is not wired into the harness —
tracked as its own follow-on), `RESEARCH_LEDGER` / `RESEARCH_BUDGET`, hierarchical
research (`PLAN_GRAPH` + `DEEP_RESEARCH_PLANNING`, plus the `PI_MUNCHKIN_HEADLESS_PLAN`
lease), parent-led research (`RESEARCH_WORKFLOW=parent` — still a half-finished
compatibility bridge between the legacy round-ledger and the newer aggregate, not
just unscreened), `JINA_READER`, `CONTEXT_ADMISSION`, `BASH_OUTPUT_GUARD`,
`GREP_FIND_TOOLS` (c51), `WORKING_MEMORY` (deliberately parked — "adds a tool where
the measured failure mode is tool operation"), `CONTEXT_DISCOVERY` (no named
failure mode to screen against; candidate for a future conditional retirement, not
executed here since that would need its own sign-off). `MUNCHKIN_TOOL_SURFACE=minimal`
remains a verified alias of the `core` default, not a treatment — the register's
own "retire as verified redundancy" note stands; deleting the compatibility alias
is a separate release decision, not part of this pass.

## Reviewed boundaries and remaining limitations

Carried forward from `HARNESS_AUDIT_2026-09-06.md`, with current status:

- End-to-end `AgentSession` scheduling, compaction, and pause/resume races needed a
  dedicated no-network runtime fixture and a pinned-model smoke — **partially
  closed this pass**: the continuation-ownership race is fixed and has a
  reproduction-backed regression (G01-E, run under a stress loop, not merely
  once). Provider-hung cancellation and goal-continuation qualification for the
  newer parent-research workflow remain open (`HARNESS_UPGRADE_CLOSEOUT_2026-09-09.md`).
- The public-URL guard remains a best-effort preflight only — a downstream fetcher
  (e.g. the `ketch` scraper, or Jina Reader's own third-party fetch) opens its own
  socket and may resolve DNS or follow redirects again. Unchanged; out of scope
  here.
- Research reservation capacity checks are process-local directory counts, not a
  strict concurrent global limit. Unchanged.
- The binary policy named exact-sign remains a preregistered net-fix threshold,
  not a significance test. Unchanged; a separate statistical review is still
  needed before any efficacy claim built on it.
- New, found this pass: the process-timeout hardening added here (900s suite /
  120s per-test / 120s child-runner ceilings) catches a hang that used to run for
  days, but does not itself prevent a genuinely long, legitimate operation
  (real-model inference under a slow endpoint, for example) from being killed as
  a false positive if it exceeds those ceilings. The ceilings were chosen from
  this session's own healthy-run timings (~2 minutes serial) with generous
  headroom, not derived from a documented worst case.
- New, found this pass: `harness/lib/{failure-episodes,run-kernel-receipts,
  run-kernel-state,harness-signals}.ts` retain inert string comparisons and a
  union-type member for the now-deleted `plan_go` tool name. These were
  deliberately left untouched — `run-kernel-state.ts`'s case in particular drives
  an actual state transition (`plan.executionStarted`) that was already
  unreachable in practice (no shipped config ever set `PLAN_TOOL_GO=on`), and
  fully diagnosing whether an equivalent transition is reachable via the
  surviving `/plan-go` command was judged out of this pass's scope. Flagged for
  a future pass rather than touched speculatively.
- Untested-but-transitively-covered libs from the QA inventory
  (`capability-surface.ts`'s `measureActiveSurface`, `run-kernel-snapshot.ts`'s
  rejection paths, `plan-limits.ts`, `process-writer.ts`) were reviewed and left
  without dedicated tests — the first two are cheap future additions if ever
  touched again for another reason; the latter two are pure constants /
  a single `randomUUID` call with no independent logic to test.
