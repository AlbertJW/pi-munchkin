# Handover — pi_munchkin, 2026-08-24

Read `optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md` before interpreting any historical
experiment. A 2026-07-27 audit established that most A/B results were unsupported: rounds at
n=3–9/arm lacked useful power, pass/fail did not measure the efficiency target, and 40 of 45
candidates could not prove their mechanism fired. Every earlier `NEUTRAL` is currently
**UNTESTED**, not rejected.

The robust measured constraint is repeat-call spiraling. Across 1,505 sessions, median context was
about 4.9k tokens, while the longest 10% of sessions carried 43% of wasted tool calls. Judge new
work against that failure class.

## Repositories and authority

| Location | Role | Rule |
|---|---|---|
| `~/pi_munchkin` | public source of truth | review, secret-scan, verify, then push |
| `~/.pi/agent` | live harness mirror | never push; mirror only after human rollout approval |
| `~/LLM` | model serving | at most one gate round per serving box |

The source and live harness are intentionally not auto-synchronized. Model-visible defaults,
adoption, deletion, live mirroring, and gate rounds are human-gated. Never touch files matching
`context-pressure*`.

## 2026-08-25 semantic-loop screen prepared (design-only; no inference ran)

`PREREG_SEMANTIC_LOOP_SCREEN_2026-08.md` pre-registers the calibration + mechanism screen for
`LOOP_EPISODE_MODE=enforce` — subject `qwopus35-4b` (Albert-chosen; the restart-condition-#1
argument is in the prereg and the mothball addendum), slate `sweep-b`, `sweep-c`,
`ling-exact-gate-recovery`, `ling-partial-order-release`, `audit-sweep`. It supersedes the
never-approved `PREREG_FAILURE_EPISODE_BASELINE_2026-08.md` and declares five verified
measurement hazards, the two load-bearing ones being: the adopted `VERIFICATION_PLATEAU=enforce`
default contends at the same arbiter priority (600) as semantic tier-1/2 steers with the loser
dropped, and `failure-episode/intervention` records **proposal**, not delivery (delivery is
`control-arbiter/decision` with `winner_reason="semantic_tier"`). Two artifacts ship with it:
`optimizer/prompt-lab/make_episode_manifest.py` (builds the private study manifest; computes
all six identity hashes; refuses in-repo writes; round-trips through `load_manifest`; its dry
run reproduced loaded `acd18a54…` exactly) and a fix in `context_telemetry.py` — the
`episode_id` validators required 64-hex while the harness emits 16-hex ids, so
`failures_after_second`/`recovered_episodes`/`recovery_calls_*` were silently always 0 on real
rows (counterfactually proven; `semantic_failure_overrun` was never affected). All
optimizer-side: the model-visible surface did NOT move (source hash re-verified `522fd127…`).
**Every stage — preflight, calibrate (30 sessions), the added n=6 candidate-arm mechanism
screen, power, primary, replication — remains a separate Albert-started action; the mothball
stands until he starts preflight.**

## 2026-08-26 four-scale deep review — what shipped, and what did NOT

Solar (whole system) / planetary (30 extensions) / atomic (functions) / quark (bytes), plus a
model's-eye and a measurement pass. Sixteen findings fixed and counterfactually proven; see the
CHANGELOG entry and the `PENDING` row in `docs/SURFACE_BOUNDARIES.md` (source
`92afd0fe…` — **not yet rolled out**).

The load-bearing deliverable is `harness/tests/manifest-boot.test.ts`: the first test that boots the
whole declared manifest in order and asserts the end state, including after a `/reload`. Every
interaction defect this harness has shipped was an unverified assumption about a neighbour, and the
suite could not see any of them because it instantiates one extension per FakePi. Add to that file
before adding a targeted one. Its sibling `plan-surface-handoff.test.ts` exists because
`plan-runner.integration.test.ts` sets `PLAN_STORAGE=project` at module scope — the entire planner
suite runs in the ROLLBACK configuration, never the shipped default.

**Deliberately deferred, with evidence. Not dropped.** These are additions to the list below, and
the same rule applies: fix before relying on the affected mechanism in a measurement.

- **Gate subagent telemetry lands in the live interactive corpus.** `optimizer/real_gate.sh:660`
  never sets `TELEMETRY_FILE`, so a delegating gate's child sessions fall back to
  `~/.pi/agent/telemetry/events.jsonl` tagged `source: "gate"` — child rows never reach fd 8 *and*
  they contaminate the archive. `run-tests.mjs:41-51` has a leak detector for this exact class, for
  `test` but not `gate`. **Decide the direction before fixing**: `context_telemetry.py:33` treats an
  unsigned row as fatal, so simply propagating the file converts a silent drop into a hard
  extraction failure. Related: `context_telemetry` joins on `sk` (a cwd basename a subagent
  inherits) while `shadow_report` correctly uses `si`/`sp`.
- **`PI_RUN_ID`, `PI_MODEL_ID`, `PI_MODEL_PROVIDER`, `HARNESS_CONFIG_SHA256` are set by nothing.**
  So `model`/`provider` are null on every telemetry row, `run_id` degrades to the cwd basename, and
  `config_sha256` — the one field that would bind the flag posture the surface hash deliberately
  excludes — is null 100% of the time. The gate uses different names (`real_gate.sh:40-41`). This is
  gate-side wiring, which is why it stayed out of a model-visible batch.
- **Bus subscriptions leak on every `/reload`.** Eight extensions subscribe to
  `HARNESS_SIGNAL_CHANNEL`; none keeps the unsubscribe, and the bus is constructed once
  (`resource-loader.js:120`) and reused. One reload passes Node's 10-listener warning cap and
  double-delivers every signal to a live closure and a dead one.
- **Arbiter losers have already spent their one-shot latch.** Only `tool-call-rescue` defers its
  budget until the decision arrives; loop-breaker's tier/outcome/session latches, verify-gate's
  `fires`/`nagAwaitingEvidence`, and ketch's wrap latch all charge at proposal. Generalises the
  known B6, and note the merge rescue in `control-arbiter.ts:53-57` covers `verification_required`
  but not `verification_plateau` from the same file.
- **`agent_settled` one-shots never re-arm.** `verify-gate.ts` (`frontierSettled`) and
  `working-memory.ts` (`settled`) reset only at `session_start`, so only the first agent run per
  session is measured. `run-kernel.ts:382` is the correct in-repo pattern.
- **Inert rollbacks.** `MUNCHKIN_TOOL_ACTIVATION=ambient` is unreachable under the `core` default
  (`tool-activation.ts` returns before the branch) yet silently flips the system prompt through
  `active-tool-prompts.ts:10`; `phase` is entirely unimplemented and its surface
  (`PHASE_CAPABILITY_TOOLS`, `phaseDeferredTools`) has no caller. `PLAN_GATE_DIAGNOSTICS=legacy` is
  advertised as a rollback in the boundary ledger and read by no code.
- **hashline writes user source files non-atomically** (`writeFile` in a loop, no tmp+rename, no
  fsync) while the harness gives its own state both. Also: one stray CRLF rewrites every line
  ending in the file, and a filename containing `#` is readable but permanently un-editable.
- **ketch budget TOCTOU** (read-modify-write across an `await` on the plan-context read) and the
  `noteCount` race; the consecutive-refusal cutoff is off by one and reports a cumulative counter.
- **`package-smoke`'s 70% reduction gate re-declares `CORE_NAMES` as a literal** and omits
  `plan_write`/`plan_update` — the two largest schemas — so the reduction figure overstates.
- **Unbounded session growth**: `blackboard.state.attempts` (the restore path caps at 200; the live
  path does not), the `span-tools` file cache (`hashline.ts` does LRU for the same problem), and
  loop-breaker's session-cumulative maps.
- **`TELEMETRY_MAX_BYTES` is parsed two incompatible ways** — `"5MB"` rotates at 5 bytes in the sync
  writer and 1024 in the async one. `ketch.ts:48-55` already solves this and documents the footgun.
- **Async telemetry has no process-exit path** — no `SIGINT`/`SIGTERM`/`beforeExit` handler anywhere,
  and loop-breaker's `abort` row is the last thing queued before `ctx.abort()`.
