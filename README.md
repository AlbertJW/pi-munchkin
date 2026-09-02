# pi_munchkin

<p align="center">
  <img src="assets/pi-munchkin.png" alt="pi-munchkin mascot" width="320">
</p>

> A harness for making small, locally served LLMs competent multi-turn coding agents.

**Status:** a personal research project, under active development. Licensed [MIT](LICENSE).

Small language models that run on your own machine are cheap and private, but they make poor
coding assistants: left alone, they get stuck repeating the same broken action — re-reading a
file, re-running a command that already failed, making a token edit and starting over. pi_munchkin
is a set of runtime guardrails that wrap such a model while it works. It watches for those loops
and interrupts them, refuses to accept a task as "done" until the project's own checks have
actually passed after the last edit, and asks before any command that could throw away
uncommitted work.

## In one look

A small model, editing a file, re-runs the same read after a change that didn't land — and the
harness interrupts it:

```
  > read  src/handler.ts     (attempt 1 — no edit follows)
  > read  src/handler.ts     (attempt 2 — still no edit)

  [loop-breaker] Repeated read src/handler.ts 2×, no file change. You have this.
  Do ONE now: edit · mark blocked + stop · name the one missing fact + how
  you'll get it. Don't re-run that read/grep/command.
```

The bracketed line is the harness's real steer text — byte-identical to the template in the source
(the tests hold it to that). The two tool calls above it are illustrative: the harness deliberately
never records the commands a model runs, so it cannot show you a real one. In the local telemetry
sample bundled with development, this loop-breaker steer fired 152 times, 114 of them at the
two-repeat threshold shown here. That is evidence the mechanism runs as built. It is **not**
evidence that it improves the final result — see [What the evidence shows](#what-the-evidence-shows-and-does-not).

## What the harness does

Each guardrail is an independent, reversible extension. Plain-English gloss first, exact role
second.

- **`hashline`** — makes edits by matching a unique anchor in the file, so a change either lands
  exactly where intended or is refused. *Transactional tag-anchored edits; refuses oversized text
  and image input before allocation.*
- **`loop-breaker`** — notices when the agent keeps repeating the same failing action and tells it
  to stop and do something else. *Detects repeated calls, reasoning, outcomes, thrown/rejected
  executions, and session-wide grinding.*
- **`verify-gate`** — only treats work as done once the project's checks have actually run and
  passed after the last edit. *Accepts only ordered successful verification evidence after the
  latest source mutation.*
- **`plan-runner`** — lets the agent keep a bounded checklist of intended work while project
  verification remains session-owned. *Model-owned stable-ID work items with structural writes
  and small status deltas; no per-item correctness or gate receipts.*
- **goal mode** — keeps a persistent project/worktree outcome across planner exit, compaction,
  recovery, and model switches. *`/goal` starts one, `goal_propose` is advisory until
  `/goal-accept`, and `goal_settle` records evidence-backed completion or an explicit 80/20
  acceptance with residual risks.*
- **`git-guard`** — asks for confirmation before any command that could discard uncommitted work.
  *Confirms commands that could discard uncommitted work.*
- **context and Bash guards** — refuse oversized input or output instead of silently cutting it off
  half-way. *Block oversized provider-bound input/output instead of silently truncating it.*
- **blackboard** — keeps a small, redacted running summary of the session and a private local
  dashboard to view it. *Persists bounded redacted state and renders a private human cockpit
  outside repositories.*
- **`ketch`** — bounded web search and page reading, with address and redirect checks. *Bounded
  public web search/read with URL and redirect validation.*
- **`subagent`** — runs a side-task in an isolated child with a restricted environment. *Isolated
  exploration, execution, and review with a constrained child environment.*
- **`compact_context`** — lets the agent summarise its own conversation to free up room, with one
  clean handoff. *Explicit structured compaction with one resume handoff.*
- **dynamic activation** — keeps heavier tools hidden until the session shows it needs them. *Keeps
  expensive/large tools absent until evidence says the session needs them.*
- **telemetry and surface receipts** — record that a mechanism fired (counts only) and exactly
  which build of the harness was loaded. *Bounded mechanism evidence and exact harness-surface
  provenance.*
- **shadow run kernel** — quietly turns the session's events into a typed record for auditing,
  without changing what the agent does. *Canonicalizes Pi lifecycle/tool events into a typed,
  redacted per-run state machine without changing agent behaviour.*

Additional extensions provide span retrieval, observational memory, drift review, teaching hints, path
suggestions, context receipts, and experimental dark mechanisms. The authoritative ordered
extension and skill surface is the `pi` manifest in [`package.json`](package.json).

Default-on teaching hints, did-you-mean, and the state lens are reversible and mechanism-observed;
their benefit has not been established by a powered trial.

## What the evidence shows (and does not)

The limiting failure is not usually context size. Across 1,505 measured sessions, the median
session used about 4.9k context tokens, while the longest 10% of sessions carried 43% of all
wasted tool calls. The characteristic failure is a repeat-call spiral: retrying the same broken
operation, making a token edit, then restarting the same episode. The mechanisms above target
that failure directly.

**A mechanism firing is evidence that its implementation works; it is not evidence that it
improves outcomes.** Every mechanism is reversible, and none is claimed here to make the agent
measurably better — only to do the specific thing it was built to do.

> **Measurement correction (2026-07-27):** most historical A/B rounds used n=3–9 per arm,
> scored pass/fail for interventions aimed at efficiency, and could not show that 40 of 45
> candidate mechanisms fired. Every pre-2026-07-27 `NEUTRAL` is a historically recorded verdict
> whose current status is **UNTESTED**, not rejected.

The optimizer was [mothballed 2026-08-03](optimizer/docs/MOTHBALLED_2026-08-03.md) and
[rebooted 2026-08-15](optimizer/docs/UNMOTHBALL_2026-08.md) around graded outcomes and a
per-trial validity rubric. It is still not part of the getting-started path; rounds are
human-started, one at a time, and no candidate is adopted or deleted without a separate human
decision.

---

Everything below is implementation detail: installation, day-to-day commands, the full
configuration surface, security boundaries, and the measurement archive.

## Install

Node.js 22.6 or newer is required. Pi 0.80.6 through 0.84.x is supported.

```sh
pi package install github:AlbertJW/pi-munchkin
```

When published, `pi package install pi-munchkin` is equivalent. Package installation is strongly
preferred: the manifest includes the vendor subagent, role prompts, `APPEND_SYSTEM.md`, examples,
and both skills as well as extensions and libraries. A hand-maintained copy list is not a safe
installation procedure because it can silently omit transitive behaviour. If an operator must
maintain a live unpacked mirror, derive it from the package manifest and validate it with:

```sh
npm run mirror:check -- /absolute/path/to/.pi/agent
```

The checker covers first-party extensions, libraries, vendor subagent code, role prompts,
`APPEND_SYSTEM.md`, examples, and skills. Extra documented local-only files are ignored.

The benchmark-only `harness/extensions/chaos.ts` is deliberately absent from the release manifest
and tarball.

## Use

Most behaviour is automatic. The primary commands are:

- `/plan <request>` enters a read-only planning surface; `/plan-go` starts execution,
  `/plan-cancel` discards the draft, and `/plan-status` renders the bounded plan. Plans hold at
  most 24 stable-ID items; routine progress uses small `plan_update` deltas. Verification belongs
  to the session, not to individual plan items.
- `/goal <objective>` starts a persistent goal; `/goal-status`, `/goal-pause`, `/goal-resume`,
  and `/goal-cancel` manage it. Goals are private and separate from plan state, so a plan can
  finish while the outcome remains active or resumable. Model-driven goal proposals and updates
  use the deferred `goals` capability (`capability(action="enable", family="goals")`) so the
  low-context core surface stays small.
- With the dark `PLAN_GRAPH=on` candidate, plans may contain bounded parent/child nodes,
  `plan_expand` attaches children, `plan_settle` enforces terminal/evidence conditions, and
  `/plan-status <item-id>` expands one subtree. Ordinary plans remain flat.
- `/blackboard` for current redacted state and the private cockpit path.
- `/skill:deep-research <question>` for bounded research.
- `/ketch-status` for public-search backend health.
- `/loop-status` for a redacted failure-episode summary; `/loop-resume` clears exact episode
  walls and sends one deterministic recovery instruction.
- `/run-status` for a bounded, read-only summary of the authoritative structured run state;
  `/run-new` declares the current run abandoned so the next request starts a fresh run identity.
- `/working-memory-status` for counts and authoritative bytes only. This command and the
  `working_memory` tool exist only when the dark `WORKING_MEMORY=on` candidate is enabled.
- `/munchkin-doctor` for redacted Pi/model capability, canonical tool-provenance, retry/timeout,
  declared sandbox posture, and a `serving_truth` line comparing the local server's actual
  served `n_ctx` against the registry's `contextWindow` (probed once per model after settlement;
  local endpoints only — named hosts and public IPs are never probed). It also reports
  protocol-parity facts such as declared thinking format and observed stream shape without
  exposing prompts, payloads, or thinking text.

