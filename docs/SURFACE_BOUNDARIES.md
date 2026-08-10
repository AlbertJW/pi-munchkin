# Harness surface boundaries

Model-visible harness changes are one-way measurement boundaries. Never pool rows across a
boundary, even when both sides pass the same task gate. Each gate row must carry the loaded
`HARNESS_SURFACE_SHA256`; the source hashes below are review aids and are not substitutes for the
loaded live receipt.

Generate the current deterministic package-source code/role surface with:

```sh
npm run surface:hash:source
```

| Date | Sequential change | Commit | Package-source surface SHA-256 | Live status |
|---|---|---|---|---|
| 2026-08-04 | gate and repeat-loop correctness | `36b3f80` | `090f867525f79ed61fe25e7a047d7c6c7dbc7e8f84a1ddb9ff00db3f45746103` | included in approved batch rollout; not measured separately |
| 2026-08-04 | security, privacy, bounded I/O | `e3dfc0b` | `16b0e1495c5c708c991549c6b506d81d3993a7351a900be2d314609579ee06a0` | included in approved batch rollout; not measured separately |
| 2026-08-04 | dynamic surface implementation | `5c0d2bc` | `48a4f31e7455a31d3320dd43f4231dd1c9ba340b6f371a13ddcbd99cab498fc8` | included in approved batch rollout; not measured separately |
| 2026-08-04 | approved dynamic/state-lens defaults | `cbbc8fa` | `f678b84d7de71ea37daae836a70bb7e062d4f1cbf3a692eb4d2f3d25f7daf1e2` | rolled out; loaded live hash `440796cf2d555a4b09e9cfaaf8fb5f7ba451d0ce38efe2b7988bfd13c5e667ad` |
| 2026-08-05 | settlement/episode series (semantic failure-episode shadow instrument, runtime-truth, agent_settled alignment) | `d6ed2c3` | `0336406d5547ae5842e50bc647f9745c78abed19d0c83af3d4090caf7b09b2da` | rolled out 2026-08-05; loaded live hash `ea87250f447b5c0f826ebbd5de2745b0b125a6ca3d5893b7d57294f5df7affd9` (mirror:check 82/82; live pi load confirmed) |
| 2026-08-05 | deep-research pipeline (skill v2 always-on; `research_note`/page-cache/budget-footer dark behind `RESEARCH_LEDGER`) | `3581f1c` | `ad5fdddd9f8ef169d0e0a89b526596b5fa10a814d7011296c6f9c12308e6c142` | rolled out 2026-08-05; loaded live hash `1b7aa081e4ba4be97695f8c4ffc30d139a36a9b23b20619333e3c787fbf23b0a` (mirror:check 84/84; live pi load confirmed dark-absent / armed-present) |
| 2026-08-05 | deep-research eval fixes (skill v3 short-quote/no-fabrication text always-on; auto-correct + wrap-steer dark behind `RESEARCH_LEDGER`) | `48640f2` | `dbea1aa3c49043519c60cc98c4716ba60bf0862adce9825619dce32b2fe24343` | rolled out 2026-08-05; loaded live hash `acf00eb80a47a233c5539eeeaca5cb5d0c6c62293242ab64088a77892dea5ce6` (mirror:check 84/84; dark-absent / armed-present confirmed) |
| 2026-08-06 | research-ledger QA fixes (ledger path in the budget footer + re-attribution recorded + neutral lens wording — all dark behind `RESEARCH_LEDGER`, no always-on delta) | `88e4352` | `d9b7509c0bfeba13f2d99489dc787cb9ca928418d1041653df53dccdf7ff58ec` | rolled out 2026-08-06; loaded live hash `041d25c110c99afa8aa03d96aa8d989839286e467b0f245f8428af37e8379b92` (mirror:check 84/84; dark-absent / armed-present confirmed) |
| 2026-08-07 | nine-flag adoption default-on (c31/c34/c36/c38/c39/c49/c30/c26/c13): plan_go + search_spans/read_span become always-visible tools, context-brief system-prompt append, plan/spawn wording, c38 block live (gemma-skipped) — ALL always-on model-visible deltas | `a739227` | `955bf23816fb3a1d6822fb0684ca14f66c0d6fe08d16be045dddba2ac3658b03` | rolled out 2026-08-07; loaded live hash `2b4ba598f5d928d66effadfdf3008791f354a7b1d34ef6333b587f7713ff1901` (mirror:check 84/84; live pi load: all three tools present unset, absent under =off; c38 block→plan_write→plan_go(tool)→write chain observed live on the DD) |
| 2026-08-06 | deep-research skill: note/verify steps made conditional on the tool existing, retry capped (Run 3 abort finding) — ALWAYS-ON text change | `747cc92` | `d9b7509c0bfeba13f2d99489dc787cb9ca928418d1041653df53dccdf7ff58ec` | rolled out 2026-08-06; loaded live hash `041d25c110c99afa8aa03d96aa8d989839286e467b0f245f8428af37e8379b92` (mirror:check 84/84). Run 3 measured the PREVIOUS skill text; this row supersedes it. |
| 2026-08-10 | parent-owned research proof: genuine tool errors, private v2 JSONL, bounded `research_recall`, parent re-read delegation contract, verifier subprocess removed | `8d3393c` | `d61a039dad8eb462f23a706b122e223548f5a4f56be45929f34e4d9cdeccfc3d` | included in the approved 2026-08-10 batch rollout; not loaded separately; `RESEARCH_LEDGER` remains dark |
| 2026-08-10 | semantic-overrun refinement: snapshot v2, correlated diagnostic, exposed-key hot path, start-time plan-item binding; enforcement unchanged | `0aa45cd` | `14a93fc741b997c0f486cb76d2c79798e7b39278f4136a1c94bf7911b2968afd` | included in the approved 2026-08-10 batch rollout; not loaded separately; `LOOP_EPISODE_MODE=shadow` remains the default |
| 2026-08-10 | run-kernel PR 1: typed canonical receipts and in-memory shadow reducer; no model/control mutation | `286a48d` | `765b6d787334b76635384fb05aa11eac437fba43acb9bfc273cb2d4977ee355b` | rolled out 2026-08-10; loaded live hash `d38af40de1654ed264e67f7d95fa9466a2cfa35ce433a1caaf6065b815b2c634` (mirror:check 90/90; live Pi 0.83 loaded all 27 declared extensions and 2 skills); `RUN_KERNEL=shadow`, rollback `off` |
| 2026-08-10 | run-kernel PR 2: execution-order verifier, per-file hashline queues, active-only tool prompt surface | PR 2 implementation | `01990f1cfc2018f203fab0f7eae8d63a1f6e096aed9736d2599104c8183f91f3` | dark source only; not mirrored; deployed defaults unchanged; opt in with `VERIFY_EXECUTION_ORDER=execution` and `ACTIVE_TOOL_PROMPTS=active` |
| 2026-08-10 | run-kernel PR 3: shadow control arbiter, typed domain signals, bounded optional async telemetry writer | PR 3 implementation | `6548d5d9265ed5e9b7643e55a10ccb9df22381eafe3827209e72b5b993943f54` | dark source only; not mirrored; `CONTROL_ARBITER=shadow`, `TELEMETRY_WRITER=sync`; enforce/async require separate adoption |