- **Doc drift**: `HANDOVER.md:75` still states loaded `acd18a54…`, six rollouts stale, with no
  supersession banner in a document that banners its other stale section; `/runtime-status` is
  documented and does not exist (the behaviour belongs to `/munchkin-doctor`); README lists
  "observational memory" as a shipped extension and none exists; a dozen model-visible flags
  (`LB_*` thresholds, `LB_HARD_STOP`, `MUNCHKIN_TOOL_SURFACE`, `CTX_GUARD_RISKY*`,
  `VERIFY_GATE_MAX_FIRES`, `TELEMETRY_STRICT`) are absent from README's defaults table.
- **Query-string redaction makes distinct sources verification-equivalent** — `?title=A` and
  `?title=B` collapse to one display URL, so parent-verifying one satisfies `plan_settle` for both.
- **`VERIFY_GATE_MAX_FIRES=0` cannot disable the gate** (`"0"` parses to 0, fails `> 0`, falls back
  to the default 3), and `TELEMETRY_STRICT=1` throws out of `record()` against the module's stated
  fail-open contract, propagating into subagents.

## 2026-08-25 planner-limit raise + regression sweep — deferred follow-ups

The note-limit raise (300→900) and audit fixes A1–A6/B1/B3–B5 are merged and rolled out (see
the 2026-08-25 rows in `docs/SURFACE_BOUNDARIES.md`). The audit's REMAINING findings are
deferred deliberately, not dropped: **B6** verify-gate charges `fires`/`nagAwaitingEvidence` at
proposal time, so an arbiter-losing nag is counted as delivered (tool-call-rescue's
charge-on-decision pattern is the fix); **C1/C1b** drift-scanner sends a follow-up at
`agent_settled` (always triggers a turn when idle) and has no `session_start` reset, so a stale
review can deliver into the next session; **C2** `LB_SESSION_REPEAT` can fire once on a
text-only wrap-up turn; **C3** tool-call-rescue matches tool-call syntax quoted in prose;
**D** the closed CORE_NAMES/familyTools rosters give MCP or new builtin tools no activation
route and `capability(status)` cannot report the deferred list; the `FORCE_PLAN_WRITE=on`
rollback is inert under the core profile; dark-path branch-merge failures are swallowed without
telemetry. Fix these before relying on the affected mechanisms in measurements.

## 2026-08-24 shotgun recovery adoption

> **STALE OPERATIONAL NUMBERS — superseded six times since.** The loaded hash below
> (`acd18a54…`) was authoritative on 2026-08-24 only; the chain since is `12e1896b…` →
> `a9461aee…` → `3cbb10ed…` → `39fb2c3f…` → `73d491c2…` → `f01af261…` (current live), with
> `92afd0fe…` prepared and not yet rolled out. Mirror is 116/116, not 112/112. Bind measurements
> to the last row of `docs/SURFACE_BOUNDARIES.md`, never to a hash quoted in prose here. The
> posture and rationale in this section still hold; only the numbers are stale.


Branch `codex/shotgun-recovery` replaces the AlbertWork failure path without changing the live
harness. It adds call-bound pre-execution prevention evidence and argument-free `verify_project`,
replaces the dependency/gate-heavy planner with a 24-item stable-ID plan plus small deltas, prepares
the dark `MUNCHKIN_TOOL_PROFILE=core` surface and its one `capability` switch, and removes `/reflect`
while retaining observational memory and run capsules. The exact/outcome loop protections and
semantic shadow posture are unchanged.

The approved defaults are `MUNCHKIN_TOOL_PROFILE=core` and
`FORCE_PLAN_WRITE_DEFAULT=off`. Independent rollbacks remain `MUNCHKIN_TOOL_PROFILE=ambient` and
`FORCE_PLAN_WRITE=on`. Commits `dbf90f4` and `41ab87b` are merged and pushed on `main`. The live
mirror matches all 112 first-party artifacts, Pi 0.84.2 completed a non-inference load smoke, and
the authoritative loaded hash is `acd18a54415b58bf66e1fb2722a2ac8cd3b9d985a1ac61cf56c93c09dbf39d0b`.
No calibration, gate round, or efficacy claim follows from this rollout.
Counterfactual test names and non-secret outcomes are recorded in
`docs/SHOTGUN_RECOVERY_QA_2026-08.md`. The final working diff passes `npm run verify` (550 tests,
typecheck, health, 151-file deterministic package smoke with 30 extensions and two skills,
optimizer integrity/jails, and secret scan), peer-boundary checks, and isolated packed consumers
for Pi 0.80–0.84. The approved live rollout preserved local settings, model configuration, and
browser artifacts; pruned six obsolete managed orphan/staging files; and reports no unmanaged
loadable extension or duplicate tool.

## 2026-08-24 deep-inspection close-out

> **SUPERSEDED same day by the shotgun recovery adoption above**, whose rollout replaced this
> section's operational numbers: mirror 118/118 → **112/112** (six managed orphans pruned),
> loaded surface `e68f1543…` → **`acd18a54…`**, 648 tests / 31 extensions → **550 tests /
> 30 extensions** (the planner/reflect retirement removed suites with their code). The F-01/F-02
> fixes and posture described here remain in force; only the "current snapshot" claim is stale.

This section was the operational snapshot when written, superseding earlier “prepared”, “dark”,
or “pending mirror” wording below when it describes the same surface. The inspected baseline was
clean `main`/`origin/main` at `baa72ea`. The release fixes are now implemented: the measured-inert
`provider-patience` extension and all active configuration/telemetry/package references are
retired; normal unbounded `read` intake is reduced from 64 KiB to 32 KiB; files above the normal
or 8 KiB risky threshold require pages of at most 200 lines or the existing span/search tools.
Both defects have observed counterfactual failures recorded in
`docs/QA_WORKING_MEMORY_PLATEAU_2026-08.md`.

`npm run verify` is green: 648 tests, typecheck, health, deterministic package smoke (156 packed
files; 31 extension entry points; 2 skills), optimizer integrity/self-tests, and the non-echoing
secret scan. The fix commit is `8c1878f` on pushed `main`. The live mirror contains 118/118
first-party artifacts with no unmanaged extensions or orphans; the one retired
`provider-patience` orphan was pruned. The authoritative loaded live surface is
`e68f1543383ddc64e238142d687c40d8e2d321976078a07eaa0a8d0dc794a23a`. Pi 0.84.2 loaded the
ordered live extension surface successfully in a non-inference `--help` smoke.

The adopted model-visible posture is `ACTIVE_TOOL_PROMPTS=derived`, `CONTROL_ARBITER=enforce`,
`MUNCHKIN_TOOL_ACTIVATION=dynamic`, `CONTEXT_SURFACE_MODE=summary`, `STATE_LENS=steer`,
`VERIFICATION_PLATEAU=enforce`, and `RUN_CAPSULE=recovery`. `LOOP_EPISODE_MODE=shadow`,
`WORKING_MEMORY=off`, and `RESEARCH_LEDGER=off` remain unchanged. `httpIdleTimeoutMs=1800000`
is the live Pi setting that removes the observed 300-second provider wall; there is no longer a
parallel runtime shim. No calibration, powered trial, or gate round was started.

The dense-text overflow is addressed at both measured seams: bounded read intake in source, and
an 8,192-token registry-to-server headroom for both live Ornith models (`contextWindow=57344`
against served `n_ctx=65536`). A timestamped pre-change `models.json` backup remains beside the
live registry. No model inference, calibration, or gate round was started. If the optimizer is ever
deliberately restarted, widen the judge corpus before labeling because `calib4b` cannot vary the
relevant dimensions. Historical optimizer data remains preserved and unsupported; no old neutral
is a rejection. Browser automation is already supplied
by the live `browser-goblin` package (backed by `agent-browser`); neither `pi-agent-browser` nor
`pi-agent-browser-native` is installed or part of the first-party surface.

The next agent must read this file, `optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md`,
`docs/SURFACE_BOUNDARIES.md`, and `docs/HARNESS_CALL_GRAPH.md`; verify the current hash and mirror
before touching runtime code; never modify `context-pressure*`; never echo credentials or raw
diagnostics; and stop for explicit approval before any default flip, deletion, live mirror, or
measurement round.

## 2026-08-17 prepared working-memory and plateau series

> Historical snapshot. The 2026-08-24 adoption and inspection sections above are authoritative
> for current defaults and rollout state.

