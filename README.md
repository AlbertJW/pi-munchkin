# pi_munchkin

<p align="center">
  <img src="assets/pi-munchkin.png" alt="pi-munchkin mascot" width="320">
</p>

> A harness for making small, locally served LLMs competent multi-turn coding agents.

The limiting failure is not usually context size. Across 1,505 measured sessions, the median
session used about 4.9k context tokens, while the longest 10% of sessions carried 43% of all
wasted tool calls. The characteristic failure is a repeat-call spiral: retrying the same broken
operation, making a token edit, then restarting the same episode.

Pi Munchkin therefore concentrates on runtime mechanisms: anchored edits, ordered verification
evidence, bounded reads and output, structured plans, repeat detection, and additive tool
activation. Every mechanism is reversible. A mechanism firing is evidence that its implementation
works; it is not evidence that it improves outcomes.

> **Measurement correction (2026-07-27):** most historical A/B rounds used n=3–9 per arm,
> scored pass/fail for interventions aimed at efficiency, and could not show that 40 of 45
> candidate mechanisms fired. Every pre-2026-07-27 `NEUTRAL` is a historically recorded verdict
> whose current status is **UNTESTED**, not rejected.

The optimizer is [archived in place](optimizer/docs/MOTHBALLED_2026-08-03.md). Its source, raw
results, methodology, and tests are retained for audit and possible restart, but it is not part of
the getting-started path. No optimizer candidate is adopted or deleted without a separate human
decision.

## What the harness does

| Surface | Role |
|---|---|
| `hashline` | transactional tag-anchored edits; refuses oversized text and image input before allocation |
| `loop-breaker` | detects repeated calls, reasoning, outcomes, thrown/rejected executions, and session-wide grinding |
| `verify-gate` | accepts only ordered successful verification evidence after the latest source mutation |
| `plan-runner` | model-owned structured work items with deduplicated one-shot gate receipts |
| `git-guard` | confirms commands that could discard uncommitted work |
| context and Bash guards | block oversized provider-bound input/output instead of silently truncating it |
| blackboard | persists bounded redacted state and renders a private human cockpit outside repositories |
| `ketch` | bounded public web search/read with URL and redirect validation |
| `subagent` | isolated exploration, execution, and review with a constrained child environment |
| `compact_context` | explicit structured compaction with one resume handoff |
| dynamic activation | keeps expensive/large tools absent until evidence says the session needs them |
| telemetry and surface receipts | bounded mechanism evidence and exact harness-surface provenance |
| shadow run kernel | canonicalizes Pi lifecycle/tool events into a typed, redacted per-run state machine without changing agent behavior |

Additional extensions provide span retrieval, reflection, drift review, teaching hints, path
suggestions, context receipts, and experimental dark mechanisms. The authoritative ordered
extension and skill surface is the `pi` manifest in [`package.json`](package.json).

Default-on teaching hints, did-you-mean, and the state lens are reversible and
mechanism-observed; their benefit has not been established by a powered trial.

## Install

Node.js 22.6 or newer is required. Pi 0.80.6 through 0.83.x is supported.

```sh
pi package install github:AlbertJW/pi-munchkin
```

When published, `pi package install pi-munchkin` is equivalent. Package installation is strongly
preferred: the manifest includes the vendor subagent, role prompts, `APPEND_SYSTEM.md`, examples,
and both skills as well as extensions and libraries. A hand-maintained copy list is not a safe
installation procedure because it can silently omit transitive behavior. If an operator must
maintain a live unpacked mirror, derive it from the package manifest and validate it with:

```sh
npm run mirror:check -- /absolute/path/to/.pi/agent
```

The checker covers first-party extensions, libraries, vendor subagent code, role prompts,
`APPEND_SYSTEM.md`, examples, and skills. Extra documented local-only files are ignored.

The benchmark-only `harness/extensions/chaos.ts` is deliberately absent from the release manifest
and tarball.

## Use