Compaction is a tool the model calls (`compact_context`), not a slash command: it summarises the
model's own window in place with one resume handoff.

### Current defaults and rollback controls

| Environment option | Default and behaviour | Rollback / alternative |
|---|---|---|
| `MUNCHKIN_TOOL_PROFILE` | `core`; starts with the coding spine and the single `capability` switch | `ambient` restores Pi's initial surface; genuine CLI/global/project tool selections always win |
| `MUNCHKIN_TOOL_ACTIVATION` | `dynamic`; legacy automatic activation remains available for delegation and context compaction | `ambient` disables automatic activation; `phase` remains experimental |
| `PLAN_STORAGE` | `capsule`; plan JSON, Markdown projection, and trace stay in the private per-run capsule for both forced and adaptive planning | `project` restores historical `.pi/plan-state.json`, `.pi/TODO.md`, and `.pi/traces/`; `/plan-export` explicitly writes the Markdown and JSON review snapshots; `RUN_CAPSULE=off` also selects project storage because no private session identity exists |
| dynamic `subagent` triggers | multi-item structured execution or loop-breaker tier two | once activated it stays active; one automatic attempt means a later manual `/tools` disable is respected |
| dynamic `compact_context` trigger | first crossing of 60% context usage | same one-attempt/manual-disable rule |
| `CONTEXT_SURFACE_MODE` | `summary`; samples usage on first call, each eighth call, threshold crossings, and compaction without transcript hashing | `full` retains receipt calculations; `off` disables; gate sessions force `full` |
| `STATE_LENS` | `steer`; injects only on message-bearing loop-breaker events with cooldown — never at an abort/shutdown boundary, where a steer would fight the hard stop | `off` kills it; the per-call `view|both` modes are retired |
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
| `FORCE_PLAN_WRITE` | `off`; planning is exclusively user-triggered through `/plan` | `on` restores the compatibility behavior that blocks the first unplanned mutation |
| `PLAN_TOOL_GO` | `off`; headless experiments may explicitly expose model-callable `plan_go` | `on` enables it; interactive plans still require the user's `/plan-go` |
| `GOALS` | on; the four `goal_*` tools register (deferred behind the `goals` capability family) and the six `/goal*` commands are available | `off` removes the entire goal surface — tools, commands, and the compaction/recovery goal-brief reads |
| `GOAL_SCOPE` | `worktree`; goal ledgers are private to the current worktree | `project` shares one private ledger across linked Git worktrees via the repository's common root; non-Git directories fall back to their resolved cwd |
| `CONTEXT_HANDOFF` | on; model switches and safe-budget crossings may request one bounded native compaction and follow-up | `off` disables automatic handoff while retaining context profiles |
| `CONTEXT_DISCOVERY` | off; context profiles use model metadata and local serving truth only | `on` sends one synthetic, local-only handshake per serving fingerprint; it never sends transcript or tool data |
| `PLAN_GRAPH` | `off`; graph schemas, `plan_expand`, `plan_settle`, and branch reports are absent. The `planning` capability family itself is always available and additively activates the flat `plan_write`/`plan_update` pair, so skills and models can structure multi-item work without `/plan` (2026-08-25) | `on` enables the reusable v5 graph substrate without activating a skill profile |
| `DEEP_RESEARCH_PLANNING` | `off`; complex research follows the existing bounded skill path | requires `PLAN_GRAPH=on` and `RESEARCH_LEDGER=on`; exposes complex-only `research_plan_start` with a hard 3-search/5-distinct-source-read global envelope, one-shot branch leases, and five parent validation reads |
| `SPAWN_DELEGATION` | default-on; delegation guidance recommends `mode=spawn` with self-contained tasks | `off` restores the fork wording |
| `TOOL_CALL_RESCUE` | default-on; one corrective steer (max 2/session) when a session dies on a text-only pseudo tool call | `off` |
| `CONTEXT_BRIEF` | default-on; a cached per-session environment brief appended to the system prompt (`CONTEXT_BRIEF_BYTES` bounds it) | `off` |
| `READ_DEDUP` | default-on; later identical `read` results collapse to a back-reference in the per-call context view | `off` |
| `SPAN_TOOLS` | default-on; `search_spans`/`read_span` for bounded work on large files | `off` removes both tools |
| `KETCH` | default-on public search/read | `off` for offline/private sessions |
| `RESEARCH_LEDGER` | dark. After three consecutive unverifiable citations, `research_note` stops returning errors and tells the model to cite inline — an uncapped refusal stream escalated loop-breaker to an abort and killed two Run 3 sessions outright. (`on` enables the parent-verified citation pipeline: session page cache, genuine-error `research_note`, recovery-only `research_recall`, a hard 3-search/5-distinct-read skill envelope even outside a plan graph, budget footers, and a private bounded v2 JSONL ledger under `${PI_CODING_AGENT_DIR}/artifacts/research-ledgers/`) | unset keeps both research-note tools absent; no project-local ledger is written |
| `RESEARCH_BUDGET` | unset; opt-in budget-only comparison control. (`on` enforces the same non-graph 3-search/5-distinct-read wall as the ledger without registering research-note/recall tools, writing a ledger, exposing ledger state, caching pages, adding budget footers, or steering at wrap-up) | unset leaves the fully legacy ledger-off path unchanged; `RESEARCH_LEDGER=on` implies the wall |
| `RUN_KERNEL` | `shadow`; observes canonical execution receipts, semantic phases, lifecycle settlement, and legacy-state disagreements | `off` registers no kernel handlers or event-bus subscriber; shadow mode never prompts, steers, blocks, activates tools, or persists a capsule |
| `RUN_CAPSULE` | `recovery` (adopted 2026-08-24, Albert-approved judgment adoption — AVO's resume-from-state pillar); checkpoints the closed RunState contract to a private per-run JSON authority AND injects one bounded recovery brief on the events in the next row | `shadow` restores persist-without-injection; `off` registers no capsule handlers or command |
| `RUN_CAPSULE=recovery` recovery brief | active by default; emits one bounded brief only after compaction, an unsettled provider retry, or an explicit resume command — ordinary turns receive no capsule context and manual resume never starts a provider request | `shadow` or `off` |
| `WORKING_MEMORY` | `off`; the tool, command, handlers, schema, snippets, and guidance are absent | `on` adds an explicit, private, per-run notebook of at most 32 untrusted model notes; it requires the matching run-capsule identity and never injects notes automatically |
| `VERIFY_EXECUTION_ORDER` | `execution`; Pi start/end order uses a conservative mutation epoch, so starts, failures, overlaps, and missing events invalidate earlier green evidence | `legacy` temporarily restores transcript-order evaluation |
| `verify_project` | registered only when an exact project gate exists; runs that gate without a model-supplied command and returns bounded sanitized diagnostics | exact Bash execution remains compatible, but pipes/wrappers cannot count as exact evidence |
| `VERIFICATION_PLATEAU` | `enforce` (adopted 2026-08-24, Albert-approved judgment adoption — AVO's supervisor pillar); after three successful mutation→recognized failed-TAP epochs with no frontier advance it proposes ONE arbiter-owned correction, plus an additive capability request at five; it never aborts | `shadow` records the same plateaus without steering; `off` disables collection |
| `ACTIVE_TOOL_PROMPTS` | `derived`; inactive tools contribute no ambient guidance and Pi supplies definition-owned guidance only for active tools | `ambient` restores the broader legacy prompt; manual `/tools` disable removes active-tool guidance |
| `CONTROL_ARBITER` | `enforce`; one highest-priority corrective voice acts per boundary, with bounded lens/verification supplements where applicable | `shadow` restores legacy producer delivery while recording the winner; `off` removes the arbiter while typed plan/context/loop signals continue |
| `TELEMETRY_WRITER` | `sync`; gate source and inherited-FD telemetry are always synchronous | `async` enables the bounded ordered interactive file writer; settlement and shutdown await its flush |
| `TELEMETRY_ASYNC_MAX_ROWS`, `TELEMETRY_ASYNC_MAX_BYTES` | `1024` rows and `1 MiB`; cap queued observational telemetry | bounded to 8–65,536 rows and 4 KiB–64 MiB; overflow is dropped and later reported as a count only |
| `TELEMETRY_ASYNC_BATCH_ROWS`, `TELEMETRY_ASYNC_BATCH_BYTES` | `64` rows and `64 KiB`; coalesce ordered writes without an unbounded timer | bounded to 1–512 rows and 1 KiB–1 MiB per batch |
| `VERIFY_GATE`, `LOOP_BREAKER`, `GIT_GUARD`, `HASHLINE` | default-on core mechanisms | each accepts its documented `off` kill switch |

Oversized hashline refusals explain the distinction between the returned-context `limit` and the
allocation cap. Use `search_spans`/`read_span` (default-on), or `rg`, `head`, `tail`, for
oversized files.

The built-in `read` inlet also refuses an unbounded normal file above 32 KiB or a risky support
file above 8 KiB. Large files remain available in pages of at most 200 lines, through span tools,
or through targeted shell searches. This prevents several individually legal reads from silently
consuming the server's remaining context in one turn.

Provider request patience belongs to Pi itself: set `httpIdleTimeoutMs` in `settings.json`.
The former `provider-patience` extension and its environment knobs were retired after live tracing
proved that Pi installs a separate npm-undici fetch/dispatcher, making the shim inert in Pi
sessions.

## Security and privacy boundaries

- Cockpits are written atomically with private permissions to
  `${PI_CODING_AGENT_DIR}/artifacts/session-cockpits/<sha256(cwd)>.html`, outside the working
  repository. The final render is awaited exactly once at `agent_settled`; `agent_end` remains
  available for per-run cleanup and may be followed by retry or compaction.
- Blackboard attempt keys are hashed. Failures in snapshots, the lens, cockpit, telemetry, and
  notifications use only the shared fixed `FailureClass` vocabulary; raw tool error prose is not
  retained. Labels are redacted and bounded, and v1 restores intentionally discard raw
  attempt/delegation ledgers.
- Research ledgers are private `0600` JSONL audit data outside the worktree. URL query strings and
  fragments are never persisted; recalled claim and quote fields remain untrusted evidence, never
  instructions. Delegated citations must be re-read by the parent before they can be recorded.
  Per-ledger appends serialize the capacity check and write, so concurrent notes cannot exceed the
  256 KiB ceiling.
- Run capsules use unique private directories below
  `${PI_CODING_AGENT_DIR}/artifacts/run-capsules/<sha256(cwd)>/<run-uuid>/`. The `0600`
  `state-v1.json` file and Pi `run_state_v1` custom entry are structured restore authorities;
  `capsule.md` is only a deterministic, bounded, untrusted projection. Normal runs never inject
  it into model context, paths are not exposed by `/run-status`, and retention is manual.
- With `WORKING_MEMORY=on`, that exact capsule directory also holds an 8 KiB-bounded
  `working-memory-v1.json` authority and an untrusted `working-memory.md` projection. Notes are
  sanitized, limited to 240 UTF-8 bytes, and never treated as plans, evidence, verification, or
  instructions. Restore requires the exact project, capsule, and run identities; the harness
  never scans for a plausible older notebook. Telemetry and `/working-memory-status` expose only
  counts, hashes, booleans, and byte totals—not note text or artifact paths.
- Plan state, its Markdown projection, and the bounded plan trace share that run-capsule directory
  by default and use `0600` files. Normal planning therefore creates no `.pi` worktree artifacts.
  `/plan-export` deliberately writes `.pi/TODO.md` plus the explicit review snapshot
  `.pi/plan-review.json`; neither is authoritative. `PLAN_STORAGE=project` is the full legacy
  rollback. Observational memory remains the sole narrative recall layer; it cannot complete plan
  items, verify work, close failure episodes, mutate files, or override repository evidence.
- Recovery mode projects a deterministic brief of at most 2 KiB with fixed untrusted-data fences.
  It is offered once after a compaction generation or an unsettled provider failure, and `/run-resume`
  and `/loop-resume` append it with `triggerTurn=false`; they do not choose a model or start a
  provider request. The brief is evidence, never a persisted model-generated summary.
- Tier-three loop recovery receipts are atomically written with private permissions to
  `${PI_CODING_AGENT_DIR}/artifacts/loop-recovery/<sha256(cwd)>.json`. They contain only safe
  failure classes, bounded tool families, hashes, gate booleans, and the harness surface hash.
- URL checks canonicalize IPv4 and IPv6, reject non-global addresses, and validate every DNS and
  redirect hop. DNS answers can still change between validation and the downstream client's
  connection; this explicit DNS-rebinding/TOCTOU limitation is not a socket-level IP pin.
- Subagents inherit a fixed environment allowlist (provider essentials), the harness configuration
  keys — so a parent's explicit `X=off` suppression holds inside children instead of silently
  reverting to the default-on behaviour — plus validated names explicitly added via
  `PI_SUBAGENT_ENV_ALLOW`. Fault injection (`CHAOS`), process-local telemetry fds, and per-process
  run identity deliberately do not cross. Values are never logged.
- Graph-planned research passes a bounded context through a private per-call temporary artifact.
  A depth-one `research-planner` may dispatch at most two non-planning `research-scout` leaves;
  its validated terminal report returns to the parent through the event bus. Children never write
  the parent capsule, and every delegated source used at settlement must have a successful
  parent-session `research_note` record.
- `npm run secret-scan:diff` inspects staged, unstaged, and untracked added lines, plus the added
  lines of every committed-but-unpublished commit, so a commit→scan→push sequence cannot report
  clean on committed content. It gates a RANGE, not the tree, and is only as good as its
  baseline: `SECRET_SCAN_BASE`, else the PR base, else `GITHUB_EVENT_BEFORE` (a push to `main`
  publishes content that `origin/main...HEAD` cannot see), else `origin/main`. A checkout where
  none of those resolve FAILS the scan — it never reports "clean" on a range it did not read, and
  an empty range is reported as `nothing pending`, not as clean. Findings contain only file,
  line, and pattern ID; matched text is never printed. Untracked symlinks and other non-regular
  entries are refused without following them.
- Verification-gate path scoping resolves symlinks (including the nearest existing parent for a
  new file) before deciding whether a built-in edit belongs to the current project. Resolution
  uncertainty keeps the gate armed.
- Extensions run with the Pi process's permissions. Keep machine settings, credentials, and
  private endpoints out of this public repository.
- Provider timing rows are numeric and observational: request-to-headers, first token, stream
  completion, and settlement. The harness does not retry or abort slow local inference; Pi's
  configured retry and timeout behaviour remains authoritative.
- Both synchronous and asynchronous telemetry writers create `0700` directories and `0600` files;
  rotated generations remain `0600`. `/runtime-status` reports only whether an endpoint is
  configured, never the URL, hostname, port, credentials, or path.
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
npm run verify -- --serial   # stages one at a time, if a concurrent failure is hard to read
npm run mirror:apply         # copy the manifest's first-party files into a live agent dir
```

`verify` runs its six independent stages concurrently (~13s rather than ~40s), capturing each
stage's output and printing it grouped so a failure is always attributable. Every stage runs to
completion even after one fails, so a single run reports every problem.

`mirror:apply` refuses to run from a dirty or unpushed checkout: a live harness must be
reproducible from the public repository. `mirror:check` now also fails when the live extensions
directory holds a `.ts` file the manifest does not declare — pi auto-loads those, so an extension
dropped from the manifest would otherwise keep running forever with the check still green.

The registry-dependent CI matrix is deliberately separate from `verify`. It installs the packed
tarball into isolated consumers using the latest available 0.80, 0.81, 0.82, 0.83, and 0.84
releases,
typechecks the shipped TypeScript, loads every extension, and discovers both skills. A separate
job proves strict peer-install behaviour below, at, within, and at the upper support boundary.

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