The frozen measurement generation remains the first dependency: judge labeling, Phase 6 smoke,
and any gate execution are still human-owned and have not been started by this series. The
exact-gate frontier and call-variant terminology repairs are pushed on sequential `codex/`
branches. A private structured notebook is prepared dark behind `WORKING_MEMORY=on`; off means
zero tool or prompt exposure. Strict plateau tracking is prepared at the default shadow posture;
`VERIFICATION_PLATEAU=enforce` remains dark and never aborts. Mirror-mini fixtures remain later
stacked work. Nothing in this series has been merged, mirrored live, adopted, or measured.

## 2026-08-21 grader-integrity round three (source branch; live mirror PENDING)

> **Both scoring paths were forgeable; both are closed, and the pattern is the finding.**
> Three inspection rounds have now shown the same shape: *every layer added to protect the
> graded score was defeated by attacking the layer below it.*
>
> - **C-1 — the session read its own answer key.** The 2026-08-20 jail read-denied the pin to
>   the graded RE-RUN, but the pin was still written to `<workdir>.row-context.json`, a sibling
>   of the model's own workdir, and `gate.sb` is `(allow default)`. Measured on the real
>   `parens` fixture with the real jail and seal: honest 0/3 became a sealed, unblocked
>   **3/3**, `blocked=None`. Reps share `$RUNS`, so rep 1's file was readable by rep 2;
>   `requirement_scoring` leaked the same names for v3. **Fixed by deleting the secret, not
>   fencing it**: `eval_fixture.grading_secrets` derives the four grading fields in the
>   row-builder process from the admission-hashed manifest under the read-denied `__HARNESS__`.
>   Nothing writes them to disk. Second layer added: `grade_provenance_reporter.mjs` runs in
>   the `node --test` runner PARENT and records each graded test's CALL SITE, so re-registering
>   the admitted names from `src/` is refused (`foreign_registration`) even if a pin leaks
>   another way. Honest limit: a `vm.runInThisContext` filename spoof that also lands in the
>   grader's line range is not detected.
> - **C-2 — the binary bit was never jailed.** Everything above protected `subscores`. `score`
>   — what `fleet_report.decide()` adopts on — came from an un-jailed, un-preloaded
>   `node --test`, so the four-line `node:assert` neuter still forged it: measured on `parens`,
>   honest 3/6 became a gate-passing **6/6**. All scoring runs now share one jail (new
>   `real-gate-fixtures/binary.sb`), the assertion preload, `env -i` with `NODE_OPTIONS` and
>   every telemetry/credential variable scrubbed, and fds 8/4/3/5 closed — the subshell had
>   been inheriting the unlinked read-write telemetry file into a process running model code.
>   Fail-closed on the `SANDBOX=off` precedent: never "unjailed but authoritative".
> - **Analysis chain.** `trial_validity.row_key` collided across model/split/variant, which
>   made `run()` raise, which left NO sidecar, which made every reporter call the round
>   "unevaluated" — silently, because `real_gate.sh` did not check the exit code. `find_workdir`
>   voided exactly the canonical rows whenever a perturbation ran. A resolved-but-empty workdir
>   left tamper screening off while the row still counted. `rft_harvest` could turn a
>   `reward_hacking` FAIL into a fine-tuning exemplar. `fleet_verdict` and `munchkin` read rows
>   raw; both now screen. Verdicts are bound to the row bytes they were computed from.
>   `effort_report.graded_rate` — the capability outcome — lacked the bounds guard its two
>   siblings have. `calibrate.py`'s 20-85% band was a third, unpreregistered admission rule; it
>   is retired to descriptive output in favour of `admission_rule.py`.
> - **Harness.** A model-controlled RELATIVE path forged a second `[harness summary]` block in
>   the model-visible state lens claiming the gate was green (reproduced). The verification
>   frontier only recognized the `tap` reporter's `#` marker, so it — and the entire plateau
>   feature above it — was inert against the default `node --test` that agents actually run.
>   `VERIFICATION_PLATEAU=enforce` reported `injected_chars` for corrections the arbiter had
>   dropped. `tool-call-rescue` spent its session budget on messages the arbiter never
>   delivered. Working-memory private-path redaction was defeated by any adjacent punctuation
>   (7 of 8 shapes leaked). `bash-output-guard` loaded AFTER loop-breaker, so loop-breaker
>   classified the original oversized blob while the model received the withheld error.
> - **Guards.** The secret-scan stage printed "clean" in CI having inspected ZERO lines (a
>   shallow checkout resolves no baseline); it now fails closed and CI checks out with
>   `fetch-depth: 0`. `GATE_MIRROR_DENY` defaulted to `$REPO_ROOT`, making the `__MIRROR__`
>   deny — which closed an OBSERVED escape (r6-c21) — a verbatim duplicate of `__HARNESS__`;
>   it is now derived from the git common dir. `verify-optimizer.sh`'s completeness guard
>   required `--selftest` in the file text, so a selftest invoked from `__main__` was invisible
>   to the very guard written to catch "exists but never runs".
> - **My own two regressions from the previous round, fixed first.** The L3 change made
>   `is_hidden()` match t1-t6, which made `install_tests()` unreachable and silently changed
>   what t3/t5/t6 show the model; and `HANDOVER.md` carried a false claim about
>   `qs-error-swallow` / `path-near-miss` (both ARE approved and authoritative — corrected in
>   place above).
>
> Every behavioural fix carries a both-polarity test proven by reverting the fix.
> `npm run verify`: all 6 stages green. 24/24 approved fixtures authoritative with zero
> artifact drift; no manifest, approval, or expiry clock was touched. Control groups: calib4b
> 12 rows, 12 distinct row keys, 473 tool calls, ZERO reward_hacking false positives;
> calibling3 12 rows, 12 distinct row keys, zero voided (its transcripts are not retained in
> either checkout, so the transcript detector could not be re-run against it — stated, not
> assumed). No gate round was run; the evidence base is still empty by design.
>
> **MIRRORED LIVE 2026-08-21** (human decision: "apply, but skip the smoke"). `mirror:apply`
> wrote 117 artifacts with zero drift; `mirror:check` 117/117, no unmanaged extensions or
> orphans; loaded hash `e7190767…` supersedes `9b8eaaad…`. **Live-load smoke CONFIRMED** (skipped
> at first, then run on request): pi 0.84.2, `pi -p --model local-llamacpp/qwen36-35b-iq3s
> < /dev/null` from a scratch cwd — exit 0, zero stderr, 24 telemetry rows, ONE `si`, every row
> carrying `e7190767…` including the `surface-receipt` row, zero error rows. Serving probe
> `served_n_ctx=65536, registry_ctx=61440, verdict=ok`. `run-capsule` checkpointed, which only
> happens under a correctly ordered manifest — evidence the `bash-output-guard` move is sound.
> **Future gate rounds bind `3d361874…`** — the CMD_POS comment recovery (`ddd712b`) is a
> source-comment-only delta but the surface hash covers contents, so it was re-mirrored the
> same day and re-smoked (exit 0, zero stderr, one `si`, surface-receipt confirms). It
> supersedes `e7190767…`; no model-visible behaviour changed between them.
>
> **2026-08-24 (later): THE 300s WALL WAS PI'S OWN SETTING; provider-patience measured INERT in
> pi sessions.** A live AlbertWork run on the final surface (`5427eea5`, patience applied:true)
> still died headerless at exactly 300.5s. Root cause: pi's `configureHttpDispatcher` sets
> `headersTimeout`/`bodyTimeout` = `httpIdleTimeoutMs` (default 300,000ms) on its OWN dispatcher
> and installs npm-undici's fetch — the extension's node-registry swap never reaches pi's request
> path. FIXED with pi's supported knob: `httpIdleTimeoutMs: 1800000` in the live settings.json
> (backup `settings.json.bak-20260824-idle`; verified with a live 4B session). PENDING DECISION:
> retire provider-patience (inert in every pi context; harmless; removal is a surface change).
> The same run surfaced an OPEN finding — a context-overflow loop: request 65,597 tokens vs
> ornith's 65,536 serving window (registry ctx 61,440), reactive compaction, then ONE turn
> re-read ~90KB (two large `read`s: 40KB dashboard + 50KB wiki index, under every current read
> cap), landing at 69,501 → 400 again. pi's client-side token accounting undercounts dense text
> (CSV/markdown) vs the server tokenizer, so compaction fires too late. Mitigation options (all
> model-visible, Albert-gated): lower ornith's registry ctx for headroom, raise serving ctx, or
> tighten read caps. Recorded, not changed.
>
> **AVO ADOPTION BATCH 2026-08-24 (Albert-approved).** The Aug 20-22 pi session is archived at
> `~/Desktop/pi-session-2026-08-20_harness-improvements/` (complete log, raw transcript, both
> design artifacts, ANALYSIS.md). Its artifacts were verified claim-by-claim; dispositions:
> ADOPTED — plateau supervisor (`VERIFICATION_PLATEAU` default now enforce), resume-from-state
> (`RUN_CAPSULE` default now recovery), compaction->resume contract (documented, was already
> built), subagent 600s->1800s. REJECTED with verified reasons — memory-store merge (merges three
> trust domains three inspection rounds separated), recovery fold (collapses per-mechanism kill
> switches), `WORKING_MEMORY=on` (adds a tool where the measured failure mode IS tool operation).
> VOID — symbolect removal (zero refs in harness/, retired 2026-07-12), double-steer fix (arbiter
> one-winner-per-boundary already does it). Ops: `loaded_alias()` and the warm-up 404 fixed in
> `real_gate.sh` (mothball trap list updated); `~/LLM/llama-swap.yaml` big-model `ttl` raised
> 1800->7200 (backup `llama-swap.yaml.bak-20260824`, router restarted clean). Rollbacks:
> `VERIFICATION_PLATEAU=shadow`, `RUN_CAPSULE=shadow`, `PI_SUBAGENT_TIMEOUT_MS`, the yaml backup.
>
> **OPTIMIZER MOTHBALLED AGAIN 2026-08-21 — see
> [`optimizer/docs/MOTHBALLED_2026-08-21.md`](optimizer/docs/MOTHBALLED_2026-08-21.md).** The
> instrument work is DONE and validated: the Phase-6 n=1 smoke passed every pre-declared
> criterion, including `validate_powered_row(require_complete=True)` — the settlement-authority
> tightening that had never been exercised — and confirmed C-1, the `binary.sb` write-fence and
> the `gate.sb` read-deny on a live run rather than a selftest. The programme stops for the
> OPPOSITE reason to 2026-08-03: the instrument works, and the subject cannot drive the harness.
> Measured on `ling3-tiny-experimental`: `audit-sweep` 0/8 with 57/82 tool calls failing; a
> 7-fixture round stopped after 2 rows showing 1/4 at 199 turns and ~95% tool-call failure. Box
> time buys no information at that error rate. No further rounds, candidate trials, or box time
> until the restart conditions in the mothball doc are met. Everything below is preserved and
> green.
>
> **OPEN ITEMS CLOSED OUT 2026-08-21.**
>
> - **The two unpinned fixtures were a CODE DEFECT, not a fixture decision** (`63bb765`).
>   `build_fixture_catalog.gold_case_names` built the gold state by re-running the in-code
>   `mutate()` generator, while `fixture_admission.run_state` applies the committed
>   `patches.gold` artifact — two sources of truth that had drifted, with every exception
>   swallowed into `None`. For `path-near-miss` the generator no longer creates
>   `src/index.js` at all (FileNotFoundError); for `qs-error-swallow` it yields a gold that
>   fails its own fail-to-pass suite 0/2. That is also the origin of the retracted claim
>   "its gold does not satisfy its own hidden suite" — true of the GENERATOR's gold, false
>   of the fixture: `fixture_admission.py verify` reports PASS for both. Derivation now
>   applies the patch and prints the cause instead of hiding it. Verified across all 41
>   fixtures: **36 existing pins derive byte-identical, 0 changed**; `path-near-miss` (3
>   cases) and `qs-error-swallow` (2) now derive; 3 stay correctly unpinned because their
>   graders are not `node --test` suites. **Remaining human step:** writing the two pins
>   into their approved manifests changes admission-hashed content, so it needs approval —
>   but it is one command now, not an open question. [DONE same day, `adc72c7`: both pins
>   written surgically and re-approved with `--expires-at` preserving the original review
>   clocks (2026-10-21 / 2026-10-23); 24/24 authoritative, 38 case-pinned. Not an open item.]
> - **Judge labeling: skeleton committed** at `optimizer/prompt-lab/judge_labels_calib4b.json`
>   — 12 sessions x 4 dimensions, anchors and the declared thresholds inline, 48 nulls.
>   The scores must be ALBERT's: a label written by anyone else calibrates the judge against
>   the wrong ground truth, which is the one thing the calibration gate exists to prevent.
>   Then `./agentic_judge.py --calibrate judge_labels_calib4b.json`.
> - **`WORKING_MEMORY_MAX_RECORDS = 32` — recommendation: leave the 8 KiB cap.** It is
>   unreachable at full note size (the file cap refuses at ~10-16), but the constant is now
>   documented as an upper bound and pinned by a test, `WORKING_MEMORY=off` by default, and
>   both limits raise the same `capacity` error so nothing is silently lost. A 4x increase in
>   a persisted private artifact's budget buys a nominal number, not a capability anyone has
>   asked for. Revisit if a real session ever hits it.
> - **Branches retired.** 40 local -> 3 (`main` plus the two held by worktrees). Only
>   `fix/manifest-approval-pin` carried anything not in `main`: the CMD_POS false-negative
>   rationale, which did not travel when CMD_POS moved into `harness/lib/command-policy.ts`,
>   leaving the surviving test pointing at a comment that did not exist. Recovered in
>   `ddd712b`; the branch is tagged `retired/fix-manifest-approval-pin` so it stays
>   recoverable. The 28 remote branches are all fully merged; they were left in place because
>   deleting them is a public-content change and they record which session did what.