Most behavior is automatic. The primary commands are:

- `/plan <request>` and `/plan-go` for structured execution with per-item gates.
- `/reflect` for a fresh-context adversarial review.
- `/compact` for explicit compaction.
- `/blackboard` for current redacted state and the private cockpit path.
- `/skill:deep-research <question>` for bounded research.
- `/ketch-status` for public-search backend health.
- `/loop-status` for a redacted failure-episode summary; `/loop-resume` clears exact episode
  walls and sends one deterministic recovery instruction.
- `/munchkin-doctor` for redacted Pi/model capability, canonical tool-provenance, retry/timeout,
  and declared sandbox posture.

### Current defaults and rollback controls

| Environment option | Default and behavior | Rollback / alternative |
|---|---|---|
| `MUNCHKIN_TOOL_ACTIVATION` | `dynamic`; defers `subagent` and `compact_context` only when Pi exposes the complete default registry | `ambient` leaves Pi's initial surface untouched |
| dynamic `subagent` triggers | multi-item structured execution, second plan-gate failure, or loop-breaker tier two | once activated it stays active; one automatic attempt means a later manual `/tools` disable is respected |
| dynamic `compact_context` trigger | first crossing of 60% context usage | same one-attempt/manual-disable rule |
| `CONTEXT_SURFACE_MODE` | `summary`; samples usage on first call, each eighth call, threshold crossings, and compaction without transcript hashing | `full` retains receipt calculations; `off` disables; gate sessions force `full` |
| `CTX_REDUNDANCY_NUDGE=on` | opt-in duplicate-analysis nudge | forces `CONTEXT_SURFACE_MODE=full` because its mechanism requires duplicate analysis |
| `STATE_LENS` | `steer`; injects only on loop-breaker events with cooldown | `off` kills it; `view` restores per-call view injection; `both` enables both paths |
| `STATE_LENS_MAX_CHARS` | bounds lens text | lower it to reduce model-visible state |
| `BLACKBOARD` | `on`; bounded/redacted v2 persistence and cockpit | `off` disables cockpit and lens state |
| `HASHLINE_MAX_READ_BYTES` | 16 MiB text preflight limit | set an explicit byte limit; `limit` still controls returned context, not file allocation |
| `HASHLINE_MAX_EDIT_BYTES` | 16 MiB edit preflight limit | set an explicit byte limit |
| image reads | fixed 4 MiB preflight limit | use a purpose-built image workflow for larger files |
| `PI_SUBAGENT_ENV_ALLOW` | empty; comma-separated extra child environment variable names | names are validated; values are copied without logging |
| subagent fixed allowlist | includes provider essentials and `LLAMA_API_KEY` | secrets are never included in telemetry or user-facing diagnostics |
| `DRIFT_SCANNER` | active after `agent_settled`, when Pi declares the run settled | `off` disables; a new run aborts an in-flight review and stale findings are dropped |
| `LOOP_EPISODE_MODE` | `shadow`; records semantic episodes, session-window and correlated overrun, and the 7/11/28 session-tail tiers without steering or blocking | `off` disables collection; `enforce` enables the dark 2/4/6 semantic and 7/11/28 session ladders only after a separate adoption gate |
| `LB_EPISODE_T1`, `LB_EPISODE_T2`, `LB_EPISODE_T3` | `2`, `4`, `6` semantic failures | explicit integer overrides; only exact previously repeated calls are walled |
| `LB_SESSION_T1`, `LB_SESSION_T2`, `LB_SESSION_T3` | `7`, `11`, `28` cumulative repeats under enforcement | `LB_SESSION_REPEAT` remains the authoritative legacy 25-repeat steer in shadow mode and is a compatibility alias for enforced Tier 1 |
| `PI_SANDBOX_POSTURE` | `unknown`; `/munchkin-doctor` accepts only `declared` or `host` as operator assertions | unset it to return to `unknown`; this label is observational and grants no isolation |
| `TEACH_HINTS`, `DID_YOU_MEAN` | default-on bounded hints | set either to `off` |
| `FORCE_PLAN_WRITE` | default-on; blocks the FIRST unplanned mutation with a message naming the `plan_write` → `plan_go` path; never re-arms once a plan exists; gemma-family models are skipped in code (measured collapse) | `off` |
| `PLAN_UNCERTAINTY` | default-on; `plan_write` accepts `uncertainties[]` and execution holds while any remain (clear with `[]`) | `off` restores the legacy schema |
| `PLAN_ITEM_GUIDANCE_V2` | default-on; need-sized plan-item wording | `off` restores the "5-10 ordered items" wording |
| `PLAN_TOOL_GO` | default-on; the model-callable `plan_go` tool (same validation as `/plan-go`) | `off` removes the tool |
| `SPAWN_DELEGATION` | default-on; delegation guidance recommends `mode=spawn` with self-contained tasks | `off` restores the fork wording |
| `TOOL_CALL_RESCUE` | default-on; one corrective steer (max 2/session) when a session dies on a text-only pseudo tool call | `off` |
| `CONTEXT_BRIEF` | default-on; a cached per-session environment brief appended to the system prompt (`CONTEXT_BRIEF_BYTES` bounds it) | `off` |
| `READ_DEDUP` | default-on; later identical `read` results collapse to a back-reference in the per-call context view | `off` |
| `SPAN_TOOLS` | default-on; `search_spans`/`read_span` for bounded work on large files | `off` removes both tools |
| `KETCH` | default-on public search/read | `off` for offline/private sessions |
| `RESEARCH_LEDGER` | dark (`on` enables the parent-verified citation pipeline: session page cache, genuine-error `research_note`, recovery-only `research_recall`, budget footers, and a private bounded v2 JSONL ledger under `${PI_CODING_AGENT_DIR}/artifacts/research-ledgers/`) | unset keeps both research-note tools absent; no project-local ledger is written |
| `RUN_KERNEL` | `shadow`; observes canonical execution receipts, semantic phases, lifecycle settlement, and legacy-state disagreements | `off` registers no kernel handlers or event-bus subscriber; shadow mode never prompts, steers, blocks, activates tools, or persists a capsule |
| `VERIFY_EXECUTION_ORDER` | unset retains the deployed transcript-order gate while PR 2 is dark | `execution` uses Pi start/end order and rejects overlapping or missing-start verification; `legacy` explicitly selects the deployed path |
| `ACTIVE_TOOL_PROMPTS` | unset retains the deployed ambient plan/delegation/compaction guidance while PR 2 is dark | `active` removes the ambient block and lets Pi include definition-owned guidance only for active tools; manual disable removes it |
| `VERIFY_GATE`, `LOOP_BREAKER`, `GIT_GUARD`, `HASHLINE` | default-on core mechanisms | each accepts its documented `off` kill switch |

