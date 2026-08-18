# Handover — pi_munchkin, 2026-08-11

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

## 2026-08-17 prepared working-memory and plateau series

The frozen measurement generation remains the first dependency: judge labeling, Phase 6 smoke,
and any gate execution are still human-owned and have not been started by this series. The
exact-gate frontier and call-variant terminology repairs are pushed on sequential `codex/`
branches. A private structured notebook is prepared dark behind `WORKING_MEMORY=on`; off means
zero tool or prompt exposure. Strict plateau tracking is prepared at the default shadow posture;
`VERIFICATION_PLATEAU=enforce` remains dark and never aborts. Mirror-mini fixtures remain later
stacked work. Nothing in this series has been merged, mirrored live, adopted, or measured.

## 2026-08 hardening series

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
> live-load smoke clean, boundary row 2026-08-15 loaded hash `358c1f7c…` — future gate
> rounds bind this). A 2.75-day wedged bare `pi` on ttys004 (stdin-wedge orphan) was cleared
> before the mirror.
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