## 2026-08-20 measurement-integrity follow-up (source branch, live mirror intentionally unchanged)

> **F2/F3 + test-hermeticity fixes prepared for merge/push.** `9aeea4e` makes the
> `surface-receipt` no-env test own `HARNESS_SURFACE_SHA256`, so `npm run verify`
> remains hermetic inside a live stamped session; the unfixed test failed with the
> inherited hash and the fixed suite passes with it set. `8938bad` separately
> sandboxes the graded hidden-suite re-run: the case pin is read-denied, evidence is
> hidden in a private `<workdir>.grade-evidence/` directory behind a gate-opened fd,
> detached children inherit the write fence, and grading refuses when the jail is
> unavailable. `6b99a21` seals the TAP immediately after production and verifies the
> bytes in the separate row-builder process (`seal_missing`/`seal_mismatch` refuse).
> `grade_jail_selftest.py` covers the golden path, F2 pin theft, F3 detached rewrite,
> workdir mutation, renderer failure, and post-production tampering; removing the
> jail fails the F3 assertion. `trial_validity` bundles the new evidence directory.
>
> The plan-gate `VG_STEER_NO_GATE` seen while operating from `~` is expected: gate
> arming is cwd-scoped, and no project gate exists in the home directory. The repo
> gate was run from its worktree (`npm run verify`, all six stages green). No live
> mirror, default change, adoption, gate/calibration round, or model-inference run
> is implied; the deferred source/live surface boundary remains the human rollout
> decision, and `context-pressure*` files were untouched.

## 2026-08 hardening series

