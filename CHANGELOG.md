# Changelog

All notable changes to pi-munchkin are documented here. Releases follow semantic versioning.

## Unreleased

Brought current 2026-08-05 (had been stale since 2026-07-22 and still described since-deleted
candidates as dark). Net changes since 0.3.0; the full per-decision record is
`optimizer/docs/DARK_CANDIDATE_VERDICTS_2026-08-03.md` and the ledger.

### Removed

- **Low-merit candidate retirement (2026-08-12):** removed loadable micro-gate/slop and
  payload-audit paths; removed the redundancy nudge, per-call state-lens view, and mandatory
  subagent-only mutation branch; removed their runtime flags, child propagation, telemetry,
  control vocabulary, manifests, and package entries. Final source is preserved under
  `optimizer/archive/runtime-candidates/` and historical recipes under
  `optimizer/prompt-lab/configs/retired/`. Generic CoT/pause, patient/terse/taxonomy prompts,
  prompt YAML, fresh/locality retry, and the inert span screen leave the active roster.
  `no-verify-gate` and `harness-off` remain suppression controls; `bash-output-guard` and
  `prompt-lean` remain candidates. The deletion checkpoint was cleared by human decision and
  this landed on `main` and the live mirror on 2026-08-13 together with the spiral-control PRs.

### Added

- **Admitted case pin for reporter grading (2026-08-18).** `tests.fail_to_pass.expected_cases`
  records the exact gold-run TAP case names, hashed into the approved manifest;
  `grade_reporter` refuses any observed set that differs. Closes a mid-run `process.exit`
  truncation that forged a 100% graded_rate (the previous collapse-shape guard only caught the
  import-time variant). 36 fixtures pinned, derived from real gold runs. The credential scanner
  is now a `verify` stage rather than manual-only, and `approve --expires-at` lets a mechanical
  re-approval preserve the original 90-day review clock.
- **Measurement-integrity follow-up (2026-08-20).** The surface-receipt no-env test
  now clears/restores inherited `HARNESS_SURFACE_SHA256`, preserving verification
  hermeticity inside stamped live sessions. Reporter grading now runs its hidden
  re-run in a separate Seatbelt jail: the admitted pin and evidence path are
  inaccessible, detached-child rewrites are fenced, and unavailable sandboxing
  refuses grading. TAP evidence is sealed immediately and re-hashed by the
  out-of-process row builder (`seal_missing`/`seal_mismatch` refuse). Added the
  golden/attack counterfactual battery `grade_jail_selftest.py` and trial-manifest
  bundling for evidence/seals. The remaining same-reporter-process and pinned-
  artifact trust boundaries stay explicitly deferred. `VG_STEER_NO_GATE` from `~`
  remains expected because gate arming is cwd-scoped; no live mirror is implied.


