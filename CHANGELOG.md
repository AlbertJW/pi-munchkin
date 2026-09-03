# Changelog

All notable changes to pi-munchkin are documented here. Releases follow semantic versioning.

## Unreleased

### Fixed (2026-09-03 — fail closed on planner dispatch and profile gaps)

- Root research dispatch now rejects a missing dispatch epoch instead of
  defaulting it to epoch zero. Every lease acquired for that attempt is
  released and the parent dispatch guard remains unchanged, so a branch that
  disappears cannot launch an unmergeable child. v5 reload also treats
  `evidence_gaps` as a research marker: gaps without a valid deep-research
  profile are rejected rather than downgraded to ordinary work. Both targeted
  regressions were red before their fixes and green afterward; planner flags
  remain dark and no inference, mirror, rollout, or push occurred.

The source surface is now `f2400010…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — preserve research profile settlement gates)

- v5 planner reload now rejects a malformed or missing deep-research profile
  when research node markers are present. Previously a tampered profile could
  be discarded and the graph reloaded as ordinary work, bypassing parent-source
  validation at settlement. The targeted settlement regression is red before
  the fix and green afterward; planner flags remain dark and no inference,
  mirror, rollout, or push occurred.

The source surface is now `9dadc7d1…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — reject oversized persisted planner graphs)

- Planner reload now fails closed when private state contains more than the
  bounded 24-node graph limit. Previously migration sliced the tail before
  validation, allowing a later mutation to operate on a silently different
  graph. A targeted regression is red before the guard and green afterward;
  planner flags remain dark and no inference, mirror, rollout, or push occurred.

The source surface is now `0d045321…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — research-branch reopen evidence reset)

- Reopening a terminal deep-research branch now clears its prior coverage,
  delegated source leads, evidence gaps, and deferral. Cumulative budget use is
  retained, but a manually reopened branch must earn a fresh validated report
  before it can settle. The regression was red before the fix and green after;
  planner flags remain dark and no inference, mirror, rollout, or push occurred.

The source surface is now `fcc74b8c…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — parent-only planner branch merge)

- Branch-result signals are now ignored by delegated planner processes, so a
  child-local or reload-shared lifecycle signal cannot merge claims into the
  parent graph. Mutating planner commands remain parent-only. Planner flags are
  dark; no inference, mirror, rollout, or push occurred.

The source surface is now `f64124f7…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — parent-owned planner mutation fence)

- All model-callable planner mutations now fail closed in subagent processes:
  `plan_write`, `plan_update`, `plan_expand`, `plan_settle`, and
  `research_plan_start` cannot write the parent graph. Mutating planner
  commands are fenced as well; `branch_plan` remains the sole delegated child
  publication path. The ordinary-child regression exercises the tool surface
  and `/plan-cancel` against a live parent lease. Planner flags remain dark; no
  model inference, mirror, rollout, or push occurred.

The source surface is now `63b1a952…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — parent-only planner recovery)

- Planner stale-lease recovery is now disabled for every subagent process, not
  only children carrying a research `plan_context`. Ordinary delegated agents
  share the project directory and could otherwise reclaim a parent lease during
  startup. The new no-context child regression covers startup and the late
  capsule signal. Planner flags remain dark; no model inference, mirror,
  rollout, or push occurred.

The source surface is now `b94c2e48…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — delegated planner capsule-signal fence)

- A delegated planner child now marks its process identity on the shared
  lifecycle bus. Older/reloaded plan-runner subscribers therefore skip capsule
  identity rebinding instead of reclaiming the parent branch lease. The
  regression emits a late capsule signal after child startup and proves the
  parent lease remains pending. Planner flags remain dark; no model inference,
  mirror, rollout, or push occurred.

The source surface is now `94060815…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — planner ownership and budget audit)

- Bound delegated branch results to the parent-issued lease and retry epoch;
  unleased, late, and cross-generation reports are ignored safely.
- Preserved global discovery accounting across retries, burned uncertain
  budget for missing/malformed reports, fenced scout allocations to the
  branch remainder, and prevented already-dispatched scout leaves from being
  replaced in later reports.
- Kept `branch_plan` available to depth-one planner children and prevented
  delegated processes from reclaiming a live parent lease during startup;
  private report directories are explicitly tightened before publication.

Targeted planner integration, branch-report, subagent-hardening,
tool-activation, graph-unit tests, and typecheck pass. Planner flags remain
dark; this is repository-only with no model inference, mirror, rollout, or
push. The current source surface is `4d37bc8a…`; the loaded mirror remains
`73bbd494…` and must be rebound before any future smoke.

### Fixed (2026-09-03 — complete planner graph export)

- `/plan-export` now writes a recursive graph to `.pi/TODO.md`, including
  descendants with relative indentation; ambient status remains root-only and
  subtree status remains bounded. The export regression and full offline suite
  pass. Planner flags, mirrors, defaults, and model evidence are unchanged.

### Fixed (2026-09-03 — planner preflight rebind after retry hardening)

- Rebound the planner preflight's stale default source pin after the retry-budget
  surface change. Selftest and the four-fixture no-inference dry path now pass
  while retaining the loaded-mirror and human-approval bindings. No planner
  flag, inference, mirror, rollout, or adoption decision changed.

### Fixed (2026-09-03 — planner retry-budget conservation)

- Explicitly reopened deep-research branches now receive only the authoritative
  unspent portion of their original discovery allocation. Replayed full-budget
  contexts are rejected, exhausted branches fail closed, and merged usage is
  cumulative across attempts instead of being overwritten. This preserves the
  global 3-search/5-read envelope. Planner flags remain dark; no model session,
  mirror, rollout, or adoption decision occurred.

### Fixed (2026-09-03 — planner preflight source rebinding)

- The no-inference planner preflight now pins the current source surface after
  the transactional dispatch hardening. Its default dry run passes against the
  existing loaded mirror while still requiring human approval and reporting
  `inference_started:false`; stale source defaults fail closed. No planner
  flags, model sessions, mirror, or adoption state changed.

### Fixed (2026-09-03 — transactional planner root dispatch preparation)

- Root research lease acquisition now treats every lease and persisted retry
  epoch as one pre-launch transaction. A later acquisition or epoch-read
  exception releases all earlier leases and leaves the in-process dispatch
  ledger unchanged, returning a bounded `lease_unavailable` result instead of
  stranding a branch. Deterministic fault-injection regressions were red before
  the fix and green afterward. Planner flags remain dark; no model session,
  mirror, or rollout occurred.

### Fixed (2026-09-03 — planner recovery storage in the gate jail)

- The authoritative and exploratory Seatbelt profiles now allow only the
  private `~/.pi/agent/artifacts/run-capsules` subtree needed by
  `RUN_CAPSULE=recovery`, including hierarchical planner state. `real_gate.sh`
  pre-creates that fixed root before entering the jail; workdir, harness, and
  other `~/.pi` paths remain denied. A red profile regression was green after
  the fix, with a real jailed write probe retained for hosts that provide
  `sandbox-exec`. Planner flags remain dark; this changes no live default and
  no model session, mirror, or rollout occurred.

### Fixed (2026-09-03 — planner child-runner setup and redispatch closure)

- A planned child can fail before its process starts while creating a private
  prompt, fork snapshot, or branch-context artifact. That exception is now
  converted into the existing bounded child-failure result path, so the parent
  records a terminal branch failure and releases its durable dispatch lease in
  both single and parallel delegation modes. The underlying exception is not
  exposed to the model. The regression was red before the fix and green after
  it. An explicit reopen now increments a durable branch dispatch epoch, which
  clears the old in-process identity without weakening the active lease fence;
  the reopen regression is also red-green covered. Planner flags and defaults
  remain dark, with no model run or mirror mutation.

### Fixed (2026-09-03 — durable deep-research dispatch leases)

- Root research branches now acquire a parent-authoritative lease in the v5
  graph immediately before a child starts. The lease survives a full parent
  process restart, so a recovered session cannot launch the same branch twice.
- Validated branch results and explicit terminal plan updates release the lease;
  stale leases found during recovery become blocked with a bounded evidence gap
  and require an explicit reopen before retrying. Plan-state mutations now also
  use a bounded cross-process lock and durable file/directory sync, including
  atomic plan replacement. Planner flags and defaults remain dark; no model run
  occurred.

### Fixed (2026-09-03 — root research dispatch reload durability)

- The head planner's one-dispatch-per-depth-one-branch guard now survives an
  in-process extension reload through a run-keyed private runtime ledger. Root
  contexts also require their deterministic owner reference, so a forged branch
  cannot consume a child slot or create an unmergeable delegated run.
- Red-green coverage proves a duplicate root dispatch is rejected before launch
  after reload. Planner flags and defaults remain dark; no model run occurred.

### Fixed (2026-09-03 — scout-dispatch reload durability)

- The depth-one research planner's two-scout ceiling now survives an in-process
  extension reload. Count, child identities, and owner references are retained
  in a branch-keyed private runtime ledger and reset only for a new branch.
- Red-green coverage proves a third scout is rejected before launch after a
  reload. Planner flags and defaults remain dark; no model run occurred.

### Fixed (2026-09-03 — depth-two context binding)

- Planned research scouts must now use a depth-two context belonging to the
  dispatching branch's run, with a deterministic owner reference and a distinct
  child node. Foreign or forged contexts fail before a child process starts.