> **2026-08-18 SECOND DEEP-INSPECTION ROUND — on `main` (`f4af650`), NOT yet mirrored.**
> Five adversarial reviewers over: my own first-round fixes, the F-01..F-12 hardening's
> completeness, the model-visible harness, the measurement statistics (cross-checked against
> scipy), and whole-repo provenance/secrets. Core verdict: the statistics are correct, the
> HMAC/serving-fingerprint provenance is forgery-resistant, the enforce-arbiter /
> failure-episode / session-identity logic is sound, F-06/F-09/F-12 are complete, and all 412
> commits + 2626 blobs are secret-clean. Sixteen findings fixed:
> - **The graded-score forgery is properly closed.** [CORRECTED 2026-08-21: it was not.
>   The pin below was WRITTEN to `<workdir>.row-context.json`, a sibling of the model's own
>   workdir that `gate.sb` let the SESSION read — measured on `parens`, honest 0/3 became a
>   sealed, unblocked 3/3. And the binary `score` came from an un-jailed, un-preloaded
>   `node --test`, so the assert-neuter still forged it 3/6 -> 6/6. Both are closed now, by
>   removing the pin from disk (`eval_fixture.grading_secrets`) and by jailing every scoring
>   run (`real-gate-fixtures/binary.sb`); see SECURITY_BOUNDARY.md. The pin itself is real and
>   the 36-fixture count below is correct.] My first-round collapse-shape guard only
>   caught an IMPORT-TIME `process.exit`; after a hidden suite yields (e.g. `await import`), a
>   mid-run exit truncates TAP to its passing prefix with a self-consistent plan, which scored
>   at face value. Now every reporter-graded fixture carries an **admitted case pin**
>   (`tests.fail_to_pass.expected_cases`, derived from a real gold TAP run, hashed into the
>   approved manifest); `grade_reporter` refuses any differing observed set — truncation,
>   rename, skip, or injected test. 36 fixtures pinned. This generalises the v3 `coverage_map`
>   contract to the whole corpus.
> - **`verification_plateau` enum drift** (latent until `VERIFICATION_PLATEAU=enforce` ships):
>   the reason was absent from `run-kernel-state`'s validator, so a plateau decision would have
>   silently stopped capsule persistence and voided the round. Fixed + a parity test proven by
>   counterfactual.
> - **The secret scanner is now a `verify` stage** (it was manual-only, in neither verify nor
>   CI, on a public repo). Plus tamper-detector gaps (`-t` destinations, header-driven `patch`),
>   `shadow_report` shares that could exceed 1.0, `effort_report` non-pooling, the
>   over-broad edit-header regex, F-05 `O_NONBLOCK`, F-04 rotated-file mode, F-03 private
>   mkdir, the admission bool guard, the v4 schema root, `.gitignore`, and doc drift.
>
> **Approval bookkeeping:** 24 approved before, 24 after — none lost, none gained, and every
> review clock PRESERVED (`approve --expires-at`) rather than reset by a mechanical
> re-approval. `qs-error-swallow` and `path-near-miss` were restored to HEAD rather than
> shipped changed — both need separate attention.
>
> **CORRECTION (2026-08-21).** The parenthetical this entry originally carried for those two
> fixtures — "`qs-error-swallow` (never approved; its gold does not satisfy its own hidden
> suite)" and "`path-near-miss` (regenerated shortcut breaks the visible suite)" — was false.
> Both manifests are `admission.approved: true` (reviewer Albert), `automated.passed: true`
> with `gold_fail_to_pass` and `gold_pass_to_pass` green and the shortcut mutant correctly
> failing fail-to-pass while passing pass-to-pass, `artifact_drift == []`, and
> `eval_fixture.py state` reports **authoritative** for both. What I actually observed was
> drift in patches I had regenerated locally, since reverted. The real, checkable defect is
> narrower: they are the only approved hidden-graded fixtures carrying neither
> `tests.fail_to_pass.expected_cases` nor a `grade_artifact` (`context-pressure`, the
> held-out, is the third), so the row builder records `subscores_blocked="unpinned_grader"`
> and they contribute a binary bit only, never a graded rate. Pinning them is a fixture
> decision, not a code fix.
>
> **PENDING:** the harness libs changed, so the model-visible surface moved to source
> `56993e93…`; the LIVE MIRROR + boundary row + live smoke are deferred (a `pi` was running on
> ttys006). Run `npm run mirror:apply && npm run mirror:check`, record the loaded hash in
> `docs/SURFACE_BOUNDARIES.md`, then smoke. `npm run verify`: all 6 stages green.


> **2026-08-15 MEASUREMENT REBOOT — MERGED to `main` (`5746195`), MIRRORED LIVE.** The
> optimizer is unmothballed: charter `optimizer/docs/UNMOTHBALL_2026-08.md`, ONE
> preregistered admission rule (`PREREG_FIXTURE_ADMISSION_2026-08.md` + `admission_rule.py`),
> graded-by-default TAP reporter grading (`grade_reporter.py`), per-trial validity rubric
> with voiding (`trial_validity.py`), judge activation tooling (`judge_render.py`,
> `--score-gen`, `JUDGE_LABELING_2026-08.md` — the 12 calib4b transcripts are a sufficient
> first labeling set), ling cohort repaired to behaviour-only + pi.fixture/v2, and sweep-a
> (capability) / sweep-b (episode-variance) / sweep-c (process-traps) multi-defect fixtures,
> all passing the admission battery.
>
> **DONE:** codex ling branch merged, whole reboot merged to main + pushed; **Phase 1
> coherence adoption APPLIED + mirrored live** (`ACTIVE_TOOL_PROMPTS=derived`,
> `CONTROL_ARBITER=enforce`; mirror:apply 110/110 zero drift, mirror:check 110/110, 35B
> live-load smoke clean, boundary row 2026-08-15 loaded hash `358c1f7c…`). A 2.75-day wedged
> bare `pi` on ttys004 (stdin-wedge orphan) was cleared before the mirror. **SUPERSEDED
> 2026-08-17 by the deep-hardening rollout — the live surface is now `2991c42b…` (see the
> 2026-08-17 row in `docs/SURFACE_BOUNDARIES.md`); future gate rounds bind `2991c42b…`, not
> `358c1f7c…`.**
>
> **GATES DONE 2026-08-15:** all seven cohort fixtures APPROVED (`reviewer albert`, expiry
> 2026-11-15, all `authoritative()==True`); charter + prereg accepted. **STILL PENDING (Albert):**
> label ≥10 judge transcripts (`JUDGE_LABELING_2026-08.md`; 12 calib4b transcripts ready to render). Then
> the first BOX round is Phase 6 — audit-sweep graded, base arm, local 4B, n≥9, preceded by
> one n=1 smoke row (the first end-to-end exercise of the v3 settlement-authority
> tightening). audit-sweep is deliberately NOT re-manifested — it grades the model's audit
> report via the retained pinned-artifact path, which the behaviour-graded reporter cannot
> express, and re-manifesting would clear its live approval. NO round has run; the evidence
> base is empty by design.


> **2026-08-14 CONFORMANCE-REPORT FOLLOW-UP — ROLLED OUT to `main` (`99e9235`) and mirrored live.**
> Four field-observed harness fixes from an independent pi dogfood session (report on Albert's
> Desktop; corrections addendum beside it — the report's date header, SHARING.md reading, "dormant
> candidate" framing, root `tests/` and secret severity were wrong). Five commits
> (`63d90cb..d620e16` + boundary `99e9235`), each `npm run verify`-green with counterfactually-proven
> both-polarity tests. Loaded live hash at rollout `a519d123…` (mirror:check 110/110 after pruning
> 3 retired orphans; 35B live-load smoke clean). See the `2026-08-14` row in
> `docs/SURFACE_BOUNDARIES.md`.
> - **verify-gate** (model-visible): arming scoped to cwd (out-of-cwd edits no longer arm); a
>   no-detected-gate session emits one honest `VG_STEER_NO_GATE` (PI_MSG-overridable, capped once)
>   instead of looping a false "exact gate" claim. Rollback: `git revert`. Gate fixtures unaffected.
> - **plan-mode classifier** (model-visible in plan mode): `awk` recon and `for`/`select` loops no
>   longer false-block; `awk -i inplace`/`system(` and mutating loop bodies still trip; `case` fail-closed.
> - **plan_write gate guidance** (model-visible): schema description matches the validator.
> - **pi-subagent**: `PI_SUBAGENT_MAX_SUMMARY_CHARS` (default 12000) tunes the cap; parallel header
>   counts `!isResultError` so it agrees with the per-child labels.
> - **mirror hygiene**: `findLiveMirrorOrphans` — `mirror:check` fails on in-package orphans a
>   retirement left behind; `mirror:apply --prune` deletes them (human-gated). The 3 that existed
>   (micro-gate.ts, payload-audit.ts, micro-gate-policy.ts) were pruned during rollout.
>
> **Same-day live-dir follow-up (Cerebras removal + root-tree reconciliation) — NOT a source change.**
> - **Cerebras REMOVED completely** (user: "not using it"). Provider + `csk-…` key deleted from the
>   live `models.json`; `cerebras` cache block deleted from `models-store.json`. Both now untracked +
>   gitignored (SHARING.md private); `artifacts/` (private ledgers) + `*.bak-*` also gitignored. The
>   key was **purged from all 197 commits of `~/.pi/agent`'s local snapshot repo** (`git filter-branch`
>   + reflog-expire + gc); verified 0 `csk-` across working tree, full history, dangling objects,
>   `auth.json`. The public repo was already clean (verified). No remote on the live repo — never push it.
> - **Root-tree reconciliation done.** Root `lib/` (16 diverged) + `vendor/` (6 diverged) refreshed to
>   source (root == package == source); kept genuinely root-only files (`chaos-policy.ts`,
>   `telemetry-event-catalog.json`); added nothing; restored no extensions to root (that would re-break
>   the load-order topology). Because `chaos.ts`'s loaded closure (`chaos.ts → lib/chaos-policy.ts` +
>   `lib/telemetry.ts → telemetry-catalog/agent-dir/telemetry-writer`) is in the surface hash and two of
>   those root copies were stale, refreshing them changed the **live loaded hash `a519d123…` → `c9176d81…`**
>   (35B live-load smoke re-confirmed clean, new hash emitted, no cerebras). This is a live-dir hygiene
>   change with NO source or model-visible delta — the shift is inert gauntlet-path telemetry brought in
>   sync. Future gate rounds must bind `c9176d81…`, not the `a519d123…` in the boundary row above it.
> - **Known fossil (left as-is):** the live root `tests/` are topology-INCOMPATIBLE (218/273 pass; 48
>   fail on root `extensions/*.ts` that moved into the package, plus stale test files expecting removed
>   APIs). The canonical suite is `harness/tests/` in this repo (592 passing). Retiring the live root
>   `tests/`/non-closure `lib/`/`vendor/` is a future human call, not done here.

