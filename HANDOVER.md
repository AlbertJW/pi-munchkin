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

## 2026-08 hardening series

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
> telemetry now emits a per-process `si` id, `shadow_report.py` binds one surface hash and
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

- `MUNCHKIN_TOOL_ACTIVATION=dynamic`: defer `subagent` and `compact_context` only on a complete
  default Pi registry; preserve narrowed explicit `--tools` selections. Subagent activates on
  multi-item execution, second plan-gate failure, or loop tier two. Compact activates at 60%.
  `ambient` is the rollback.
- `CONTEXT_SURFACE_MODE=summary`: no transcript hashing or duplicate analysis on the default path.
  `full` restores receipts; `off` disables. Gate sessions and `CTX_REDUNDANCY_NUDGE=on` force full.
- `STATE_LENS=steer`: only loop-breaker events inject state, under cooldown. `view` and `both` are
  experiments; `off` is the kill switch.
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
3. Load the live harness through Pi 0.83 and confirm every declared extension and skill.
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

## Optimizer archive

The optimizer is historical/unsupported but retained in place. Keep its code, raw results,
methodology, preregistrations, and tests. Do not delete it and do not put it back into the default
getting-started path.

Pass/fail can guard against large harm. Positive efficiency decisions require continuous effort
metrics, mechanism exposure, adequate power, and an in-band task. If the optimizer is ever
restarted, re-baseline on the then-current model-visible surface and obtain explicit approval
before consuming a serving box.