- Red-green coverage exercises the foreign-run rejection. Planner flags and
  defaults remain dark; no model run occurred.

### Fixed (2026-09-03 — parent-only planner lease fence)

- Explicit subagent environment allowlists can no longer reintroduce
  parent-only planner leases, private branch artifacts, telemetry handles, or
  parent run identity. The allowlist remains additive while the exclusion
  fence stays authoritative.
- Red-green coverage exercises the escape hatch directly. Planner flags and
  defaults remain dark; no model run occurred.

### Fixed (2026-09-03 — planner branch merge fail-closed boundary)

- Delegated research results with a child-ID collision or a graph-invariant
  violation now block only the owning branch instead of being silently ignored
  or leaving the graph open. Incoming child claims are not admitted on the
  failure path, and a `branch-failed` receipt records the bounded reason.
- A depth-one research planner now rejects sequential reuse of the same
  depth-two leaf/owner, not just duplicates within one dispatch call. This
  preserves the two-leaf ceiling across the entire branch lifecycle.
- Red-green coverage exercises both merge failures and the cross-call scout
  identity fence. Planner flags and defaults remain dark; no model run occurred.

### Fixed (2026-09-03 — deep-research parent capability activation)

- A successful `research_plan_start` now requests the parent research and
  delegation capability families through the existing activation boundary. The
  normal core-profile skill route can therefore search and delegate after
  creating a graph while preserving explicit tool selections and the
  one-attempt activation latch.
- A red-green integration test covers the complete planning-to-execution route.
  Planner flags and defaults remain dark; no model run occurred.

### Partial (2026-09-03 — Pi consumer compatibility replay)

- The current `7cd1ac5` source tarball was rechecked against Pi `0.80` with
  strict peer installation, typecheck, all 30 extension entry points, and both
  bundled skills loaded successfully. The `0.81` replay could not resolve its
  peer set in the managed environment and was stopped after the network
  escalation endpoint returned an infrastructure `404`; `0.82` and `0.83`
  were not attempted. These ranges remain pending for this source surface and
  must not be inferred from older compatibility receipts.

### Verified (2026-09-03 — Pi 0.84 consumer compatibility)

- `npm run compat:consumer -- 0.84` now completes cleanly: the packed tarball
  installs under strict peer resolution, typechecks, loads all 30 extension
  entry points, and discovers both bundled skills. The earlier stalled install
  was an environment/network interruption, not a compatibility failure.

### Fixed (2026-09-03 — optimizer V2 graph and handoff durability)

- Hardened patch-surface composition so a composed candidate materializes each
  accepted parent chain exactly once, de-duplicates shared ancestors, detects
  ancestry cycles, and verifies the complete result instead of applying a
  descendant diff directly to the baseline.
- Event-store readers now treat an unterminated final JSONL record as a
  reportable EOF tail; status/inspect/replay remain non-mutating and explicit
  recovery records only the tail's byte count and digest. A complete
  unterminated event is delimiter-repaired and retained; only an incomplete or
  invalid suffix is truncated.
- Branch reports now sync their bytes before close and sync the containing
  directory after rename. The optimizer preflight source pin was rebound to
  the new source surface; all changes remain repository-only and dark.
- Tail recovery now owns the run campaign lock for the complete repair/truncate
  plus recovery-event transaction; a second process cannot recover the same
  run concurrently.

### Measured (2026-09-03 — planner completion screen v8 stopped)

- The frozen direct-branch repair smoke ran one Qwen 35B candidate invocation
  and stopped at the 350,000-byte output cap after approximately 173 seconds.
  Safe telemetry recorded two missing branch reports and no validated merge or
  parent settlement; the negative control was not started. The result is
  incomplete mechanism evidence only and is recorded in
  `QWEN35B_PLANNER_COMPLETION_V8_AUDIT_2026-09-03.md`. Planner defaults remain
  dark.

### Fixed (2026-09-03 — context handoff rearm contract)

- Added explicit boundary coverage for both rearm paths: absolute token usage
  rearms strictly below 75% of the model-specific safe-input budget, while the
  percentage fallback rearms strictly below 70% of Pi's native 0–100 usage
  value. The README now states the two representations separately; runtime
  defaults and thresholds are unchanged.

### Fixed (2026-09-03 — planner repair mirror identity rebind)

- Rebound the no-inference planner preflight and V8 repair preregistration to
  loaded surface `73bbd494…` after the direct-completion contract was mirrored.
  The mirror reports 122/122 first-party artifacts with zero drift. No V8
  inference had occurred at the time of this rebind; the later candidate-only
  observation is recorded in the V8 audit. Planner defaults and adoption remain
  unchanged.

### Fixed (2026-09-03 — optional direct planner branch completion)

- **Depth-one research planners may now finish a bounded branch directly.** The
  role guidance previously required every branch to create depth-two scouts,
  multiplying local-model turns even for a single-source gap. It now reserves
  scout expansion for genuinely independent gaps and requires a terminal,
  covered `branch_plan` report for direct completion. The targeted contract
  test is red-green; planner flags and defaults remain dark.

### Measured (2026-09-03 — planner completion screen v7 stopped)

- The first two hash-bound Qwen 35B candidate observations were run against the
  frozen v7 envelope. Session one reached the 350,000-byte cap with a graph
  start and two pending branches; session two reached the 180-second wall with
  two delegated child failures and no merge or parent settlement. The
  preregistered hard guard is therefore impossible to satisfy, so the remaining
  ten sessions were not run. These are incomplete mechanism diagnostics, not
  planner-quality or adoption evidence; raw streams remain private.

### Prepared (2026-09-03 — planner direct-completion repair smoke v8)

- Added `PREREG_QWEN35B_PLANNER_COMPLETION_V8_2026-09-03.md`, binding the new
  model-visible source surface and a one-fixture candidate/control smoke. At
  the time of this entry it was pending mirror/hash rebinding and explicit
  execution; the later candidate-only observation is recorded in the V8 audit.
  No planner default or historical evidence changes.

### Fixed (2026-09-03 — planner screen order binding)

- Recorded the v7 planner screen's seeded randomization string and exact
  candidate/control fixture order so an approved run can be replayed and
  audited for order effects. No runtime, model surface, or default changed.

### Fixed (2026-09-03 — fixture-bound planner launcher)

- The dark planner smoke launcher can now validate an admitted research
  manifest against its canonical digest, derive its primary prompt or embedded
  negative control, and label the safe summary without retaining prompt text.
  Legacy prompt files remain supported, but a supplied file must exactly match
  the admitted prompt. No model execution or default changed.

### Prepared (2026-09-03 — planner completion-shaped fixture screen)

- Added the admitted `compare-json-yaml-config` fixture and relaxed the stale
  planner preflight count check to support the four-fixture slate while still
  requiring the comparative, contested, and multi-part kinds. The new
  completion-shaped fixture is bound in
  `PREREG_QWEN35B_PLANNER_COMPLETION_V7_2026-09-03.md` for a future,
  human-approved screen; no provider, Pi session, default, mirror, or source
  surface changed.

### Measured (2026-09-03 — Jina surface load smoke)

- The mirrored Jina-capable surface loaded in a pinned Qwen 35B smoke with exit
  0, zero stderr, one session, 70 telemetry rows, and exact loaded hash
  `d83baa71…`; no raw URL/content/prompt/credential fields were present. Jina
  stayed off for this load-only receipt, so this is provenance evidence rather
  than a formatter-quality or research-efficacy result.

### Fixed (2026-09-03 — opt-in Jina Reader research formatting)

- Added the dark `JINA_READER=on` path to `web_read`. It statically formats a
  validated public URL through Jina's free no-key Reader endpoint, keeps Ketch's
  existing bounds and preflight, restores the original URL for citations, and
  treats returned text as untrusted evidence. No API key, cookie, or live default
  changed; the regular Ketch reader and search path remain the default.

### Measured (2026-09-03 — planner delegated-role boundary smoke)

- The newly mirrored role-guidance surface loaded in a pinned Qwen 35B smoke
  with exit 0, zero stderr, one session, and 70 authenticated rows bound to
  loaded hash `8976ab90…`; no unsafe telemetry keys were present. This is a
  loading/provenance receipt only. Planner flags remain dark and no graph
  mechanism or quality claim follows.

### Fixed (2026-09-03 — planner preflight identity rebind)

- Rebound the no-inference planner preflight to source `8993f671…` and the
  newly mirrored loaded surface `8976ab90…`; the stale identity failed closed
  before the update and `verify:optimizer` is green afterward.

### Fixed (2026-09-03 — planner delegated-role contract)

- **The deep-research planner handoff now names the enforced `research-planner`
  role.** The tool guidance and returned `plan_context` message previously said
  “researcher,” which led a model to call the ordinary scout role and receive a
  correct-but-blocking contract error. A targeted integration test now keeps the
  model-visible role name aligned with the validator. Planner flags remain dark;
  no quality or adoption claim follows.

### Measured (2026-09-03 — nested delegated-failure smoke)

- The mirrored run-kernel repair passed a short pinned Qwen 35B smoke with
  exit 0, zero stderr, one session, 70 hash-bound telemetry rows, and no raw
  payload keys. This validates loading and telemetry provenance only; it is
  not planner or model-quality evidence.

### Fixed (2026-09-03 — planner preflight identity rebind)

