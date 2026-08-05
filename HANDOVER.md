# Handover — pi_munchkin, 2026-08-04

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
- Drift review starts only after the run settles (`agent_settled`), aborts on a new
  run/shutdown, and drops stale advice.
- Cockpits live under `${PI_CODING_AGENT_DIR}/artifacts/session-cockpits/`, never in a project.
- Text read/edit preflight defaults are 16 MiB (`HASHLINE_MAX_READ_BYTES`,
  `HASHLINE_MAX_EDIT_BYTES`); images above 4 MiB are refused before allocation.
- `PI_SUBAGENT_ENV_ALLOW` accepts validated extra environment names. The fixed list includes
  `LLAMA_API_KEY`; values are copied without logging.

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
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Optimizer archive

The optimizer is historical/unsupported but retained in place. Keep its code, raw results,
methodology, preregistrations, and tests. Do not delete it and do not put it back into the default
getting-started path.

Pass/fail can guard against large harm. Positive efficiency decisions require continuous effort
metrics, mechanism exposure, adequate power, and an in-band task. If the optimizer is ever
restarted, re-baseline on the then-current model-visible surface and obtain explicit approval
before consuming a serving box.
