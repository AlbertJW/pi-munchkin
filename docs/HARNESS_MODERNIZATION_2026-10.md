# Harness modernization — October 2026

Branch `codex/pi-update-lane`, from live release `813553b`. Follows
`MUNCHKIN_HARNESS_AUDIT_AND_ROADMAP_2026-10.md` and
`PI_UPDATES_AND_HARNESS_STRUCTURE_OPTIONS_2026-10.md` (in the findings checkout).

Constraints for this work: model-agnostic (no per-model tuning or thresholds), never run against a
model or llama.cpp, verify offline only. Every change has tests that fail on the previous code.

## What changed

| Area | Change | Why |
|---|---|---|
| Pi support | Develop and typecheck on Pi 1.1.0; refuse Pi < 1.0.4 or a new major; unqualified 1.x minors load with one warning; `QUALIFIED_PI_VERSIONS` registry; receipt `piQualified` | Tests ran only on 0.80.6 while live ran 1.1.0 |
| Updating Pi | `npm run qualify:pi [-- --stage latest]`: tests + typecheck + full-stack host qualification, scripted provider, sandboxed | Pi ships every few days |
| Continuations | ≤3 harness-started turns / 20 min per user message; aborts stay stopped; one delivery per owner revision | Audit R1/R2; duplicate compaction + goal continuation |
| Tool selection | `-t`, `-xt`, `-nt`, `-nbt`, inline forms explicit; `+name/-name` additive, removals never re-added | Audit R3/R4 |
| Telemetry | Selected model stamped on interactive rows | 99.6 % of rows had no model |
| Drift scanner | Opt-in (`DRIFT_SCANNER=on`) | Hidden background model call |
| Goals | 80/20 settlement is a proposal only the user accepts; settlements record verification state; brief injected once per revision (+ after compaction); paused research holds execution; `/goal-status` names a stuck lock | User authority; Pi persists `before_agent_start` messages, so per-run injection duplicated the brief |
| Compaction | Resume after a failed compaction no longer says it finished | Audit V4 |
| Read guard | Risky files judged by extension, directory role, or non-source name — not substrings | `session-manager.ts` etc. were refused |
| Bash guard (dark) | Keeps the command's real status; points at Pi's saved full output | Successful commands looked failed |
| Research skill | Default workflow 10.5 KB → 4.6 KB; planned-research rules in `references/planned-research.md`, read only when those tools exist | Agent Skills progressive disclosure |
| CI | Isolated-consumer matrix on 1.0.4 and newest Pi; peer range `>=1.0.4 <2` | Old 0.80–0.84 matrix |

## Decided against (with reasons)

- **Migrating tool activation to Pi's `exposure: "deferred"` + `tool_search`.** Pi can set exposure
  only on tools an extension registers; the core profile also narrows Pi built-ins and other
  packages' tools (`browser_*`, `tldraw_*`), so the deferred-pool logic stays either way. `tool_search`
  is off by default in Pi and adds a ranked search turn before use; Munchkin's `capability` families
  are explicit and deterministic, which is the model-agnostic property wanted here. Pi notes that any
  mid-session tool change can force a transcript checkpoint that invalidates a cached prefix
  (`docs/extensions.md`, "Activate tools dynamically"); that applies to both designs, so it does not
  favour migration. Revisit if Pi lets extensions set exposure for tools they did not register.
- **A default research search/read wall.** Ketch's counters are session-wide; a 3-search/5-read
  default would cripple any session that researches twice. Live telemetry showed 7 searches and
  6 reads in 11 days, no runaway. The README now states the real default.
- **Moving the remaining process-global state to event-bus ownership** (~20 `globalThis` fields,
  ~100 references, read directly by 25+ test files). The Pi CLI runs one session per process, so this
  only matters to SDK embedders; regression risk outweighs the benefit here.
- **Replacing Munchkin's context handoff with Pi-native compaction.** Pi already compacts on its own
  threshold (window − `reserveTokens`), which fires first for declared windows. The handoff still
  covers the one case Pi cannot see: a server serving a smaller window than the registry declares
  (the serving-truth probe). Kept.
- **Stealing stale plan locks atomically.** The read-then-unlink race needs two processes to judge
  the same lock stale at once; single-user, low probability. Not worth a new lock protocol.

## Upcoming Pi (unreleased on `main`, checked 2026-10-12)

`before_agent_start` will also fire for idle `sendMessage(..., { triggerTurn: true })` runs, with
`event.messageType` = `"user"` or `"custom"`; sessions count as busy while a run starts; tools gain
`reachesTools`. The branch is compatible: goal commands already mark their brief as in context, and
the continuation budget treats a `/goal` command run as the user's turn, which it is. Run
`npm run qualify:pi -- --stage latest` when it ships.

## Not done yet

- Deploying this branch (release-clone procedure; stop Pi sessions first). When deploying, also
  remove the live top-level `~/.pi/agent/extensions/chaos.ts` and the stale `~/.pi/agent/lib/` it
  imports — both are test-only.
- Vision (dark, not deployed): downscale captures and map coordinates before any promotion.
- Retention for run capsules and cockpits (manual today).

## Sources

- Pi 1.1.0 docs in `node_modules/@earendil-works/pi-coding-agent/docs/` (extensions, cli, settings,
  skills, compaction) and Pi `main` changelog,
  [CHANGELOG.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md).
- [Agent Skills](https://agentskills.io/) progressive disclosure.
- Harness research cited in `PI_UPDATES_AND_HARNESS_STRUCTURE_OPTIONS_2026-10.md`.