- **Measurement reboot (2026-08-15):** the optimizer is unmothballed under
  `optimizer/docs/UNMOTHBALL_2026-08.md` (charter) + `PREREG_FIXTURE_ADMISSION_2026-08.md`
  (ONE admission rule: graded_rate mean in [0.20,0.80], SD >= 0.15, coverage >= 5/6, n=6
  per model tier; episode exposure scoped to loop-study eligibility only — supersedes both
  the 2026-08-11 band rule and the unpreregistered rule in `failure_episode_trial.calibration()`,
  which now delegates to `admission_rule.py`). Graded-by-default: `grade_reporter.py` parses
  the hidden suite's TAP output (destination outside the workdir) into subscores with
  grade_artifact's refusal ladder — every multi-test hidden suite is graded for free, the
  direct attack on the one-bit/one-sided-detector problem. Per-trial validity rubric
  (`trial_validity.py`, Harbor's trial-analysis layer, deterministic-first): infra_valid +
  reward_hacking VOID rows (counted, never silent), near_miss/refusals/low_timeout annotate,
  judge-backed criteria PENDING until `agentic_judge` passes its calibration gate; per-trial
  artifact manifests (`pi.trial-manifest/v1`); fleet_report/effort_report consume the
  validity sidecar. Judge activation tooling: `judge_render.py` + `agentic_judge --score-gen`
  (+ `--render-only` labeling path; workflow in `JUDGE_LABELING_2026-08.md`; endpoint = local
  35B). Fixture corpus: pi.fixture/v2 authoring rubric (difficulty_crux with pre-data band
  predictions, findability chains, shortcut sharpness, episode-variance expectations,
  behaviour-only overlay lint, path-redacted output_tail restored in receipts); the four ling
  fixtures repaired to behaviour-only hidden suites (source-shape assertions replaced by a
  vocabulary-extension coupling test / dropped as redundant) and regenerated as v2; sweep-a,
  the first multi-defect graded fixture (six independent crux-class defects, band_prediction
  0.35-0.65), plus sweep-b (episode-variance) and sweep-c (process-traps), both landed
  2026-08-14 and therefore part of this entry. All SEVEN cohort fixtures pass the full
  admission battery and report authoritative; approval remains the human checkpoint.
  (Count corrected 2026-08-21: this entry said "five", counting only sweep-a.) Control-group discipline caught a real detector bug pre-use: the first
  reward_hacking draft void-flagged 6/12 honest calibration rows on `2>&1` redirects — fixed
  to target-based detection, both real calibration files now 24/24 clean.

- **Serving-truth probe + dual-permutation judging (2026-08-11):** `runtime-truth.ts` probes the
  local server's real `n_ctx` (`/props`, llama-swap `/upstream/<model>/props` fallback) once per
  model at `agent_settled`, records `runtime/serving-truth`, shows a `serving_truth` line in
  `/munchkin-doctor`, and warns (UI notify only, never model context) on a registry mismatch —
  the runtime version of the ling3 8192-vs-32768 incident check; named hosts and public IPs are
  never probed. Verified live on the clean mirror against the 35B: `served_n_ctx=65536,
  registry_ctx=61440, verdict=ok`. Note: pi's cloud provider path does not fire
  `after_provider_response`, so smokes against the default cloud model never produce a row.
  `judge.py` now judges every pair in BOTH orders and scores a win only on strict agreement
  (position bias becomes ties, 2× judge cost, selftest counterfactuals for both stub polarities).

- **Measurement and operations tooling (2026-08-11):** `harness/scripts/pi-watchdog.sh`
  (captures ps/lsof/sample plus a Node diagnostic report when a session stalls before its first
  request, instead of a blind kill); concurrent `npm run verify` (~40s to ~13s, with
  `verify -- --serial` as the fallback); `npm run mirror:apply` (the rollout copy step finally
  has a script, and it refuses a dirty or unpushed tree); `mirror:check` now fails on unmanaged
  live extensions; `optimizer/prompt-lab/agentic_judge.py` (anchored 0-3 rubric for verification,
  strategy change, scope discipline and honesty, plus the calibration gate that must pass before
  any judge score is cited); `optimizer/prompt-lab/shadow_report.py` (the three shadow-evidence
  checkpoint questions with thresholds declared in the file).
- **Four discriminating-band gate fixtures (2026-08-11):** `misleading-symptom`, `ordered-steps`,
  `second-test-guard`, `documented-escape` — each with a hidden fail-to-pass suite and a
  *plausible* shortcut mutant that passes the visible suite, so test-fitting is measured rather
  than assumed. All four pass `fixture_admission.py`; all four are `approved: false` pending
  human review, with review packets generated for that gate. Selection rule preregistered in
  `PREREG_FIXTURE_BAND_2026-08-11.md`; per-fixture design intent and the full verification record
  in `real-gate-fixtures/BAND_FIXTURES_2026-08-11.md`.
- **Run-kernel series, PR 1–7 (2026-08-10/11, mirrored live 2026-08-11 at conservative
  defaults):** a typed shadow run kernel over canonical execution receipts (`RUN_KERNEL=shadow`);
  execution-order verification and active-only tool prompts (dark, `VERIFY_EXECUTION_ORDER` /
  `ACTIVE_TOOL_PROMPTS`); a shadow control arbiter with typed domain signals and an optional
  bounded async telemetry writer (`CONTROL_ARBITER=shadow`, `TELEMETRY_WRITER=sync`); private
  per-run capsules with an untrusted Markdown projection and `/run-status`
  (`RUN_CAPSULE=shadow`, no model injection); a deterministic bounded recovery brief
  (`RUN_CAPSULE=recovery`, opt-in); phase-aware capability activation
  (`MUNCHKIN_TOOL_ACTIVATION=phase`, opt-in); and adaptive planning with stable-ID deltas
  (`PLAN_MODE=adaptive`, opt-in). Per-PR design and QA ledgers under `docs/RUN_KERNEL_*.md`.
- **Research pipeline reworked to parent-owned proof (2026-08-10, supersedes the earlier
  research entries below):** genuine tool errors on refused citations, a private bounded v2
  JSONL ledger under `${PI_CODING_AGENT_DIR}/artifacts/research-ledgers/` (the project-local
  `.pi/research/` ledger and the advisory verifier subagent described below were removed),
  bounded `research_recall`, and a parent re-read contract for delegated citations. Still dark
  behind `RESEARCH_LEDGER`.
- **Deep-research pipeline hardened after eval Run 2 (still dark):** `research_note` now
  auto-corrects a quote pasted from the wrong URL of a multi-page `web_read` (records under
  the true source; ambiguous only if the quote is in 2+ pages) — targeting the measured 62%
  refusal rate at its root; a wrap-up steer surfaces answers that ship after web reads with
  zero recorded notes; skill guidance to quote short spans and never fabricate completion.
- **Verified deep-research pipeline (dark, `RESEARCH_LEDGER=on`):** a session page cache
  (`web_read` results, 20 pages / 2 MiB LRU; full-batch re-reads served from cache), the
  `research_note(claim, url, quote)` tool that records a citation ONLY when the quote appears
  verbatim (modulo whitespace) in a page fetched this session — hallucinated citations become
  impossible to record — an append-only `.pi/research/<stamp>.md` ledger, additive budget
  footers, a `web_search` elision receipt, and a `harness/agents/researcher.md` role. Skill v2
  drives note-after-read + an advisory verifier subagent pass. `research/note`, `research/run-summary` and
  `research/wrap-steer` telemetry (no URLs/queries). Evaluation procedure in
  `optimizer/docs/RESEARCH_EVAL_QUESTIONS_2026-08.md`.
- Ketch failures now classify into the failure-episode taxonomy (`ketch upstream` → provider,
  `ketch is unavailable` → command_missing) instead of falling through to `unknown`.
- **Semantic failure-episode instrument (2026-08-05):** failures classified into a stable
  taxonomy and tracked as episodes keyed by (class, tool family, hashed target, hashed plan
  item). `LOOP_EPISODE_MODE=shadow` (default) records tier observations only (7/11/28 session
  tail, 2/4/6 semantic ladder); `enforce` stays dark behind a separate adoption gate.
  `/loop-status`, `/loop-resume`; private hashed recovery receipts. Calibration prereg:
  `optimizer/docs/PREREG_FAILURE_EPISODE_BASELINE_2026-08.md` (prepared, not approved).
- **`runtime-truth` extension (2026-08-05):** per-request provider timing (headers /
  first-token / stream / settlement ms + status only) after `agent_settled`, and
  `/munchkin-doctor` — a redacted Pi/model/tool-provenance/sandbox posture report.
- MLX serving backends are first-class in the optimizer's serving fingerprint
  (`mlx_lm server`; full-artifact hash, runtime identity via lsof) — first exercised by
  `audit-sweep`'s first-ever round (`maple20b-audit-base`, ledger 2026-08-05).

- **Adopted, default-on (2026-08-07, human-gated, by judgment):** `FORCE_PLAN_WRITE`
  (in-code gemma-family skip + block message naming the `plan_write` → `plan_go` path),
  `PLAN_UNCERTAINTY`, `PLAN_ITEM_GUIDANCE_V2`, `PLAN_TOOL_GO`, `SPAWN_DELEGATION`,
  `TOOL_CALL_RESCUE`, `CONTEXT_BRIEF`, `READ_DEDUP`, `SPAN_TOOLS` — each `X=off` is the
  kill switch; `plan_go`/`search_spans`/`read_span` joined `GATE_BASE_TOOLS` (ADR-0001);
  none passed a powered trial.
- **Adopted, default-on (2026-08-03/04, human-gated):** `session-blackboard` state lens
  (default mode `steer` since 2026-08-04; `STATE_LENS=off`), `teach-hints`
  (`TEACH_HINTS=off`), `did-you-mean` (`DID_YOU_MEAN=off`), and `tool-activation`
  (dynamic deferred `subagent`/`compact_context`; `MUNCHKIN_TOOL_ACTIVATION=ambient` reverts).
- `session-blackboard` cockpit (human-only HTML/TUI), `tool-call-rescue` (default-on since 2026-08-07), `bash-output-guard` (dark,
  `BASH_OUTPUT_GUARD=on`).
- Operational automation (2026-08-04): `npm run secret-scan:diff`, `npm run mirror:check`,
  `surface:hash:source`, compat/peer smoke checks, CI workflow, and
  `docs/SURFACE_BOUNDARIES.md` — the canonical surface-hash boundary ledger.
- Optimizer instrument (now mothballed with it): graded `subscores` +
  `effort_report --graded`, manifest-pinned grade artifacts, admission approval pinned to
  manifest content, the `audit-sweep` graded fixture.

### Added

- **provider-patience (2026-08-22, default-on, `PROVIDER_PATIENCE=off` kill switch):** raises the
  process-global fetch header timeout so slow local models are not aborted mid-prefill. Telemetry
  showed 16 of 600 provider requests dying at ~301s with `status=None`: Node's bundled undici
  `headersTimeout` (300s) fires before the provider SDK's own 600s timeout, and a cold-loaded 35B
  with a long prompt streams nothing until prefill completes. llama-swap was not the limit (its log
  shows a 3m30s request returning 200). Neither pi nor its SDKs expose a knob, so the extension
  swaps the global dispatcher at `Symbol.for("undici.globalDispatcher.2")` for an Agent of the same
  class with `headersTimeout`/`bodyTimeout` = `PI_PROVIDER_HEADERS_TIMEOUT_MS` /
  `PI_PROVIDER_BODY_TIMEOUT_MS` (default 1,800,000ms, matching `PI_TIMEOUT`). Both polarities
  measured and pinned by test; fail-open if the symbol's shape ever changes; all three env keys
  propagate to subagent children, which hit the same models.

### Changed

- **Optimizer mothballed again (2026-08-21):** the measurement reboot's instrument work is
  complete and validated — the Phase-6 n=1 smoke passed every pre-declared criterion including the
  never-before-exercised settlement-authority tightening, and confirmed the day's grader fixes on a
  live run. The programme is parked for the opposite reason to 2026-08-03: the instrument works,
  and the subject model cannot drive the harness (`ling3-tiny-experimental`: `audit-sweep` 0/8 with
  57/82 tool calls failing; a 7-fixture round stopped after 2 rows at 1/4 over 199 turns with ~95%
  tool-call failure). Rules and fixtures are unchanged — 24/24 approved authoritative, 38
  case-pinned, `PREREG_FIXTURE_ADMISSION_2026-08.md` still the one admission rule. Restart
  conditions, the traps not to re-derive, and the full evidence are in
  `optimizer/docs/MOTHBALLED_2026-08-21.md`.

### Fixed

- **Grader integrity, round three (2026-08-21, MIRRORED LIVE — loaded hash `3d361874`):** both scoring
  paths were forgeable and both are closed. **The session could read its own answer key**: the
  admitted case pin was written to `<workdir>.row-context.json`, a sibling of the model's own
  workdir that `gate.sb` permitted reading, so `src` baked the admitted names in, registered them
  as trivial passes and truncated — measured on the real `parens` fixture with the real jail and
  seal, honest 0/3 became a sealed, unblocked 3/3. The secret is now DELETED rather than fenced
  (`eval_fixture.grading_secrets` derives it in the row-builder process from the
  admission-hashed manifest; nothing writes it to disk), and a second `--test-reporter` running
  in the runner PARENT records each graded test's call site so a leaked pin is not sufficient
  (`foreign_registration`). **The binary gate bit was never jailed**: `score` — the field
  adoption reads — came from an un-jailed, un-preloaded `node --test`, so the four-line
  `node:assert` neuter still forged it (measured: 3/6 → a gate-passing 6/6). All scoring runs now
  share `real-gate-fixtures/binary.sb` plus the assertion preload, with `env -i`
  (`NODE_OPTIONS` and every telemetry/credential variable scrubbed) and fds 8/4/3/5 closed.
  Analysis chain: `trial_validity.row_key` collided across model/split/variant and aborted the
  whole sidecar build silently; `find_workdir` voided exactly the canonical rows once any
  perturbation ran; a resolved-but-empty workdir left tamper screening off; `rft_harvest`,
  `fleet_verdict` and `munchkin` read rows unscreened; verdicts are now bound to the row bytes
  they were computed from; `effort_report.graded_rate` gained the bounds guard its siblings have;
  `calibrate.py`'s unpreregistered 20-85% band is retired to descriptive output. Harness: a
  model-controlled relative path forged a second `[harness summary]` block in the state lens; the
  verification frontier recognized only the `tap` reporter, leaving it and the whole plateau
  feature inert against the default `node --test`; `VERIFICATION_PLATEAU=enforce` counted
  characters the arbiter never delivered; `tool-call-rescue` spent its budget on dropped
  proposals; working-memory path redaction was defeated by adjacent punctuation; and
  `bash-output-guard` loaded after loop-breaker, so the classifier saw a different result than
  the model did. Guards: the secret-scan stage printed "clean" in CI having inspected zero lines
  and now fails closed (CI checks out with `fetch-depth: 0`); `GATE_MIRROR_DENY` no longer
  defaults to a no-op; `verify-optimizer.sh`'s completeness guard can now see selftests invoked
  from `__main__`. Housekeeping in the same pass: `propose_screen.py` still DEFAULTED `PI_PROVIDER` to the Cerebras provider that was purged from the registry on 2026-08-14, so a screen run without `SCREEN_PROVIDER` silently targeted a provider that no longer exists; provider and model are now required with no fallback. Every behavioural fix carries a both-polarity test proven by reverting it.

- **Conformance-report follow-up (2026-08-14, source only — NOT yet mirrored):** four field-observed
  harness defects surfaced by an independent pi dogfood session that analysed `~/.pi/agent` against
  the official pi docs. (1) **verify-gate** drove up to 8 unsatisfiable steers on a documentation
  task — an edit written OUTSIDE the session cwd armed the project gate, and with no gate detected
  the steer named "the exact gate" that did not exist. Arming is now scoped to cwd (edit/write paths
  outside cwd do not arm; missing/unresolvable paths stay armed; bash mutations remain path-unscoped
  by design), and a no-detected-gate session emits one honest `VG_STEER_NO_GATE` nudge instead of a
  looping false claim. Detected-gate sessions and gate fixtures (always in-cwd, always with a gate)
  are unaffected. (2) **Plan-mode classifier** blocked read-only recon: `git ls-files | awk '{…}'`
  (awk was an unknown head) and `for f in *; do …; done` (the `for` header parsed as a phantom
  command). awk is now read-only except for `-i inplace`/`system(`; `for`/`select` word-list headers
  are skipped while their bodies still classify; `case` stays fail-closed. (3) The `plan_write`
  `gate` schema description now says gates must be recognised test/typecheck/verify runners, matching
  what the validator enforces — `ls`/`test -d`/`grep -c` are observational, not gates. (4) **pi-subagent**:
  the 12000-char child-summary cap is tunable via `PI_SUBAGENT_MAX_SUMMARY_CHARS` (propagated to
  children), and the parallel-run header counts `!isResultError` so "N/M succeeded" agrees with the
  per-child completed/failed labels (the exitCode -1 placeholder is neither success nor error).
  Also: **mirror:apply/mirror:check** now detect in-package orphans — files a retirement leaves under
  `extensions/pi-munchkin/` that the manifest no longer declares (compareLiveMirror walks the plan,
  so it was blind to them). check fails on them; apply reports by default and deletes only under
  `--prune`. All fixes carry both-polarity, counterfactually-proven tests.

- **Truth-and-coherence series, PR 1–3 (2026-08-12, source only — NOT mirrored):** the packaged
  and live harnesses were different architectures, because pi discovers loose extension files by
  readdir order while `package.json` declares a causal order. The live mirror now ships ONE
  ordered entry point (`extensions/pi-munchkin/`), and the generated manifest is part of the
  shared mirror plan so `mirror:apply` and `mirror:check` consume the same canonical bytes.
  **Surface descriptor v2** hashes loader ORDER, project-local extensions, the import closure,
  prompts/skills and pinned npm identities — so a reordering is now visible as a hash change,
  and v1 hashes do not pool with v2. Gate surface hashes moved inside each materialized run, so
  a fixture's own `.pi/extensions` is part of the measured topology.
  A first-loaded `session-bootstrap` extension owns session identity (`si` minted per
  `session_start`), the per-generation surface hash (never retained from a previous runner), and
  an immutable initial tool surface; `runtime-truth` is serving-only again. Shadow-report lineage
  is transitive with conflict/cycle detection, and raw gate JSONL now reports UNKNOWN rather than
  pretending it can be authenticated after its ephemeral key is gone.
  Model-facing trust boundaries: blackboard failures use the shared fixed taxonomy, the lens
  heading is trust-neutral, restored numeric domains are honest, enforce mode merges one bounded
  lens before the intact correction, and the active-only governor/vendor prompt paths are pinned.
  **Both new model-visible behaviors remain DARK**; adoption is a declared two-line diff with a
  rollback table in `docs/TRUTH_COHERENCE_ADOPTION_2026-08.md`.

- **Third inspection, eight findings + one unreported (2026-08-11, source only — NOT mirrored):**
  `run/plan-gate-observed` was missing from the run-event validator's admission set, so every
  plan gate was dropped before the reducer and two shipped fixes on that path (gate identity,
  order-independent verification) were inert in production while their reducer-level tests
  passed; a structural guard now derives the event union from source and requires each member
  to be admitted AND to accept a real payload, and the path has an end-to-end test through the
  real dispatcher. An empty array typed as `string[]` and made the telemetry catalog reject
  whole rows (12 lost from the live corpus). Blackboard restore trusted persisted state:
  malformed input crashed the renderer with the corrupt board still installed (silently
  killing the adopted lens for a session), and hostile prose in seven raw-interpolated slots
  could reach a model-visible "ground truth" block — now one closed validator, closed-vocabulary
  failure classes, and a `restore-rejected` row. First-mutation telemetry classified the bash
  COMMAND instead of the tool name (pre-fix rows must be discarded, not filtered — the latch is
  one-shot). The research-ledger writer was narrowed to the reader's http(s) predicate. The
  context-surface receipt now measures the payload the provider receives (`context-surface`
  moved after `run-capsule`). `/run-new` declares an explicit run boundary so a new objective
  stops inheriting an abandoned run. The execute prompt no longer names `subagent` when the
  tool is inactive. Two model-visible adoption decisions (`ACTIVE_TOOL_PROMPTS`; lens/arbiter
  single voice) are recorded in HANDOVER and remain human-gated.

- **Second inspection, seven findings (2026-08-11, evening):** telemetry rows carry a true
  per-process session id (`si`, globalThis-shared across pi's per-extension module instances);
  `shadow_report.py` binds one surface hash, keys sessions on `si` only, excludes and counts
  identity-less rows, and reports UNKNOWN instead of a rate for a population it cannot identify;
  run-kernel plan-gate verification is order-independent (an unrelated item gate neither
  verifies nor un-verifies the run; duplicate cached gates emit ONE kernel signal per
  execution); the plan-review checkpoint survives `agent_end` — `plan_go` stays off the surface
  and keeps rejecting until the human's actual `/plan-go`, restore never overrides an explicit
  user tool change, and a restart mid-review re-arms the hold; adaptive `plan_update` runs the
  same mature gate machinery as `plan_write` (dedupe cache, escalation ladder, `gate_sha256`
  identity, failing output returned, honest non-success result); both judges fence untrusted
  content with per-call nonces and reject contradictory/duplicate verdict lines, and
  calibration writes a durable receipt binding judge model, rubric hash, label-set hash, and
  (hashed) endpoint; watchdog persists flag NAMES only, deletes any report that missed
  redaction on every exit path, and gained a committed regression suite
  (`watchdog-redaction.test.ts`) including a real end-to-end stall capture. Fixture
  approval-state contradictions reconciled everywhere (manifests' vestigial nested
  `approved:false` removed at the generator, packets regenerated, HANDOVER/BAND docs state the
  approved-then-calibrated truth).
- **Albert's nine findings (2026-08-11):** watchdog bundles are now 0700/0600 with Node
  diagnostic reports redacted in place (no argv/env persisted — only stack, libuv, resource
  usage); pi 0.84 joins the supported peer range (`>=0.80.6 <0.85.0`, isolated battery + CI
  matrix + boundary fence); `shadow_report.py` counts sessions, not working directories — the 29% episode-exposure
  read was a cwd-collapse artifact and is retracted; the interim 0% replacement was ALSO
  computed on an incoherent population (`run_id` falls back to the cwd key) and is retracted
  too. Telemetry now emits a per-process `si` session id and the report binds one surface
  hash, excludes identity-less rows, and reports UNKNOWN instead of a number until
  identity-sound sessions accumulate. Episode exposure is currently UNKNOWN; `agentic_judge.py` calibration can
  no longer pass vacuously (per-dimension agreement gates, coverage and diversity minimums,
  `NA` never defaulted, nonce transcript fences); plan gates carry `gate_sha256` identity so a
  narrow plan-item gate no longer falsely verifies the run kernel (only the detected project
  gate counts); degraded research verification ABANDONS failure episodes as a distinct terminal
  state instead of closing them as recovered; adaptive plan rebind is awaited at
  `before_agent_start` (no async race); `plan_go` leaves the active-tool surface during plan
  review instead of advertising a tool that refuses; `mirror:apply` refuses under a running pi
  and stages per-file renames (never a torn file).
- **Startup-wedge root cause CLOSED (2026-08-11):** `pi -p` with a non-TTY stdin that never
  EOFs blocks forever before its first provider request (it waits to append piped stdin to the
  prompt). Inspector-confirmed on a live wedged specimen: exactly one active handle, a Socket on
  fd 0. Wedged pi also rewrites argv to just `pi`, which is why `pgrep -f "pi -p"` missed every
  specimen. Watchdog-guarded runs were always immune because `pi "$@" &` in a non-interactive
  script gets `/dev/null` stdin (POSIX async-list rule). Operational rule: non-interactive
  callers redirect `< /dev/null`. Not a harness bug — no code change.
- **Audit fixes (2026-08-11, from a 13-agent adversarial review):** the research wrap-up steer no
  longer fires where `research_note` is not an active tool (it fired inside the tool-restricted
  `researcher` subagent, demanding an impossible call and replacing the child's return payload —
  the c37/c38 allowlist class); `research_note` refusals degrade to a non-error after three
  consecutive failures, cutting the fuel for the Run 3 refusal-to-abort composition at its source;
  a same-target success now recovers a `verification_assertion` failure episode, which previously
  only an exact project gate could close; the run kernel observes plan gates (it had no receipt for
  them, so every plan-gated run emitted a false `verify_ok` legacy disagreement) and clamps context
  usage to its own snapshot contract (an over-100% reading killed the snapshot channel outright);
  `plan_go` can no longer self-approve a plan awaiting the user's `/plan-go`;
  `fixture_admission.authoritative()` answers instead of raising for a never-approved manifest.

- **Five QA fixes (2026-08-11, each counterfactually tested, mirrored live):** the state lens
  no longer steers at an abort/shutdown proposal boundary (a steer there fights loop-breaker's
  hard stop); subagents inherit the harness configuration environment so an explicit `=off`
  suppression survives into children (a coverage test now forces classification of every new
  env read); both surface hashers include `skills/**/*.md` and `APPEND_SYSTEM.md` (hash epoch
  change — hashes across 2026-08-11 do not pool); `PROVIDER_TOKEN` placeholder suppression is
  scoped to the matched token, not the whole line; `secret-scan:diff` also scans the
  committed-but-unpushed range (`origin/main...HEAD`).

### Changed

- `verify-gate` hardened: anchored gate-command matching, POSIX `test` builtin no longer
  disarms, three-state verification classifier (2026-08-04), state published fresh and
  cleared per session.
- `loop-breaker`: session-cumulative grinding counter; steer anchor dropped on
  `agent_start`; rejected `plan_write`s now count as failing outcomes, not progress.
- `plan-runner`: `plan_go` tool + `/plan-go` unified on one validator; `__pi_active_plan_context`
  and `partialWorkNoted` correctly session-scoped; rejected gates clear the shared green latch.
- `hashline`: bounded read/edit preflight (16 MiB); hex tags only.

### Removed

- The `plan-weaver` (v4) extension and its `plan-contract` lib (ported into plan-runner).
- **Retired candidates (2026-07-31 and 2026-08-03, each on its own pre-registered grounds):**
  Tier 0 (c1/c5/c8/c9/c15 — structurally inert), c33, the c40–c45 planner family, c7, c14
  (slug tags, with `tag-words.ts`), c32 (sha-guard), c37 (`PLAN_DELEGATE_ALL`), c50
  (`spec-adherence` extension). Their result rows remain as history.
- The optimizer is **mothballed** (`optimizer/docs/MOTHBALLED_2026-08-03.md`) — code and data
  retained, no longer the default path.

## 0.3.0 - 2026-07-19

### Added

- Release-ready npm metadata, a reproducible lockfile, and Linux/macOS CI on Node 22.
- `plan-weaver` and `did-you-mean` to the default extension set.
- The bundled `pi-subagent` extension to the package manifest.
- Canonical `test`, `typecheck`, `health`, `pack:smoke`, and `verify` commands.
- Package-content and extension-load smoke coverage before release.

### Changed

- Type-checking now covers the complete harness from a normal root `npm ci`; it no longer relies on user-specific absolute symlinks.
- The health check is read-only and works in both a clean clone and an installed harness with local configuration.

### Security

- The fault-injection-only `chaos` extension and policy are excluded from the published artifact and default manifest.
- CI uses read-only repository permissions.

## 0.2.0

- Previous development release of the harness and measurement-gated optimizer.
