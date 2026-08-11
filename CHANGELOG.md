# Changelog

All notable changes to pi-munchkin are documented here. Releases follow semantic versioning.

## Unreleased

Brought current 2026-08-05 (had been stale since 2026-07-22 and still described since-deleted
candidates as dark). Net changes since 0.3.0; the full per-decision record is
`optimizer/docs/DARK_CANDIDATE_VERDICTS_2026-08-03.md` and the ledger.

### Added

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
  human review. Selection rule preregistered in `PREREG_FIXTURE_BAND_2026-08-11.md`.
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
  (default mode `steer` since 2026-08-04; `STATE_LENS=off|view|both`), `teach-hints`
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

### Fixed

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