- Rebound the no-inference planner preflight defaults after the run-kernel
  provenance repair changed the canonical source and loaded hashes. The stale
  pin failed closed during verification; the corrected selftest is green.

### Fixed (2026-09-03 — nested delegated-tool failure provenance)

- **Run-kernel receipts now honor nested tool-result errors.** Pi’s JSON
  execution envelope can carry `{isError:true}` inside a result while the
  outer event is not marked as an error; those delegated failures are now
  classified as failed receipts instead of successful work. The targeted
  regression and full offline suite pass. Planner flags and defaults remain
  unchanged.

### Fixed (2026-09-03 — planner preflight identity rebind)

- Rebound the no-inference planner preflight defaults to the current source
  and loaded surface hashes after the budget-guidance repair. The stale-pin
  selftest had failed closed; `verify:optimizer` is green again. This is
  optimizer provenance plumbing only and does not alter planner defaults.

### Measured (2026-09-03 — planner mechanism v6 diagnostic)

- The single hash-bound Qwen 35B diagnostic reached one `research-start` and
  nine source receipts before the 350,000-byte output cap; it produced no
  branch merge or parent settlement. The repaired actionable budget guidance
  appeared four times and the old vague rejection did not. This is incomplete
  operability evidence, not a quality or adoption result; planner flags remain
  dark.

### Fixed (2026-09-03 — planner budget rejection guidance)

- **Over-budget `research_plan_start` calls now explain the shared discovery
  envelope.** The rejection names the three-search/five-read total and the
  requested allocation, so a model can correct its plan instead of retrying
  the same invalid request. This is a model-visible boundary; planner flags
  remain dark and v6 is prepared for one bounded diagnostic only.

### Changed (2026-09-03 — planner screen arm qualification)

- **The dark planner launcher now supports explicit `candidate` and `control`
  arms.** Each arm verifies its preregistered configuration digest, clears
  inherited planner flags, and reports the arm/config identity in its bounded
  summary. This is optimizer-only plumbing; the model-visible surface and all
  live defaults remain unchanged.

### Measured (2026-09-03 — planner mechanism v5)

- The hash-bound Qwen 35B screen ran six candidate sessions and three controls.
  Candidate graph starts were 3/6, with zero validated merges and zero parent
  settlements; all controls had zero graph events. The result is an incomplete
  mechanism observation, not an efficacy result. Planner flags remain dark and
  the raw streams remain private.

### Fixed (2026-09-03 — parent planner route hint boundary)

- **The opted-in headless planner lease now adds a parent-only routing hint at
  `before_agent_start`.** Complex research is directed to
  `research_plan_start` before web tools, while straightforward lookup stays
  lightweight and delegated children remain planner-free. The targeted
  red-green test and full offline suite pass; planner flags and defaults remain
  dark pending the v5 hash-bound mechanism screen.

### Fixed (2026-09-03 — deep-research planner routing boundary)

- **The deep-research skill now advertises its planner-first route in the
  model-visible description.** Complex, contested, comparative, multi-part,
  and delegated requests are directed to read the skill and call
  `research_plan_start` before web tools when available; straightforward fact
  lookup remains lightweight. The red-green routing regression is covered by
  the offline suite. This is a new model-visible boundary; planner flags and
  defaults remain dark pending a fresh hash-bound screen.

### Fixed (2026-09-03 — planner headless activation boundary)

- **The dark deep-research graph now has an explicit parent-only headless
  lease.** `PI_MUNCHKIN_HEADLESS_PLAN=on` activates the graph entrypoint,
  bounded graph mutations, research tools, citation ledger, and delegation at
  startup for an explicitly opted-in parent launcher. Delegated children do
  not inherit the lease; they receive only their typed private plan context.
  Ordinary sessions and planner defaults remain unchanged. The regression was
  red before the fix and green afterward; a fresh v3 preregistration is
  required before any further model session.

### Measured (2026-09-03 — first planner-screen receipt)

- The first bounded Qwen 35B comparative planner-screen session reached the
  router after a sandbox transport failure was excluded. The host-network
  rerun completed with zero stderr and the expected loaded hash, but emitted no
  research-plan activation, branch merge, or graph settlement. It is an
  incomplete mechanism observation only; planner flags remain dark and no
  quality or adoption claim follows.

### Documentation provenance correction (2026-09-02)

- Rebound the current planner and research-ledger preregistrations to branch
  tip `98df5ed`. The model-visible source hash remains `62b1e565…`; this is a
  documentation/provenance correction only and does not authorize inference.

### Added (2026-09-02 — planner research-fixture admission)

- **The dark planner screen now has a structural fixture boundary.** Three
  research-shaped manifests (comparative, contested, and multi-part) declare
  independent evidence families, bounded official-source leads, and
  straightforward fact-lookup negative controls. A fail-closed admission
  selftest binds prompt hashes, provenance, oracle containment, and receipt
  digests without fetching sources or running inference. The manifests are
  prerequisites for the mechanism screen, not quality evidence; planner flags
  remain dark.

- **Planner screen preflight is now executable and no-inference.** A bounded
  preflight binds the current source and loaded-surface hashes, exact Qwen
  subject, candidate/control thresholds, and the admitted fixture slate before
  any launcher command. It emits a readiness classification and explicitly
  requires human approval; it never contacts the model server or starts Pi.

- **Research-ledger Run 4 is prepared under the repaired budget wall.** The
  fresh preregistration binds the current surface, uses five frozen questions,
  holds both arms to the same three-search/five-read allowance, requires a
  complete baseline and independent judge, and keeps the ledger dark. No model
  session has started.

- **Run 4 now has a ledger-free budget control arm.** `RESEARCH_BUDGET=on`
  enforces the shared three-search/five-distinct-read wall while keeping
  `RESEARCH_LEDGER=off`'s note tools, cache, state, footer, and wrap-up steer
  absent. The preregistration now binds this control explicitly, preventing a
  ledger comparison from crediting simple overrun prevention as ledger value.

- **The approved budget-control surface is now mirrored.** `mirror:apply`
  wrote all 122 first-party artifacts and `mirror:check` reports zero drift;
  the loaded hash is `9629b4db…`. No model session, calibration, or adoption
  decision followed the rollout; the pinned smoke remains a separate gate.

### Fixed (2026-09-02 — research-ledger budget wall)

- **The budget-only control is now expressible through optimizer configs.**
  `RESEARCH_BUDGET` is registered in `optimizer/prompt-lab/configs/schema.json`
  and pinned by the config selftest, so a real-gate configuration cannot reject
  the preregistered control before it starts. This is optimizer plumbing only;
  defaults and the live mirror are unchanged.

- **Ledger-enabled non-graph research now enforces its advertised envelope.**
  `RESEARCH_LEDGER=on` sessions stop after three search units or five distinct
  source-read units and return an explicit evidence-gap result. Planned graph
  branches retain their own allocated remainder and parent validation budget;
  the ledger-off legacy path is unchanged. The new budget regression was red
  before the fix and green afterward. Planner and ledger flags remain dark for
  rollout purposes.

### Fixed (2026-09-02 — terminal invalid branch reports)

- **A clean depth-one child exit cannot masquerade as a successful planned
  branch.** When a planned child exits with `missing_report` or
  `invalid_report`, the subagent wrapper now emits the blocked branch signal
  and a bounded terminal stop message instead of returning a retryable-looking
  success. Ordinary and depth-two failures are unchanged. The targeted policy
  regression was red before the fix and green afterward; planner flags remain
  dark and this is lifecycle evidence only.

### Fixed (2026-09-02 — terminal child coverage guidance)

- **Terminal research children now get an actionable coverage error.** A
  `done`, `blocked`, or `deferred` child must carry its own retrieval coverage
  receipt; `branch_plan` now names the missing child and lists the required
  fields before accepting or rejecting the report. The existing bounded retry
  and fail-closed branch behavior remains in force. The regression was red
  before the guidance and green afterward; planner flags remain dark.

### Fixed (2026-09-02 — terminal planned-branch failures)

- **A failed depth-one research branch is now terminal at the parent.** After
  the branch is recorded as blocked, the subagent wrapper returns a bounded
  terminal result instead of an ordinary retryable tool error. This prevents a
  model from repeatedly dispatching the same failed branch; ordinary and
  depth-two subagent failures retain their existing error behavior. The policy
  regression was red before the fix and green afterward. Planner flags remain
  dark and this is lifecycle evidence only.

### Fixed (2026-09-02 — bounded malformed branch reports)

- **Repeated invalid branch coverage reports now fail closed.** The first
  `complete:false` report without a declared failure reason still receives the
  corrective schema guidance. If the same branch repeats the malformed report,
  `branch_plan` writes a terminal `blocked` report with zero accepted evidence,
  usage, or child claims and tells the model to stop. This prevents a planner
  from looping forever on a protocol error while preserving the fail-closed
  evidence boundary. The regression was red before the fix and green after it;
  planner flags remain dark and this is operability evidence only.

### Fixed (2026-09-02 — planner branch contexts are model-visible)

- **Delegated research planners now receive the exact scout contexts they must
  forward.** `branch_plan` previously persisted depth-two `plan_context` values
  only in its private details payload, while the model-visible result told the
  planner to copy them without showing them. A compliant planner therefore
  could not dispatch a valid scout and the branch was rejected as
  `child_failed`. The returned contexts are now included in bounded,
  model-visible result text and covered by a red-green integration test. This
  repair creates a new planner surface boundary. It is now mirrored, but the
  first exact-hash Qwen smoke still hit its bounded wall before a branch report
  and remains incomplete; no planner quality, adoption, or efficacy evidence is
  implied.