> **2026-08-13 SPIRAL-CONTROL SERIES ROLLED OUT (PR 1–4; authored 2026-08-12) — model-visible default change, read first.**
> Approved by human decision and merged to `main` + mirrored live. This is NOT a shadow-safe
> rollout: deployed DEFAULTS changed, so no measurement pools across this boundary.
> - **Verification is stricter by default** (`VERIFY_EXECUTION_ORDER` now defaults to `execution`,
>   was `legacy`): a green verifier is refused after a *failed* or *in-flight* mutation, or when a
>   mutation call has no observed completion. `PLAN_GATE_DIAGNOSTICS=safe` (default) returns a
>   redacted ≤500-byte `UNTRUSTED_GATE_DIAGNOSTIC` instead of raw gate output. Rollbacks:
>   `VERIFY_EXECUTION_ORDER=legacy`, `PLAN_GATE_DIAGNOSTICS=legacy`.
> - **Loop steering changed**: failing-edit loops that were masked as "progress" now escalate;
>   at most one loop-breaker steer per turn (pure `loop-action` reducer); the 120s verify-gate
>   nag-suppression window is gone (deconflict moved to the typed control arbiter). Steer *texts*
>   are byte-identical; which/when/how-many changed. Gate command shown in steers is redacted.
> - **Retired from the live harness** (archived non-loadable under
>   `optimizer/archive/runtime-candidates/`): micro-gate/slop, payload-audit, the redundancy
>   nudge, the per-call state-lens `view|both` modes, and the mandatory subagent-only mutation
>   branch — plus their flags, telemetry, control vocabulary, and manifest entries. Manifest is
>   now 30 extensions + 2 skills. The `CONTROL_ARBITER` default stays `shadow`, so the lens+steer
>   one-voice dedup only applies under `enforce` (still your adoption gate); the losing-abort
>   drop is fixed regardless (terminal proposals outrank message proposals).
> - Loaded live hash and live-smoke result are in `docs/SURFACE_BOUNDARIES.md` (spiral-control
>   rows). Rollback for the whole series is `git revert` on `main` + re-mirror, or the per-flag
>   `legacy`/`off` switches above.

> **2026-08-12 LIVE TOPOLOGY ROLLED OUT — read before touching the live agent.**
> `~/.pi/agent/extensions/` no longer holds loose first-party files. Everything now lives in
> `extensions/pi-munchkin/` (extensions + lib + vendor) with a GENERATED `package.json` whose
> `pi.extensions` declares the load ORDER; `mirror:apply` writes it and `mirror:check` verifies
> it as part of the same plan. `chaos.ts` (local-only) and `pi-rtk-optimizer` are untouched at
> the root. Loaded hash `aa00172c…` (v2 descriptor: hashes loader order, project-local
> extensions, import closure, prompts/skills, pinned npm identity — **v1 hashes never pool with
> v2**). mirror:check 111/111; live smoke on the 35B exits 0 with zero stderr, one `si`, one
> surface hash, and run-capsule checkpoints that alphabetical order had been preventing.
>
> **One live-config change was required and is NOT in git:** `settings.json` listed
> `vendor/pi-subagent` as a configured package. Configured paths load AFTER
> `agentDir/extensions`, so that entry (a) double-registered against the ordered package —
> a hard `Tool "subagent" conflicts` load failure — and (b) had ALWAYS caused the vendored
> subagent to load after `tool-activation`, violating its documented complete-registry
> contract. The entry was removed; backup at `~/.pi/agent/settings.json.bak-20260812T124443Z`.
> If you ever revert to a flat mirror, restore that entry or the subagent tool disappears.
>
> Both new model-visible behaviors stay DARK: `ACTIVE_TOOL_PROMPTS` (ambient) and
> `CONTROL_ARBITER` (shadow). Adoption is the two-line diff in
> `docs/TRUTH_COHERENCE_ADOPTION_2026-08.md`, with a rollback table. Still your gates:
> that adoption, and any calibration or efficacy round.


> **2026-08-11 THIRD INSPECTION — SOURCE ONLY, NOT MIRRORED. Two decisions are yours.**
> Eight findings verified with runnable reproductions (plus one nobody reported). Fixed and
> pushed: plan-gate events were **silently dropped by the run-event validator**, so gate
> identity and order-independent verification were INERT in production while their
> reducer-level tests passed — a structural guard now parses the union from source and
> requires every member to be admitted and to accept a real payload, and the plan-gate path
> has an end-to-end test through the real dispatcher; empty arrays no longer destroy whole
> telemetry rows (12 rows already lost); blackboard restore fails closed; bash is classified
> by COMMAND for first-mutation (discard pre-fix rows — the one-shot latch means they were
> never written); the ledger writer fails closed to http(s); `context-surface` now loads after
> `run-capsule` so receipts measure what the provider actually receives; `/run-new` gives an
> explicit run boundary; and the execute prompt no longer names `subagent` when the tool is
> inactive.
>
> **DECISION 1 — `ACTIVE_TOOL_PROMPTS`.** At deployed defaults `MUNCHKIN_TOOL_ACTIVATION=dynamic`
> removes `subagent` and `compact_context` at session start, while the ambient prompt keeps
> telling the model to call both. For the commonest small-model session (one request, ≤1-item
> plan, context under 60%) the contradiction lasts the WHOLE session. The fix already exists
> and is dark: `ACTIVE_TOOL_PROMPTS=active` (built 2026-08-10, six days after the tool-surface
> default shipped — nothing tied them together). Structurally better than flipping it: have
> `active-tool-prompts.ts` enable whenever the activation mode is not `ambient`, so the two
> defaults cannot disagree under any env combination. Verified delta: ~797 ambient bytes leave
> the system prompt, per-tool guidance appears only when the tool is present. Needs its own
> boundary row; every A/B against the old prompt stops pooling.
> **Not reachable-adjacent:** `harness/vendor/pi-subagent/index.ts:432-470` injects a full
> "how to call the subagent tool" manual with JSON examples, gated only inside the
> `ACTIVE_TOOL_PROMPTS` branch — so at defaults it ships unconditionally for an absent tool.
> That is a stronger pull toward a pseudo-call than the four APPEND_SYSTEM lines.
>
> **DECISION 2 — one model-facing voice.** At defaults (`STATE_LENS=steer`,
> `CONTROL_ARBITER=shadow`) a single detected loop produces TWO user-level messages: the lens
> sends its own, then loop-breaker sends the steer. Worse than "two nearby messages": pi's
> default `steeringMode: one-at-a-time` drains one per turn, so turn N+1 receives the bare
> state block with NO instruction and the actual correction arrives a full turn later. The
> lens should supplement the winning correction (`${lens}\n\n${steer}`) instead of being a
> second producer. Model-visible; needs a boundary row and ideally a before/after measurement.