PR 4 changes package, CI, operational tooling, and narrative. Its new mirror/secret-scan libraries
are not imported by the runtime extension manifest, so it does not create a model-visible runtime
surface boundary. If that fact changes during review, add a row before merge.

At an approved rollout, append the exact loaded hash and rollout commit here only after
`npm run mirror:check -- <agent-dir>` reports zero first-party drift and the target Pi version
loads the full manifest. Do not infer a live hash from the source table.

The 2026-08-04 live hash includes the preserved local-only `extensions/chaos.ts`, which Pi 0.83
auto-discovers from an unpacked agent directory. It is excluded from the package manifest and is
inert unless explicitly armed. Measurements must bind the loaded hash above, not the package-source
hash.

---

## Data at rest: where a research session actually lands (updated 2026-08-10)

A surface hash bounds what the MODEL sees. It says nothing about what a session LEAVES. Those are
different questions, and the second one had no written answer until now — which matters, because a
deep-research run can write to **four** places. The harness ledger moved out of the project on
2026-08-10; the fetch cache and Pi transcript remain separate persistence boundaries.

| Location | Written by | Contains | Default |
|---|---|---|---|
| `${PI_CODING_AGENT_DIR}/artifacts/research-ledgers/<sha256(cwd)>/<session-uuid>.jsonl` | `ketch.ts` (`appendToLedger`) | private bounded v2 records: normalized claim, verbatim quote, query-free display URL, exact-URL hash, re-attribution, retrieval time, page sha256 | only `RESEARCH_LEDGER=on`; directory `0700`, file `0600` |
| `~/.pi/agent/sessions/<cwd-slug>/*.jsonl` | pi core | the parent transcript — **including each subagent's exact task text and the child's assistant messages** (thinking + tool-call arguments, so a `researcher` child's queries and URLs are here). Child *tool results* are not: `pi-subagent/runner-events.js:44` admits `role === "assistant"` only | always on |
| `~/Library/Caches/ketch/cache.db` | the `ketch` binary, not the harness | **raw fetched page bodies and URLs** — 2 MiB bbolt store, mode 0600, user-global, no session scoping, no TTL the harness can see, no cleanup hook. Kept alive deliberately: `ketch-runtime.ts` forwards `XDG_CACHE_HOME` | always on |
| `~/.pi/agent/telemetry/events.jsonl` | `telemetry.ts` | counts only — `FORBIDDEN_DETAIL_FIELD` bans any key matching `url`, so no queries or URLs, by construction | `TELEMETRY != off` |

Three consequences worth stating plainly:

1. **The in-memory `PageCache` is not the whole story.** The harness persists no page text; the
   fetch layer beneath it does. "Nothing is written" is true of `research-ledger.ts` and false of
   the session.
2. **Subagent visibility and durability point in opposite directions.** The parent model sees only
   the child's final string, while the disk keeps the child's reasoning and tool calls. That is the
   right direction for auditability — and it is worth noting that pi_munchkin fails none of the
   portability tests the way hosted multi-agent APIs do: the delegated task is readable plaintext
   on disk, not a provider-sealed blob.
3. **The ledger is audit data, not prompt structure.** JSONL prevents page text from forging
   Markdown sections, and `research_recall` validates and bounds records before returning them.
   Claims and quotes are still untrusted evidence: neither the parent nor a delegated child may
   follow instructions embedded in those fields. No automatic verifier subprocess reads them.