- The repository-only planner smoke launcher now accepts an explicit, validated
  `--thinking` level, allowing bounded mechanism probes to be reproduced across
  registered models without changing their production role defaults.

- A fresh one-branch exact-hash Qwen probe with `--thinking minimal` reached the
  repaired nested dispatch path: the planner copied the depth-two context into
  `research-scout`. The nested child did not settle before the 180-second bound,
  so the branch became `child_failed`; this remains operability evidence only,
  with both planner flags dark.

### Fixed (2026-09-02 — explain invalid incomplete branch coverage)

- **Branch-report validation now explains its coverage truth table.** A bounded
  report marked `complete:false` must also identify truncation, budget exhaustion,
  or failure; clean bounded coverage must be `complete:true`. The branch tool
  still rejects invalid state, but now returns this correction to the model so a
  planner can repair the report instead of retrying an opaque generic error.
  The targeted integration test was red before the fix and green afterward; the
  planner flags remain dark and no quality or adoption evidence follows.

### Fixed (2026-09-02 — committed handoff outcome survives callback races)

- **A committed model-handoff compaction can no longer be downgraded by a
  later callback error.** Pi emits `session_compact` after the compaction entry
  is durable, but another lifecycle observer may then report `Nothing to
  compact`; the runtime now treats the committed event as authoritative,
  resumes once, and suppresses a duplicate handoff in that epoch. The
  regression is red-green proven. This source-only repair is pending mirror
  and supplies no capacity, quality, or adoption evidence.

### Fixed (2026-09-02 — pre-request handoff abort ordering)

- **Automatic handoff now cancels the active request before compaction begins.**
  Pi's `compact()` API is fire-and-forget and internally waits for an abort;
  calling it at the final pre-request boundary could therefore lose the race
  and allow the oversized payload to proceed. The runtime now invokes the
  synchronous abort hook before starting that compaction path. A targeted test
  was red without this ordering and green after it. This source-only repair is
  pending mirror and supplies no capacity, quality, or adoption evidence.

### Fixed (2026-09-02 — settled-turn handoff eligibility)

- **A prior provider turn now survives the timing projection reset.** The
  runtime clears per-turn timing records after `agent_settled`, but that made
  the next user turn look like an initial prompt and silently skipped the
  handoff check. A sticky successful-turn marker now remains until session
  reset. The lifecycle regression is red-green proven; this supplies no
  capacity, quality, or adoption evidence.

### Fixed (2026-09-02 — initial context handoff guard)

- **Automatic handoff now skips an oversized initial prompt.** A first request has
  no prior provider turn for Pi to compact; attempting the handoff path there
  aborts the only request and reports a misleading failure. The runtime now
  records the timing boundary first and arms the single-flight handoff only
  after a provider turn exists. The regression is red-green proven. This is a
  lifecycle repair only; it supplies no capacity, quality, or adoption evidence.

### Fixed (2026-09-02 — context handoff guards the pre-request boundary)

- **Automatic context handoff now checks immediately before provider requests.**
  A queued follow-up could be above the model-specific safe budget at request
  assembly but below it by `turn_end`, so the existing late check never fired.
  The runtime now invokes the existing single-flight compaction path at
  `before_provider_request`; Pi aborts the stale operation before compaction and
  queues the follow-up only after completion. The regression is red-green
  proven. This source-only repair is pending a separately approved mirror and
  supplies no capacity, quality, or adoption evidence.

### Fixed (2026-09-02 — gate timeout preserves Pi settlement)

- **The external gate timeout no longer duplicates `SIGTERM` in the Seatbelt path.**
  GNU `timeout --foreground` keeps the sandbox wrapper and Pi in one foreground
  process group while the gate retains its explicit descendant sweep. The exact
  pinned Qwen 35B fixture now emits one `session_shutdown` followed by one
  `agent_settled` before the expected timeout status. This is an infrastructure
  lifecycle fix only; it changes no Pi package defaults and supplies no quality
  or adoption evidence.

### Fixed (2026-09-02 — goal tool schemas remain compatible with llama.cpp)

- **Model-visible goal strings now cap at 1,999.** llama.cpp's JSON-schema to
  GBNF path rejects nested `maxLength` values at 2,000 or above, so objective,
  criterion, delivered-value, and deferral-rationale schemas use a shared
  1,999 cap while runtime goal validation retains its independent 2,000-byte
  bound. A red-green schema test and a source-wired Qwen 35B smoke confirm
  grammar initialization and goal completion. The source was subsequently
  mirrored at loaded hash `7624ee44…` and passed one live mechanism smoke;
  defaults remain unchanged and no quality or adoption claim is made.

### Fixed (2026-09-01 — graceful shutdown gives active gate runs a settlement window)