Oversized hashline refusals explain the distinction between the returned-context `limit` and the
allocation cap. Use `search_spans`/`read_span` (default-on), or `rg`, `head`, `tail`, for
oversized files.

## Security and privacy boundaries

- Cockpits are written atomically with private permissions to
  `${PI_CODING_AGENT_DIR}/artifacts/session-cockpits/<sha256(cwd)>.html`, outside the working
  repository. The final render is awaited exactly once at `agent_settled`; `agent_end` remains
  available for per-run cleanup and may be followed by retry or compaction.
- Blackboard attempt keys are hashed. Persisted labels, errors, telemetry, and notifications are
  redacted and bounded; v1 restores intentionally discard raw attempt/delegation ledgers.
- Research ledgers are private `0600` JSONL audit data outside the worktree. URL query strings and
  fragments are never persisted; recalled claim and quote fields remain untrusted evidence, never
  instructions. Delegated citations must be re-read by the parent before they can be recorded.
- Tier-three loop recovery receipts are atomically written with private permissions to
  `${PI_CODING_AGENT_DIR}/artifacts/loop-recovery/<sha256(cwd)>.json`. They contain only safe
  failure classes, bounded tool families, hashes, gate booleans, and the harness surface hash.
- URL checks canonicalize IPv4 and IPv6, reject non-global addresses, and validate every DNS and
  redirect hop. DNS answers can still change between validation and the downstream client's
  connection; this explicit DNS-rebinding/TOCTOU limitation is not a socket-level IP pin.