> **2026-08-11 EVENING CLOSE-OUT (newest first).** Albert's nine findings are ALL fixed,
> committed (`fc2d4af..5e75469`), pushed, and mirrored (108/108, loaded hash in
> `docs/SURFACE_BOUNDARIES.md`): watchdog privacy (0700/0600 + report redaction), pi 0.84
> peer range, session-identity rework (episode exposure is **UNKNOWN**: the 29% read was a
> cwd-collapse artifact AND its 0% replacement was computed on an incoherent population —
> telemetry now emits a per-session `si` id, `shadow_report.py` binds one surface hash and
> refuses to number a mixed population; the "loop-intervention powerable" read stays
> retracted), non-vacuous judge calibration, `gate_sha256` identity on run-kernel verification,
> abandoned-episode terminal state, awaited adaptive rebind, `plan_go` off-surface during
> review, transactional `mirror:apply`. The serving-truth probe is live-verified on the 35B
> (`served 65536 / registry 61440 / ok`); smokes against the DEFAULT model prove nothing —
> pi's cloud path never fires `after_provider_response`, so always pass
> `--model local-llamacpp/...`. The day-long startup-wedge mystery is CLOSED: fd-0 stdin
> (non-TTY stdin that never EOFs; `pi -p` waits to append it to the prompt). Non-interactive
> callers: redirect `< /dev/null`. Albert's hold ("no calibration, dark mechanisms, or
> measurement-readiness claims until the five high findings are resolved") is satisfied;
> his gates remain fixture approval, then the preregistered n=6 calibration.
>
> **2026-08-12 attribution repair:** `session-bootstrap.ts` is now the first manifest
> extension and the sole owner of `si`, surface provenance, and the immutable initial tool
> registry. Lineage is transitive; conflicts and cycles are excluded; raw gate JSONL is
> explicitly UNKNOWN because its ephemeral HMAC key is gone. Every shadow summary made with
> split identity, one-hop lineage, or the pre-v2 ordered-layout hash is retracted. No efficacy
> or exposure estimate survives this boundary.
>
> **2026-08-11 PLAN-EXECUTION STATUS (read this first).** Phases 0-3 of the harness plan are
> built; phase 4 (candidate trials) is blocked only on human approval of the new fixtures.
> Done: the startup wedge is instrumented (`harness/scripts/pi-watchdog.sh` captures a Node
> diagnostic report — 55 instrumented loads, 0 wedges, downgraded to rare/non-blocking);
> the `plan_go` self-approval gap is closed; a 13-agent adversarial audit of the research
> pipeline and run-kernel produced 5 confirmed findings, all fixed with counterfactual tests,
> and refuted 7 more; `verify` is concurrent (~13s); `mirror:apply` exists; `mirror:check` sees
> unmanaged extensions; `optimizer/prompt-lab/agentic_judge.py` provides an anchored rubric with
> a calibration gate (a judge may not be cited until it agrees with Albert's labels);
> `optimizer/prompt-lab/shadow_report.py` answers the three shadow-evidence questions with
> declared thresholds. The FOUR band fixtures were APPROVED by Albert (chat, 2026-08-11,
> recorded in the manifests) and the preregistered n=6 calibration RAN the same evening:
> **verdict NOT READY** — `misleading-symptom` and `documented-escape` saturated 6/6,
> `ordered-steps` floored 0/6 (diagnosed genuine: all six end states pass visible/fail hidden,
> the first in-the-wild shortcut-mutant observation), `second-test-guard` model-specific
> (admitted for the 4B only, 0.33). Fewer than two in band → no candidate trial; next
> authoring targets sit between `second-test-guard` and `ordered-steps` difficulty, plus a
> ling3-tier instrument. Full results appended to
> `optimizer/docs/PREREG_FIXTURE_BAND_2026-08-11.md`; design record in
> `real-gate-fixtures/BAND_FIXTURES_2026-08-11.md`.
>
> **2026-08-11 SHADOW-SAFE BATCH ROLLOUT (supersedes the per-PR rollout-status notes below):**
> the full PR 2–7 series was mirrored live at `461b1e9` with every new mechanism at its
> conservative default (`RUN_KERNEL=shadow`, `LOOP_EPISODE_MODE=shadow`, `RUN_CAPSULE=shadow`
> with no model injection, `PLAN_MODE=forced`, `MUNCHKIN_TOOL_ACTIVATION=dynamic`,
> `CONTROL_ARBITER=shadow`). Five QA fixes followed the same day (`5392181..5722464`, mirrored):
> lens steers skip abort/shutdown proposals; subagents inherit the harness configuration env so
> explicit `=off` suppression survives into children; `skills/**/*.md` + `APPEND_SYSTEM.md`
> joined BOTH surface hashers (**hash epoch change** — hashes across 2026-08-11 do not pool);
> token-scoped `PROVIDER_TOKEN` suppression; secret scan covers the unpushed commit range.
> Loaded hashes and a first-load startup anomaly (1 of 8, unreproduced, kill switches verified)
> are recorded in `docs/SURFACE_BOUNDARIES.md`. Next per Albert's staged roadmap: shadow
> evidence from real sessions, then ONE candidate at a time (semantic loop intervention →
> capsule recovery → adaptive planning → phase activation), each n=6 calibration → prereg →
> powered A/B ≥40/arm → second-fixture replication before any default flip.

> **2026-08-10 run-kernel PR 1** (`286a48d`, merged and rolled out): a typed,
> behavior-neutral state reducer now consumes canonical execution receipts after all existing
> middleware. `RUN_KERNEL=shadow` is observational; `off` registers nothing. It adds no prompt,
> tool, command, steering, activation, blocking, persistence, or gate run. The
> lifecycle `idle` state is deliberately independent of semantic `complete`, and prompt text,
> commands, arguments, outputs, paths, URLs, and errors never enter RunState. See
> `docs/RUN_KERNEL_ARCHITECTURE_2026-08.md` and the counterfactual QA ledger before review.

> **2026-08-10 run-kernel PR 2** (`fb4b89a`, merged; not rolled out):
> execution-order verification, per-file hashline mutation queues, and active-only tool prompt
> truth are implemented behind explicit opt-in flags. Current live defaults remain unchanged
> pending the separate adoption checkpoint. See `docs/RUN_KERNEL_PR2_CORRECTNESS_2026-08.md`.

> **2026-08-10 run-kernel PR 3** (`0878777`, merged; not rolled out): one
> turn-end control arbiter, typed domain signals replacing telemetry taps, and a bounded optional
> async interactive telemetry writer. `CONTROL_ARBITER=shadow` and `TELEMETRY_WRITER=sync` retain
> deployed behavior pending separate adoption. See `docs/RUN_KERNEL_PR3_CONTROL_2026-08.md`.

> **2026-08-10 run-kernel PR 4** (`codex/run-kernel-pr4-capsule`, dark source work): private
> per-run structured checkpoints, a bounded untrusted Markdown projection, custom-entry/private
> restore, semantic settlement, and `/run-status`. `RUN_CAPSULE=shadow` persists audit state but
> never injects it into ordinary model context. No live mirror or recovery adoption has occurred.
> See `docs/RUN_KERNEL_PR4_CAPSULE_2026-08.md`.

> **2026-08-11 run-kernel PR 5** (`codex/run-kernel-pr5-recovery`, dark source work): a
> deterministic bounded recovery brief, post-compaction/provider-retry delivery, and explicit
> `/run-resume` compatibility path. `RUN_CAPSULE=recovery` is opt-in; shadow/off behavior remains
> unchanged and no automatic provider request is started by resume. See
> `docs/RUN_KERNEL_PR5_RECOVERY_2026-08.md`.

> **2026-08-11 run-kernel PR 6** (dark source work): phase-aware capability
> activation is available only through `MUNCHKIN_TOOL_ACTIVATION=phase`. It
> preserves explicit selections, defers optional plan/span/subagent/compact/
> post-search web-read tools, and activates them only from typed evidence
> signals. The deployed `dynamic` path and model-visible defaults are unchanged.
> See `docs/RUN_KERNEL_PR6_CAPABILITY_2026-08.md` and its QA ledger.

> **2026-08-11 run-kernel PR 7** (dark source work): `PLAN_MODE=adaptive`
> adds private run-capsule plan storage, stable-ID `plan_update` deltas, an
> explicit bounded `/plan-direct` path, and `/plan-export`. `forced` remains
> the deployed whole-plan behavior; no adaptive default, live mirror, or
> adoption occurred. See `docs/RUN_KERNEL_PR7_PLANNING_2026-08.md` and its QA
> ledger.

> **2026-08-05 settlement/episode series** (`0c44b09..5013e85`, merged to main and **ROLLED OUT
> 2026-08-05** on Albert's instruction): semantic failure-episode shadow instrument
> (`LOOP_EPISODE_MODE`, `/loop-status`, `/loop-resume`), `runtime-truth` provider timings +
> `/munchkin-doctor`, drift/blackboard on `agent_settled`. Deep-QA'd 2026-08-05 (ledger): clean;
> shadow-non-intervention counterfactually pinned. Loaded hash in `docs/SURFACE_BOUNDARIES.md`.

Four sequential, independently revertible branches implement the audit response:

1. `codex/01-gates-loop-correctness` — `36b3f80`
   - sole three-state verification classifier; exact project-gate enforcement;
   - ordered mutation/verification evidence and structured one-shot plan receipts;
   - execution-start/end repeat evidence, including rejected plan writes;
   - counterfactual regressions for the silent-disarm and ordering defects.
2. `codex/02-security-bounded-io` — `e3dfc0b`
   - private asynchronous cockpits and redacted blackboard v2 migration;
   - canonical fail-closed public URL/DNS checks and bounded subagent environment;
   - preflight hashline caps, bounded trace tails, and bounded asynchronous path suggestions.
3. `codex/03-dynamic-surface-performance` — `5c0d2bc`, adoption `cbbc8fa`
   - additive evidence-triggered tool activation, context summary/full/off modes;
   - event-driven state lens and abortable post-session drift review;
   - dynamic activation and `STATE_LENS=steer` defaults were explicitly approved before adoption.
4. `codex/04-package-operations-docs` — in progress in this handover
   - Pi 0.80.6–0.83 compatibility, offline package smoke, isolated networked CI matrix;
   - manifest-aware live mirror check and non-echoing diff secret scan;
   - public narrative correction and optimizer archive banner.

Each model-visible commit is a surface boundary. Never pool measurements across these commits or
across a live-mirror rollout. Record the loaded `HARNESS_SURFACE_SHA256` with every future row.

## Current adopted defaults

- `ACTIVE_TOOL_PROMPTS=derived`: inactive tools contribute no ambient schemas, manuals, examples,
  snippets, or agent lists; `ambient` restores the legacy broad prompt surface.
- `CONTROL_ARBITER=enforce`: one highest-priority corrective message is delivered per boundary;
  `shadow` restores legacy producer delivery while retaining observational decisions.
- `MUNCHKIN_TOOL_ACTIVATION=dynamic`: defer `subagent` and `compact_context` only on a complete
  default Pi registry; preserve narrowed explicit `--tools` selections. Subagent activates on
  multi-item execution, second plan-gate failure, or loop tier two. Compact activates at 60%.
  `ambient` is the rollback.
- `MUNCHKIN_TOOL_SURFACE=default`: the DeepSeek-inspired `minimal` surface is source-only and
  opt-in; it keeps only `read`, `bash`, `edit`, and `write`, never overrides a narrowed explicit
  selection, and never auto-activates deferred tools. `/munchkin-doctor` also reports redacted
  protocol-parity facts; both features are observational/candidate surfaces and are not mirrored.
- `CONTEXT_SURFACE_MODE=summary`: no transcript hashing or duplicate analysis on the default path.
  `full` restores receipts; `off` disables. Gate sessions force full.
- `STATE_LENS=steer`: only loop-breaker events inject state, under cooldown. `off` is the kill
  switch; the per-call `view|both` modes are retired in the PR 4 draft.
- Teach hints and did-you-mean remain default-on, reversible, and mechanism-observed. No powered
  trial has established their benefit.
- 2026-08-07 (human-gated, judgment): nine more defaults — `FORCE_PLAN_WRITE` (with an in-code
  gemma-family skip and a block message naming `plan_write` → `plan_go`), `PLAN_UNCERTAINTY`,
  `PLAN_ITEM_GUIDANCE_V2`, `PLAN_TOOL_GO`, `SPAWN_DELEGATION`, `TOOL_CALL_RESCUE`,
  `CONTEXT_BRIEF`, `READ_DEDUP`, `SPAN_TOOLS`. Each `X=off` is the kill switch. None passed a
  powered trial; grounds and honesty box in `DARK_CANDIDATE_VERDICTS_2026-08-03.md`'s addendum.
  Gate rounds carry `plan_go,search_spans,read_span` in `GATE_BASE_TOOLS` (ADR-0001).
- Drift review starts only after the run settles (`agent_settled`), aborts on a new
  run/shutdown, and drops stale advice.
- Cockpits live under `${PI_CODING_AGENT_DIR}/artifacts/session-cockpits/`, never in a project.
- Text read/edit preflight defaults are 16 MiB (`HASHLINE_MAX_READ_BYTES`,
  `HASHLINE_MAX_EDIT_BYTES`); images above 4 MiB are refused before allocation.
- `PI_SUBAGENT_ENV_ALLOW` accepts validated extra environment names. The fixed list includes
  `LLAMA_API_KEY`; values are copied without logging.
- 2026-08-11: subagents also inherit the harness configuration keys (`HARNESS_CONFIG_KEYS` in
  `harness/vendor/pi-subagent/runner-env.js`), so a parent's explicit `=off` holds in children.
  Any new `process.env` read in harness code must be classified there — a coverage test fails
  otherwise. `CHAOS`, telemetry fds, and per-process run identity deliberately do not cross.
- 2026-08-11: both surface hashers include `skills/**/*.md` and `APPEND_SYSTEM.md`. Skill or
  governor text edits now move the hash; hashes computed before/after this change never pool.
- 2026-08-26: both surface hashers additionally include the agent-dir prompt inputs Pi actually
  reads — `SYSTEM.md` (which REPLACES the base system prompt) and `AGENTS.md`/`CLAUDE.md` (folded
  into every session's context). A live `~/.pi/agent/AGENTS.md` had been model-visible and unhashed
  since before 2026-08-11, so an edit to it could pool measurements across a real prompt change.
  Same epoch rule: hashes computed before/after this change never pool, even for identical code.

Full option, trigger, rollback, and security documentation is in `README.md`.

## Release and rollout checklist

For every source PR:

```sh
git diff --check
npm run secret-scan:diff
npm run verify
```

Then inspect staged paths for unrelated user work. The diff scanner reports only file, line, and
pattern ID and must never be changed to echo matched content. The canonical suite discovers its
tests dynamically; command output, not a hard-coded count, is authoritative.

After separate human approval to roll out a PR:

1. Mirror the first-party `harness/`, examples, and skills surface into `~/.pi/agent`.
2. Run `npm run mirror:check -- ~/.pi/agent`; extra documented local-only files are ignored.
3. Load the live harness through the current supported Pi release and confirm every declared
   extension and skill; the compatibility matrix separately covers Pi 0.80.6 through 0.84.x.
4. Record the new loaded surface hash. Do not pool old and new measurements.
5. Never commit or push from `~/.pi/agent`.

No live mirror or gate round is implied by approval of source implementation. Ask explicitly at
the rollout checkpoint. One gate round per box; never start one automatically.

## Security and operational constraints

- Never echo credentials. Do not place credentials, private endpoints, or machine-specific
  settings in diffs, tests, telemetry, notifications, or documentation.
- The repository is public. Secret-scan every diff before pushing.
- Preserve unrelated user changes in dirty worktrees.
- Use counterfactual regression checks: temporarily remove/revert the fix and prove its targeted
  test fails before accepting a new audit regression.
- Editing a running gate script can corrupt its byte-offset execution; stop the run first.
- Configuration-mode exposure proves only that configuration was applied. It does not prove the
  mechanism fired.
- Commit trailer: `Co-Authored-By: <the working Claude model> <noreply@anthropic.com>`
  (e.g. `Claude Opus 5` or `Claude Fable 5`).

## Optimizer — rebooted (2026-08-15)

The optimizer is **unmothballed** under `optimizer/docs/UNMOTHBALL_2026-08.md` (charter) and
`optimizer/docs/PREREG_FIXTURE_ADMISSION_2026-08.md` (the single admission rule; supersedes the
2026-08-11 band rule and the unpreregistered rule in `failure_episode_trial.calibration()`).
Primary outcomes: graded_rate (capability) and semantic_failure_overrun (loop interventions).
Keep the 2026-08-03→15 archive-era code, raw results, and preregs intact for audit.

Standing discipline unchanged: pass/fail guards harm; positive decisions need continuous
metrics, exposure evidence, adequate power, and an ADMITTED fixture; every round re-baselines on
the current model-visible surface, is started by Albert, one per box, never automatically.