- **Active agents now abort before runtime disposal.** Pi's print-mode `SIGTERM` path emits
  `session_shutdown` while a model may still be streaming. The harness requests an abort,
  waits for the actual `agent_settled` callback (bounded below the gate's hard-kill grace),
  and only then flushes telemetry. This preserves the authoritative settlement boundary
  for long gate sessions without changing the hard timeout, model defaults, or rollout flags.

### Fixed (2026-09-01 — the goal recovery brief keeps its budget on the compaction path)

- **`renderGoalRecoveryBrief` defaults to the context-scaled budget instead of 1 KiB.** The
  `pi.goal-context/v2` brief grew from (objective ≤240 B + criterion IDs + counts) to the full
  contract, but only `plan-runner` passed the larger budget; `compact-tool.ts` and `run-capsule.ts`
  kept the `1_024` default. With ~270 B of fixed v2 header and a ~100 B truncation suffix, the brief
  that survives a **compaction** — the case goal mode exists for — truncated before the first
  criterion and always dropped `residual_risks` and `deferrals`, a regression against the v1 brief
  which always fit. `goalContextBudget()` moves into `lib/goal-state.ts` and becomes the default, so
  all three injection sites share one budget by construction rather than by remembering to pass it.
- **A truncated brief no longer claims both complete and incomplete details.** `details_complete:
  true` sat inside the truncatable body ~116 bytes from its end while the suffix reserves ~100, so a
  ~21-byte band of budgets kept the `true` line and then appended the `false` one. It is now
  appended per branch and never carried in the body.

### Fixed (2026-09-01 — optimizer durability and scoring isolation)

- **Event recovery is explicit.** `status`, `inspect`, and `replay` report a malformed
  end-of-file suffix without changing the event log; only `resume` under the campaign lock may
  truncate that final suffix and append an `event-store.tail-recovered` digest record. Midstream
  corruption remains fatal, and projection failures mark rebuildable projections dirty instead
  of losing the durable event.
- **Model-authored scoring never falls back to the host.** One-shot scoring now probes the
  rendered Seatbelt profile before running a grader and fails closed when the jail is unavailable
  or denied with `EPERM`. Offline selftests report the hardened scoring and network checks as
  unavailable in nested managed sandboxes rather than executing unjailed code.

### Fixed (2026-09-01 — Optimizer V2 learning loop)

- **Optimizer feedback is now durable and causal.** Provider exchanges use
  `pi.optimizer-session/v2`; evolution receives bounded immutable candidate cards, the current
  head, the previous reflection, and only quarantined development-validated lessons. Raw
  development observations and traces never enter provider payloads.
- **Candidate ancestry is preserved.** Evolution has only `mutate` and `compose`; selecting an
  earlier accepted ancestor is the supported revert path. Surface adapters materialize the full
  parent chain, compositions are owned by the selected surface adapter and require a shared
  baseline plus transitive changed-unit agreement, and every composition is a fresh verified
  candidate, including deep branches.
- **Campaigns fail before sessions when policy declarations are malformed.** Paired-policy names,
  required fields, numeric types, finite bounds, alpha, permutation counts, and exact-policy
  limits are validated during manifest loading. The campaign remains dark and human-review-only.

### Fixed (2026-09-01 — serving-aware context epoch completion)

- **Context identity now includes the serving boundary.** Discovery and calibration are
  keyed by provider, model, declared window, and a normalized endpoint fingerprint; changing
  an endpoint or declared window opens a fresh epoch without exposing the raw endpoint.
- **Budget shrinkage is acted on immediately.** A served-window observation that lowers the
  safe input budget reevaluates the completed turn and requests the existing single-flight
  handoff before another provider request can begin, with a pending marker for lifecycle gaps
  and the existing 70% rearm threshold.
- **Handoffs preserve the right work.** Model switches retain the active task and executable
  goal digest, use goal-specific wording only when a goal is active, and report reachability
  calibration as `observed` rather than measured capacity. Epoch, budget, handoff, and rearm
  telemetry remains numeric/enum-only.

### Fixed (2026-09-01 — goal authority and recovery contract)

- **Inactive goals no longer restart themselves.** Private goal state is now
  `pi.goal-ledger/v2`: `current_goal_id` preserves paused, blocked, proposed, and
  80/20-settled state for `/goal-status`, while only `status=active` grants model
  execution authority. V1 ledgers migrate without reactivating inactive goals.
- **Resume is user-owned and recovery is complete.** The model-callable
  `goal_resume` tool is removed; `/goal-resume` remains the sole resumption path.
  Active goals receive a context-profile-sized `pi.goal-context/v2` brief and a
  read-only paged `goal_inspect` surface for complete criteria, constraints,
  evidence, risks, and deferrals. Inactive goals inject no continuation brief.
- **Goal lifecycle tools close with the lifecycle.** `goal_block` records a
  bounded reason, evidence, and unblock condition. A typed status signal removes
  goal execution tools on pause, block, settlement, or cancellation while
  preserving manual tool choices and the proposal-only route. Private atomic
  artifacts now sync file contents and containing directories before success.

### Fixed (2026-09-01 — persistent goal mode now executes)

- **`/goal` was a ledger write, not a working mode.** Starting a goal persisted private state and
  displayed a notification, but it never started an agent turn; later turns could not see the
  restored goal because its ambient global had no model-context consumer. `/goal`, `/goal-accept`,
  and `/goal-resume` now start one command-owned turn, active goal state is injected as a bounded
  private context message on subsequent turns, and the deferred `goals` tool family remains active
  across session rebinds while the goal is active. The later authority repair above supersedes this
  row's incomplete pause/settlement claim. `GOALS=off` is unchanged.

### Added (2026-08-27 — dark Optimizer V2 control plane)

- **A durable, benchmark-led optimizer under `optimizer/v2/`.** Strict
  `pi.optimizer-campaign/v2` manifests bind one primary metric, hard guards, provider/model
  cohorts, benchmark revision, typed surface families, budgets, and exact source/config/surface
  fingerprints. `prepare` resolves and prints the campaign SHA-256 without execution; `run` and
  `resume` require that exact digest. Run state is an fsynced, hash-chained `events.jsonl` with
  stable operation IDs, one nonblocking writer lease, idempotent replay, and rebuildable private
  projections. Immutable content-addressed candidates carry one causal mutation family; compatible
  accepted candidates may compose only as a fresh candidate.
- **Plugin boundaries and benchmark lifecycle.** Scenario adapters own immutable disjoint
  train/development/opaque-test packs, calibration, paired seeded blocks, evidence, and metric
  semantics. Surface adapters own isolated materialization, path/family allowlists, diff checks,
  verification commands, and composition. Provider-neutral, schema-validated `evolve`,
  `diagnose_patch`, and `reflect` sessions support deterministic fake, reviewed artifact-JSON, and
  explicitly configured OpenAI-compatible providers. Development traces never enter provider
  payloads; selection requires paired improvement, mechanism exposure, every hard guard, sequential
  guard-model success, and development validation, then emits a human review packet only.
- **Trusted-gate migration bridge.** `PiGateScenario` leaves `real_gate.sh`, graders, provenance,
  telemetry authentication, exposure, Seatbelt, and secrets unchanged. Its ingestion path accepts
  only fresh `pi.eval-row/v4` records with exact trial-validity bindings, one stable serving/session
  identity, and matching campaign/config/surface hashes. Live Pi-gate campaign execution remains
  deliberately unregistered until immutable candidate workspaces can be connected without touching
  the live harness. Legacy optimizer scripts and evidence are frozen in place and cannot seed V2.
  Offline verification covers strict parsing, approval mismatch, path containment, candidate
  addressing/composition, budget refusal, crash-after-transition resume, split quarantine, paired
  coverage/arm order, malformed provider output, missing exposure, guard regressions, fake lifecycle,
  replay, and the existing gate dry run. No model inference, rollout, mirror, default change, or
  adoption is performed by repository verification.

### Added (2026-08-27 — persistent goal mode and model-aware context epochs)

- **Persistent goals** (`lib/goal-state.ts`, surfaced through `plan-runner`). A goal can be proposed
  (advisory, inert until the user runs `/goal-accept`), activated, paused, resumed, updated, and
  settled either `complete` (every criterion met) or `accepted_80_20` — an honest good-enough stop
  that requires every unmet optional criterion to be *explicitly marked deferred* (a correspondence
  check, not a count) plus recorded deferral rationale and residual risks. State lives in a private
  per-scope ledger (`artifacts/goals/<sha256>/goal-v1.json`, 0700/0600), survives compaction and
  model changes via bounded recovery briefs injected by `compact-tool` and `run-capsule`, and is
  parent-owned: child processes (any `PI_SUBAGENT_DEPTH` other than `"0"`, malformed values
  included, fail closed) are refused mutation through the four `goal_*` tools AND the mutating
  `/goal*` commands. Model-visible surface is deferred: the tools are absent from the core ambient
  profile and activate as one `goals` capability family; `GOALS=off` is the rollback switch that
  removes the entire surface. `skills/deep-research/SKILL.md` gains guidance to propose (never
  self-activate) a goal for investigations expected to outlive one session.
- **Model-aware context epochs** (`lib/context-profile.ts`, wired in `runtime-truth`). Each model
  fingerprint (provider/id/context window) opens an epoch carrying the declared window, the served
  window from the existing local `/props` probe, and a derived safe input budget (window − output
  reserve − overhead). **`CONTEXT_HANDOFF` is live by default**: on a model switch to a smaller
  window, or when a turn ends past the safe budget or Pi's 85% mark, the harness requests one
  bounded native compaction and then auto-triggers a follow-up turn to resume — one-shot per epoch
  until usage genuinely recovers (below 75% of budget / 70%), `off` disables. `CONTEXT_DISCOVERY=on`
  (default off) adds one synthetic single-token handshake per serving fingerprint, refused for any
  non-loopback/private host; it never sends transcript, tools, or system-prompt content. Telemetry:
  `runtime/context-profile`, `runtime/context-handoff` (with outcome `ok`), and
  `runtime/context-calibration` — numeric/enum fields only. Note: `run-capsule`'s existing
  `recovery-brief` `brief_bytes` metric now includes the appended goal-brief bytes.

### Fixed (2026-08-27 — six audit findings in the goal/context work, pre-rollout)

- **Auto-handoff could latch off for a whole session**: `requestHandoff`'s `finish()` returned
  before clearing `handoffInFlight` when the compaction lease had gone stale, permanently disabling
  automatic handoff. The latch now clears before the lease check.
- **Failed handoffs looked successful**: `runtime/context-handoff` was recorded before the
  compaction was attempted. The row is now emitted once, when the outcome is known, with `ok`.
- **Dead catalog declarations**: `runtime/context-profile` declared `provider`/`model` detail
  fields that `normalizeDetail`'s reserved-field strip removes from every row before catalog
  validation. Dropped, and a new tripwire test asserts no catalog entry declares any
  `RESERVED_FIELDS` key (the set is now exported).
- **Child fence gap**: the parent-owned goal fence covered the tools but not the five mutating
  `/goal*` slash commands; they now refuse under the same rule.
- **80/20 deferral was a count, not a correspondence** (see the Added entry — one deferred item no
  longer unlocks arbitrarily many still-open optional criteria).
- **No rollback switch for goals**: every comparable capability has one; `GOALS=off` added, and
  `GOALS` classified in the subagent env allowlist so children inherit suppression.

### Fixed (2026-08-26 — non-interactive resume restores capsule/blackboard/working-memory/run-kernel state)

- **`pi -p --session-id <existing>` now actually resumes harness-private state.** Live testing found
  `/plan` in one process followed by `/plan-go --session-id <same id>` in a separate process saw no
  active plan — a fresh, empty run capsule had been minted instead of resuming the one `/plan` had
  just written. Traced to Pi's actual bundled CLI: `pi -p --session-id <existing>` always fires
  `session_start` with `reason: "startup"`, never `"resume"` — `"resume"`/`"fork"` are constructed
  only by in-process session-management calls (`ctx.newSession`/`switchSession`/`fork`), never by the
  CLI's initial boot. Four extensions gated restoration on `reason === "resume" || "fork"` and so
  silently reset on every such invocation, even though the conversation transcript correctly resumed:
  `run-capsule` (plan/run state), `session-blackboard` (failure ledger), `run-kernel` (shadow
  legacy-parity state), `working-memory`. `lib/session-resume.ts`'s new `isEffectiveResume(event, ctx)`
  still trusts `reason` when Pi does say "resume"/"fork", and otherwise falls back to checking whether
  the session's own branch is non-empty — ground truth Pi already loaded before `session_start` fires,
  independent of what `reason` claims.

### Added (2026-08-26 — gate provenance binding and a model-neutral tool-contract screen)

- **Gate telemetry rows carry real identity.** `optimizer/real_gate.sh` now mints a per-session
  `pi.gate-session/v1` provenance record (`optimizer/prompt-lab/gate_provenance.py`) and stamps
  `PI_RUN_ID`/`PI_MODEL_ID`/`PI_MODEL_PROVIDER`/`PI_REQUESTED_MODEL`/`PI_REQUESTED_PROVIDER`/
  `HARNESS_CONFIG_SHA256` into the child env, closing the previously-open defect where `model`,
  `provider`, and `config_sha256` were null on every gate telemetry row. `requested_model`/
  `requested_provider` join the reserved telemetry envelope (`lib/telemetry.ts`,
  `lib/telemetry-catalog.ts`); observed-vs-expected identity is validated when reducing rows, and a
  mismatch marks the row non-authoritative.
- **Gate-child telemetry can no longer leak into the interactive corpus.** `runner-env.js` now forces
  `TELEMETRY=off`/`TELEMETRY_CHILD_POLICY=contained` for any subagent spawned under
  `TELEMETRY_SOURCE=gate`, closing the previously-open leak into `~/.pi/agent/telemetry/events.jsonl`.
- **A model-neutral tool-contract qualification screen.** `optimizer/prompt-lab/tool_contract.py` +
  `tool-contract-v1.json` define 10 cases (read, span-search, span-read, shell-recovery,
  anchored-edit, write-persist, verify-after-mutation, capability-activation, planner-write,
  planner-update) checking whether a model calls the required tool. It emits `pi.tool-contract/v1`
  rows that `row_contract.py`/`fleet_report.py` explicitly exclude from fleet efficacy/adoption — it
  cannot promote a model. `--selftest`/`--dry` never invoke a model; `--run --confirm --model ...`
  is the explicit human-gated execution boundary. See
  `optimizer/docs/NEXT_STEP_MODEL_QUALIFICATION_2026-08.md` and the 2026-08-26 HANDOVER section for
  the full sequencing; no inference, mirror, or default flip is implied by landing this.
- **Tested**: new tests in `harness/tests/subagent-hardening.test.ts` and `harness/tests/telemetry.test.ts`,
  plus Python `selftest()` in `gate_provenance.py`/`tool_contract.py`/`context_telemetry.py`.

### Fixed (2026-08-26 — run-kernel's shadow mutation counter agrees with verify-gate's conservative bash rule)

- **A failed bash mutation no longer trips a spurious `legacy-disagreement`.** verify-gate's F-02 fix
  conservatively counts a failed `bash` source-mutation as `mutated: true` (a shell command may have
  written before returning non-zero); `run-kernel`'s independent shadow-mode counter was
  success-only, so `compareLegacy()` disagreed on `verify_mutated` for a case that wasn't a real bug
  in either system. A new `mutation.conservativeArmed` flag, scoped only to that comparison, closes
  the gap without touching `mutation.count`/`lastCompletedSequence` or anything downstream of them
  (`settle()`'s `hasMutation`, the `mutations` telemetry field, recovery/blackboard/capsule
  rendering). `run-kernel` remains shadow-mode/observational only — no user-visible behavior change.

### Fixed (2026-08-26 — live headless lifecycle and mutation accounting)

- **Headless `/plan` and `/plan-go` no longer replace their own session.** A command handler used
  `sendUserMessage()` to recursively enter `AgentSession.prompt()`. As the first `pi -p` message,
  this invalidated the command's context, produced a stale-context error cascade, could leave no
  plan at all, and still exited zero. Both commands now start one command-owned custom turn with
  `sendMessage({ triggerTurn: true })` and keep print mode alive through `waitForIdle()`.
- **`/loop-resume` uses the same safe command-owned lifecycle.** The fresh review found the same
  recursive-send pattern outside the reported planner path and removed it before rollout.
- **Failed atomic edits no longer count as mutations.** `edit`, `write`, and `multiedit` arm the
  verification state only when they succeed; failed shell mutations remain conservative because a
  non-zero command may have written partially. A shared mutation epoch preserves correct rollback
  when atomic mutation calls settle concurrently, including all-failed and mixed-result batches.
- **The state-lens correction is finally live.** `state-lens/steer-injected` now records the
  arbiter's actual `delivered` decision under the shipped enforce path, closing the correction noted
  in the preceding changelog and surface-boundary entries.

### Fixed (2026-08-26 — the simple half of batches 1, 2, 4 and 5)

- **The state lens under-counted to zero.** `state-lens/steer-injected` was recorded only inside the
  `legacyActed` branch, so under the shipped `CONTROL_ARBITER=enforce` — where the lens IS delivered,
  merged as a prefix into the winner's message — not one row was ever written.
  **Correction (2026-08-26): this did not ship in `db3711c` despite that commit's message.** The code
  change was lost between edit and commit; only the catalog half landed, leaving a declared
  `delivered` field no emitter sent. It is fixed for real in the follow-up, *with* the regression test
  whose absence let it vanish silently in the first place. The lens can never
  *win* (priority 100, triggered by a 600), so `decision.delivered` is the only thing that can
  distinguish "merged and shown" from "dropped".
- **Two lifecycle orphans.** `drift-scanner` had no `session_start` handler at all, so `handledHead`
  never cleared and an in-flight review kept running against the previous session.
  `session-blackboard`'s render timer closes over the previous generation's cwd and artifact path,
  and Node keeps it alive across a reload — it fired once afterwards and wrote the old session's
  cockpit over the new one's.
- **Dead surface deleted.** `PHASE_CAPABILITY_TOOLS` and `phaseDeferredTools` had zero consumers
  anywhere. `PLAN_GATE_DIAGNOSTICS` and `PLAN_MODE` join the retired-surface guard: both are
  advertised as live rollbacks by dated boundary rows and read by nothing. Those rows are history and
  are not rewritten; the guard goes in the test instead.
- **`lib/plan-limits.ts`.** The note bound was nine literals across four files, which is why the
  2026-08-25 raise from 300 had to move all nine by hand. Its conformance guard polices owned *values*
  being re-typed as literals rather than comparing a schema to the constant it imports — the first
  version of that test was circular and passed with the constant changed to 901.

### Changed + Fixed (2026-08-26 — integration batches 0-2: killing classes, not instances)

The four-scale review left fifteen deferred findings. They are not fifteen bugs; they are five
classes, each of which has already produced more than one instance. These batches kill the first
three, each leaving a conformance test behind so the class cannot return silently.

**Batch 0 — make the shipped configuration the tested one.** Three places where the suite
exercised a configuration nobody runs:
- Producer tests install no arbiter, so `controlEnforces` is false and all 21 loop-breaker delivery
  assertions took the LEGACY direct-send path. The shipped default is `CONTROL_ARBITER=enforce`, so
  at the producer level **the shipped configuration was the least-tested one in the repo**. New
  `emitRivalProposal()` lets any producer test lose a boundary to a real arbiter, and
  `control-arbiter.test.ts` gains the invariant its 18 tests never had: *a producer that loses keeps
  its budget*. Every prior test asserted the arbiter's OUTPUT; none inspected a producer afterwards.
- `plan-runner.integration.test.ts` pinned `PLAN_STORAGE=project` at module scope, so all fifteen
  tests ran in the ROLLBACK configuration. Removed. Five then failed — each because the *test*
  hardcoded `.pi/plan-state.json`, a path that only exists in the rollback. They now resolve through
  `privatePlanStatePath`, the function production uses. One explicit project-mode case remains.

**Batch 1 — state that knows what a reload does to it.** Pi's reload semantics, verified in dist:
`reload()` clears the extension cache, so the module is re-imported AND the factory re-invoked —
module scope and closure die together, and `globalThis` is the only survivor. The event bus, though,
is built ONCE and reused, and its `clear()` has no callers.
- **All fifteen bus-subscribe sites discarded the unsubscribe the bus returns**, and nothing else
  could dispose them: an extension gets no unload hook, and the closure holding the disposer is gone
  by the time the next generation runs. Measured through the boot harness, one reload takes the
  domain-signal channel from **7 to 14 listeners** against Node's default `maxListeners` of 10.
  Stale subscribers are silent rather than harmless — the old runtime is invalidated
  (`agent-session.js:551`), so their every `pi.*` call throws and `event-bus.js` swallows it.
  New `lib/extension-lifecycle.ts` parks disposers where a reload cannot reach them.
- `verify-gate.frontierSettled` and `working-memory.settled` guard an `agent_settled` hook but reset
  only at `session_start`, so **only the first agent run of a session ever emitted its settled
  rows**. Both now re-arm at `agent_start`, the shape `run-kernel.ts:381` already used.
- verify-gate's "I hid `verify_project`" flag lived in the closure, so after a reload it was false
  and the restore branch could never fire: a session that started gate-less and later gained one kept
  the tool hidden for the whole process, while verify-gate's own steer went on demanding it.

**Batch 2 — charge a budget when the model HEARD the message.** Fifteen of sixteen charge sites
mutate their latch before proposing and record an `injected_chars` row for it; the arbiter then drops
all but one per boundary. That corrupts the instrument, not just a log.
- `ControlDecisionV1` now carries **`delivered`** — the winner plus whichever losers were merged into
  its text, empty outside enforce. `winner` alone is wrong in both directions: the merge rescues
  deliver a loser's text attached to the winner's, so verify-gate's nag would be refunded on exactly
  the boundaries where it was heard; and the state lens (priority 100, triggered by a 600) can never
  win at all.
- The reference implementation was **corrected before being copied**: identity by `proposalIdHash`
  rather than `source`, a `boundarySequence` check (a boundary can produce no decision, and a stale
  record was being settled by whatever decision arrived next), and an `agent_start` reset.
- `lib/control-charge.ts` holds the mechanics once. verify-gate's plateau is migrated: its
  2026-08-21 fix reported `controlEnforces()` as `delivered`, which answers "is the arbiter
  enforcing", not "did I win" — so every plateau correction that LOST its boundary was still counted
  as an intervention and still fed the ROI meter.

### Fixed (2026-08-26 — four-scale deep review: solar / planetary / atomic / quark)

Six blockers and ten defects, each counterfactually proven (fix stashed → new test red → restored).
The unifying pattern is that every one was **an unverified assumption about a neighbour**, which is
why the first deliverable is a test, not a fix.

- **`harness/tests/manifest-boot.test.ts` (new)**: boots all 30 declared extensions in manifest
  order onto one fake pi and asserts the end state — every stripped tool is recorded as deferred,
  every deferred tool has an activation route, no duplicate registrations, and the same holds after
  a `/reload`. `loadExtensions()` had been exported for exactly this and had **zero callers**; the
  only order assertion anywhere was "index 0 is session-bootstrap". This one file fails against
  four of the defects below simultaneously. Companion:
  `harness/tests/plan-surface-handoff.test.ts` exercises the planner in the SHIPPED storage mode —
  the existing planner suite sets `PLAN_STORAGE=project` at module scope, so all of it ran in the
  rollback configuration.
- **Agent-dir prompt surface was outside the surface hash.** Pi reads four prompt inputs from the
  agent dir; only `APPEND_SYSTEM.md` was hashed. `SYSTEM.md` (which *replaces* the base system
  prompt) and `AGENTS.md`/`CLAUDE.md` (folded into every session's context) were not — and a live
  `~/.pi/agent/AGENTS.md` existed throughout. Editing it changed what every model saw while the
  source hash, loaded hash, surface receipt and `mirror:check` all stayed identical. Same hole
  closed for skills on 2026-08-11 and left open for the files beside them.
- **The audit-A1 capability recovery never ran.** `resource-loader.reload()` calls
  `clearExtensionCache()`, so `/reload` re-imports the module AND re-invokes the factory against a
  fresh api — module scope and the `default()` closure are both wiped. The `previouslyDeferred`
  record lived in the closure, i.e. the one place that cannot survive the event it was written for,
  so after any reload every `capability(enable, …)` returned `unavailable-or-active` for the rest
  of the process. Moved to a `globalThis` key, the pattern `lib/process-writer.ts` already uses.
- **`fileTag` was quadratic** — `/[ \t\r]+(?=\n|$)/g` backtracks on every step. Measured 4.8s at
  60k trailing spaces, 19.5s at 120k (exactly 4×), 53.4s at 200k; `read` accepts 16 MiB. It is
  synchronous and runs once per `read`, twice per `edit`, so it stalled the whole event loop —
  provider stream and abort handler included. Now a linear scan: 53,426ms → 2ms on the same input.
- **A red gate could read green.** `looksFailingOutput`'s zero-suppressor ran first and returned
  outright, so any "fail…0" vetoed every failure signal after it — clearing cargo's always-printed
  `1 passed; 1 failed; 0 ignored` and jest's `1 failed, 0 skipped, 5 passed`. That is precisely the
  exit-code-swallowed wrapper case the heuristic exists for. Now count-driven, and the verdict is
  read from the tail as well as the head (a suite printing >4 KB of passing lines before its
  summary was judged on its preamble).
- **`activePlan` was dead at the shipped default**, and with it the interrupted-plan notice. Under
  `PLAN_STORAGE=capsule` the plan lives in a run capsule whose identity `run-capsule` publishes at
  manifest index 26 — twenty slots after plan-runner reads it, four after tool-activation derives
  its core/deferred split. So plan state was unreadable at `session_start`, the plan tools were
  deferred even mid-plan, and the only affordance telling a user their plan is resumable sat behind
  a callback the live caller passed as `() => undefined`. New `plan/rebound` signal carries the
  corrected answer to both consumers once it exists; the A2/A6 patches stay as belt-and-braces.
- **`plan_go`, `plan_expand` and `plan_settle` were registered, stripped and uncallable.**
  plan-runner hid six plan tools; tool-activation's recovery pool re-seeded two. The roster is now
  a single `PLAN_SURFACE_TOOLS` in `lib/capability-surface.ts` (it was a literal at seven sites in
  three different subsets), and the `planning` family is registration-driven rather than
  re-deriving plan-runner's flag guards a second time.
- **Seven model-facing rejections prescribed something only a human can do** — `/plan`,
  `/plan-go`, `/ketch-status`, `FORCE_PLAN_WRITE=off`, `RESEARCH_LEDGER=on`, and `GIT_GUARD=off`
  advertised to the caller being restrained. Each left the model with no legal next move, and all
  sit on paths that feed the loop-breaker ladder. `steer-texts.test.ts` now pins the class.
- **`skills/deep-research`** guarded on the `planning` family but then called `research_plan_start`,
  which needs a dark flag. Yesterday's A2 fix made the guard start passing — the first observed case
  of a fix in one file *activating* a dormant defect in another.
- **`plan_update` rejected a carriage return with a byte-length message** — a 12-byte note told to
  get shorter, which cannot succeed, on an `OUTCOME_TOOLS` path that escalates toward an abort.
- **`truncateBytes` and hashline's `read` cap could emit a lone surrogate**, and hashline's 50 KiB
  budget was enforced with `.length` (UTF-16 code units), returning ~3× the intended bytes on CJK.
- **Two canonical digests sorted by locale.** `localeCompare` depends on ambient locale and ICU
  build; failure-episodes sorted *before* truncating to 32 keys, so the locale decided which keys
  survived into the hash.
- **Three dead measurement channels.** `unavailable_attempts` was the literal `0`;
  `tool-activation/unavailable` was catalogued and never emitted, and `exposure.py` validates trial
  targets against that catalog — so a candidate naming it passed validation and then reported
  `unexposed` for every row, indistinguishable from "the mechanism did nothing". Both are now real,
  and a catalog→emission direction test (with a declared, anti-rot allowlist) pins the gap.
- **The steer-text search space could not express its own control arm**: `override || default`
  means `PI_MSG_X=""` silently runs the full default while the manifest records the arm as empty.
  `config_env` now refuses it rather than measuring the opposite of what a candidate declares.

### Removed (2026-08-26)

- `npm run verify:serial` — five stages where `npm run verify` runs six, the missing one being
  `secret-scan`, on a public repo. Nothing referenced it; `npm run verify -- --serial` is the real
  serial path and does include it.

### Added (2026-08-25 — semantic-loop screen prep; optimizer-side only, surface unchanged)

- `optimizer/docs/PREREG_SEMANTIC_LOOP_SCREEN_2026-08.md`: pre-registration for the
  `LOOP_EPISODE_MODE=enforce` calibration + mechanism screen (subject `qwopus35-4b`; five-fixture
  loop-cohort slate; five declared measurement hazards; every stage human-gated). Supersedes the
  never-approved `PREREG_FAILURE_EPISODE_BASELINE_2026-08.md` (header note added there).
- `optimizer/prompt-lab/make_episode_manifest.py`: builds the private
  `pi.failure-episode-study/v1` manifest — computes the six identity hashes (registry bytes
  hashed, never printed), refuses in-repo writes, 0600 output, round-trips through
  `failure_episode_trial.load_manifest`; `--selftest`.

### Changed + Fixed (2026-08-25 — note limit 900 + shotgun regression sweep)

- **Plan note limit 300 → 900 bytes, coherently**: `MAX_NOTE_BYTES`, all five tool-schema
  `maxLength` sites, `plan-delta`'s literal, `plan-graph`'s validator, and `branch-report`'s
  merged-child bound move together (any partial raise splits the churn across tools); the
  authoritative-state cap rises 12 KiB → 32 KiB so a full 24-item plan at 900-byte notes fits
  instead of relocating the rejection; `plan_update`'s delta cap rises 16 → 24 to match
  MAX_ITEMS. Fixed en route: `migrateState` truncated with a character slice against a byte
  budget — a multibyte note could survive the slice, fail validation, and silently vanish the
  whole plan.
- **Regression sweep of the shotgun surface (audit findings A1–A6, B1, B3–B4), all
  counterfactually pinned:**
  - A1: capability families died permanently after any in-process session re-entry (deferred
    pool was rebuilt from the already-narrowed live set); the pool now folds in the previous
    generation's deferrals, which also preserves manual /tools disables.
  - A2: the `planning` family was unreachable at shipped defaults — plan-runner (manifest
    index 6) strips plan tools before tool-activation (index 22) computes its pool; the pool
    now re-adds the flat plan tools. Pinned by a mixed manifest-order test, the class the
    isolated-load tests structurally miss.
  - A3: headless `plan_write` was rejected with "available only after /plan" — a command the
    model cannot type; an ACTIVE plan_write (via capability) now works headlessly.
  - A4: the unresolved-omission rule fired during pre-go review and named `plan_update`, which
    planning mode blocks; the protection now begins at `/plan-go` (review-phase drops are
    legitimate revision) and the executing-phase text names the retain-with-item_id escape.
  - A5: one `capability` call during `/plan` burned the family's single attempt for the whole
    session; refusals that are not the model's fault no longer consume it.
  - A6: a reload during `/plan` left the session read-only forever; `/plan-go`/`/plan-cancel`
    now restore the execution surface from the immutable startup baseline (core-profile
    filtered) when the in-memory bookkeeping is gone.
  - B1: loop-breaker could WALL argument-free `verify_project` as an exact repeat while
    verify-gate demanded it — deadlock on a red gate; verify_project is now wall-exempt
    (episodes and telemetry still count it).
  - B3/B4: the one-in-progress and unknown-item_id rejections now name the conflicting item
    and list the valid ids — previously the model had no route to rediscover ids after
    compaction except triggering another rejection.
- Deferred with reasons (recorded, not dropped): verify-gate charges fires at proposal rather
  than delivery (B6); drift-scanner's idle-boundary follow-up turn and missing session_start
  reset (C1); LB_SESSION_REPEAT wrap-up one-shot (C2); tool-call-rescue prose false-positives
  (C3); closed CORE_NAMES/family rosters give MCP tools no activation route (D).

### Fixed (2026-08-25 — verify-gate wrap-up nag looped after the final answer)

- Consecutive wrap-up nags now require new tool evidence between firings. A delivered steer
  always triggers a fresh model turn (pi's `sendUserMessage` contract), so a wrap-up nag whose
  reply was another prose-only turn re-fired the same nag — up to the caps (3 consecutive, 9 per
  session with a detected gate) — appending a nag/reply tail AFTER the user's real final answer
  and burning an inference turn per nag. A second nag now needs at least one tool call (a
  mutation or gate attempt) since the last one; a prose-only reply ends the nagging and the
  non-turn-triggering `agent_end` warning remains the honest terminal state. Counterfactually
  pinned in `verify-gate.test.ts`.

### Fixed (2026-08-25 — planner too strict: resume and skill-driven planning)

- `/plan-go` now re-activates `plan_write`/`plan_update` unconditionally. After a pi restart the
  in-memory planning-surface bookkeeping is gone, so the old restore path was a no-op while
  `session_start` had stripped the plan tools — resuming an interrupted plan steered the model
  into a "plan-write not available" loop (observed live).
- The `planning` capability family is available in every session (previously only under the dark
  deep-research flags): `capability(action="enable", family="planning")` additively activates the
  flat `plan_write`/`plan_update` pair, giving skills that structure multi-item work (e.g.
  process-circleback's one-item-per-meeting pattern) a legal route to the planner without the
  human `/plan` surface. The graph tools (`research_plan_start`, `plan_expand`, `plan_settle`)
  remain dark behind `PLAN_GRAPH`/`DEEP_RESEARCH_PLANNING`. Ordinary sessions still start with
  no plan tools and are never forced through planning. Both fixes counterfactually pinned.

### Fixed (2026-08-25 — explicit-selection inference broke /plan on Pi 0.84.3)

- Explicit user tool selection is now judged by positive evidence only: CLI tool flags
  (`--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`) and a settings
  `defaultTools` array. The old inference from baseline shape (any non-whitelisted tool
  present-but-inactive) was version-coupled to Pi's builtin roster: Pi 0.84.3 added
  `powershell` as a default-inactive builtin, so every fresh session classified as
  user-narrowed, skipped the core profile, and refused `/plan` ("the explicit tool selection
  excludes plan_write") — observed live on a package-installed deployment even after the
  reload re-entry fix below. Pi's initial active set never derives from persisted session
  state, so an inactive tool at a clean baseline is Pi's own default, never a user selection.
  The incomplete-bootstrap branch also no longer forces explicit (it bricked `/plan` for a
  condition the user did not cause); it keeps a distinct telemetry reason. Regression proven
  by counterfactual: a registered default-inactive `powershell` stays non-explicit with core
  narrowing applied.

### Fixed (2026-08-25 — reload re-entry broke /plan)

- The initial tool surface captured by `session-bootstrap` is now immutable for the process
  lifetime (first capture wins). Pi re-emits `session_start` on `/reload` — and
  `pi update --extensions` reloads — rebuilding the runtime from the CURRENT active set, i.e.
  the spine the harness itself had narrowed. Re-capturing that surface made
  `baselineLooksExplicit` read the harness's own core-profile narrowing as an explicit user
  allowlist: core mode was skipped, `plan_write` stayed inactive, and `/plan` refused with
  "the explicit tool selection excludes plan_write" (observed live on a package-installed
  deployment). Fresh processes are unaffected — `initialActiveToolNames` never comes from
  persisted session state — so first-wins closes the only corruption path. Both-polarity
  regression proven by counterfactual (`tool-activation.test.ts`).

### Documentation (2026-08-25 — drift repair from the handover inspection)

- `HANDOVER.md`: the deep-inspection close-out no longer claims to be the current snapshot
  (superseded same day by the shotgun adoption — banner states exactly which numbers moved);
  the "remaining human step" on the two fixture pins is marked DONE (`adc72c7`, same day).
- `docs/SURFACE_BOUNDARIES.md`: the shotgun row's orphaned second table is merged into the main
  table, the 2026-08-21/24 rows are date-ordered, and the shotgun row now states explicitly that
  it supersedes `e68f1543…` and that future measurements bind `acd18a54…`.
- `docs/HARNESS_CALL_GRAPH.md`: the working-memory state row contradicted the no-automatic-
  injection contract ("rendered into context"); it now states the dark, explicit-tool,
  never-auto-injected reality.
- `MEASUREMENT_METHODOLOGY_2026-07.md` §18: the "2–4 correct sessions" admission clause carries
  a supersession note pointing at the ONE rule (graded A1/A2/A3 + E1; binary form transitional).
- `optimizer/real_gate.sh`: the post-calibrate hint advertised `admission_rule.py $GEN`, which
  is a no-op (its `__main__` is `--selftest` only); the hint now names the real paths (staged
  pipeline in-process, or `admission_rule.core_admission`). Text-only; no behavior change.

### Fixed (2026-08-25)

- `optimizer/prompt-lab/context_telemetry.py`: the `episode_id` validators required 64-hex ids
  while the harness emits 16-hex ids (`failure-episodes.ts` truncates the episode key), silently
  zeroing `failures_after_second`, `recovered_episodes`, and `recovery_calls_total/max` on every
  real row; the self-test masked it with synthetic 64-hex ids. Regexes now match the emitted
  shape and the self-test uses realistic ids (counterfactually proven: reverting the regex fails
  the self-test). The primary outcome `semantic_failure_overrun` was never affected.

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

### Changed

- **Retired the inert provider-patience runtime shim (2026-08-24):** live tracing proved that
  Pi's installed npm-undici fetch uses Pi's own dispatcher, so the Node-global dispatcher swap
  could never govern provider requests. The extension, manifest entry, telemetry event, tests,
  and subagent environment propagation are removed. Pi's supported `httpIdleTimeoutMs` setting
  remains the sole request-patience control. Historical entries below are preserved as the
  diagnosis trail, not current behavior.

- **AVO adoption batch (2026-08-24, Albert-approved judgment adoptions):** the archived 3-day
  session's two research artifacts (NVIDIA AVO + the graph-architect frame) were verified against
  the tree; the finding is that the harness already contains five of AVO's six pillars, three of
  them dark. Two flips: `VERIFICATION_PLATEAU` unset now means **enforce** (the supervisor pillar —
  redirect on 3 successful-mutation epochs with no frontier advance; the 3-day session plateaued at
  exactly this condition and stalled overnight) and `RUN_CAPSULE` unset now means **recovery** (the
  resume-from-state pillar — one bounded brief injected at compaction/provider-retry; the session
  hit those seams 4x and reconstructed each time). `WORKING_MEMORY` deliberately stays dark: it adds
  a tool to the surface exactly where the measured failure mode is tool operation. Both flips carry
  default-pinning tests proven by reverting, single-env rollbacks (`=shadow`), and honest caveats
  (benefit not established by a powered trial). The artifacts' stale recommendations (memory-store
  merge, symbolect removal, double-steer fix) are dispositioned with verified reasons in HANDOVER.
  Also: the vendored subagent timeout default rises 600s -> 1800s (`pi-subagent/timeout.ts`; an
  explorer child hit the 600s wall and blocked its parent overnight, while Pi's provider request
  patience is independently configured), and `real_gate.sh`'s `loaded_alias()` returns the
  loaded member instead of `data[0]` (both llama-swap traps from the mothball doc now fixed in
  code).

### Fixed

- **Dense-read context headroom (2026-08-24):** the observed overflow admitted a 65,597-token
  request against a 65,536-token server, compacted reactively, then let one turn re-read roughly
  90 KiB and fail again at 69,501. The existing inlet guarded risky files at 8 KiB but allowed
  ordinary unbounded reads up to 64 KiB and treated any positive `limit` as bounded. Normal
  unbounded reads now stop at 32 KiB, and files above their class threshold require pages of at
  most 200 lines or the existing span/search tools. The live Ornith registry also keeps the full
  supported 8,192-token headroom below the served 65,536 context.

- **The 300s "Request timed out." root cause was pi's own `httpIdleTimeoutMs`, not Node's undici
  (2026-08-24):** a live AlbertWork session on the fully-patched surface still died headerless at
  exactly 300.5s while `provider-patience/applied` read true. Tracing into pi-coding-agent:
  `configureHttpDispatcher` builds its own undici agent with `headersTimeout`/`bodyTimeout` =
  `httpIdleTimeoutMs` (default 300,000ms) AND installs npm-undici's fetch — which reads pi's
  dispatcher, not the node-registry symbols provider-patience swaps. The extension is therefore
  measured INERT inside pi sessions (its unit tests and smokes pass because they exercise Node's
  fetch and never a >300s request). Fix: `httpIdleTimeoutMs: 1800000` in the live settings.json
  (pi's supported knob; backup kept). The 2026-08-22 provider-patience entry below stands as
  history of an honest but incomplete diagnosis; the inert extension is now retired. The
  same session also surfaced a context-overflow loop (65,597 → compaction → one turn re-read 90KB →
  69,501 against a 65,536 serving window) recorded in HANDOVER as an open finding.

### Added — historical, superseded by the retirement above

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