- Subagents inherit only a fixed environment allowlist plus validated names explicitly added via
  `PI_SUBAGENT_ENV_ALLOW`. Values are never logged.
- `npm run secret-scan:diff` inspects staged, unstaged, and untracked added lines. Findings contain
  only file, line, and pattern ID; matched text is never printed.
- Extensions run with the Pi process's permissions. Keep machine settings, credentials, and
  private endpoints out of this public repository.
- Provider timing rows are numeric and observational: request-to-headers, first token, stream
  completion, and settlement. The harness does not retry or abort slow local inference; Pi's
  configured retry and timeout behavior remains authoritative.
- Run-kernel receipts and state contain hashes, bounded tool/failure classifications, counters,
  and booleans only—never prompts, arguments, commands, output, errors, URLs, endpoints, or paths.
  The PR 1 kernel is in-memory observation, not session memory and not trusted instructions.
- Shell command policy is not process isolation. Use Pi's upstream
  [security guidance](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)
  and [containerization guidance for OpenShell, Gondolin, and Docker](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md)
  when isolation is required.

See [`.github/SECURITY.md`](.github/SECURITY.md) for private vulnerability reporting.

## Verify and package

```sh
npm ci
npm run verify
```

`verify` is network-independent and runs the complete discovered Node test suite, TypeScript
checking against the locked Pi 0.80.6 lower bound, health checks, a local pack/extract/load smoke,
and the archived optimizer's offline integrity battery. Do not rely on a hard-coded test count;
the command output is authoritative.

Useful lanes:

```sh
npm test
npm run typecheck
npm run health
npm run pack:smoke
npm run verify:optimizer
npm run secret-scan:diff
```

The registry-dependent CI matrix is deliberately separate from `verify`. It installs the packed
tarball into isolated consumers using the latest available 0.80, 0.81, 0.82, and 0.83 releases,
typechecks the shipped TypeScript, loads every extension, and discovers both skills. A separate
job proves strict peer-install behavior below, at, within, and at the upper support boundary.

Before any public push: inspect the diff, run the non-echoing secret scan, run `npm run verify`,
and confirm unrelated user changes are not staged. After an approved live rollout, run the mirror
checker and load the live harness through the target Pi version. Never commit or push from the
live harness repository.

## Measurement archive

The historical optimizer remains under [`optimizer/`](optimizer/). Preserve its source, raw
results, preregistrations, methodology, and tests. It is an audit archive, not a source of current
candidate verdicts.

Pass/fail is useful as a **harm guard**: at the historical sample sizes it could detect large
regressions. Candidate decisions aimed at efficiency require continuous effort measures (tool
calls, repeated calls, errors, turns, and tokens), explicit mechanism exposure, an in-band task,
and adequate power. Measurements from different model-visible surface hashes must never be pooled.

Start with:

- [`MEASUREMENT_METHODOLOGY_2026-07.md`](optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md) — the
  invalidity boundary and replacement method.
- [`MOTHBALLED_2026-08-03.md`](optimizer/docs/MOTHBALLED_2026-08-03.md) — archive status and restart
  conditions.
- [`HARNESS_SELF_IMPROVEMENT.md`](optimizer/docs/HARNESS_SELF_IMPROVEMENT.md) — historical ledger,
  with its unsupported-verdict warning.

No gate round starts automatically. Only one round may run on a serving box at a time, and every
adoption or deletion remains a human decision.

## License

[MIT](LICENSE). Bundled third-party notices are in [NOTICE.md](NOTICE.md).
