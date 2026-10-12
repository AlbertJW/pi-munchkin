# SWE-Marathon zstd-decoder / ObservationPack pilot preparation

**Status:** PREPARED, BLOCKED — no execution candidate frozen; no environment or grader run; no inference.

**Prepared:** 2026-09-25

**Scope:** one diagnostic A/B pair, Hashline 2.0 held on in both arms, ObservationPack off/on. This is an effect-of-enabling-ObservationPack comparison, including its conditional `obs_recall` tool-schema addition. It does not isolate archive packing from that schema change and one pair cannot establish benefit.

## Reconciliation and candidate identity

The ObservationPack package reconciliation is complete: the live Pi settings reference `/Users/Albert.Wessels/LLM/local-packages/sol-pi-observationpack`; Pi reports version `0.87.1`; the local adapted checkout is clean at `5fc5c983f94da9aa2da876db6c74b58e0833fd9e`; its three source hashes match the 2026-09-25 release receipt; and the existing configuration has ObservationPack on with Action Fusion, Evidence-Preserving Reducer, and Online Context Compact off. The live `hashline.ts` and `context-dedup.ts` are byte-identical to repository main.

There is nevertheless a benchmark-blocking harness identity mismatch. The current repository is clean at `5585ed2cc6fbc3310f902ea2aaa6bd107bbc25c0` with source-surface hash `3036caf58245ac7e26b50279b20946812793c1a26064504ea18dbe03708c58d7`. The installed live `tool-activation.ts` hashes to `8a946c1dc8c99a1957a8321fdaee5c9b1c59348db52f1be9b64065b4f3f11d57`, while repository main hashes to `4a11a04176bfe19df84ae2504b2e1ed0198fd0c6f2401a1e6f8a99ae2dc253de`. The known preserved live-only changes remove core grep/find activation and vision capability-family activation/schema. Those changes affect the model-visible tool contract. The prior SoL-Pi reconciliation intentionally preserved these differences; this preparation does not treat the whole harness as reconciled.

**Freeze blocker:** before creating a runnable candidate, choose and pin one complete harness identity: (a) the current live activation file as a separately versioned overlay, or (b) repository main after a separately approved live reconciliation. Until then, do not label either arm “the current harness” and do not execute. No live file was changed.

## Provisional benchmark manifest

These pins define the proposed task and comparison. The unresolved entries below remain hard gates.

| Component | Provisional pin / status |
|---|---|
| Benchmark | `https://github.com/abundant-ai/swe-marathon`, commit `146996e336fc5026aa52f5adb14c622c5886520e` (GitHub `main` latest commit shown as 2026-09-04 at inspection). |
| Task identity | `tasks/zstd-decoder`, task schema version `1.0`, name `abundant/zstd-decoder`. Commit pin covers the task files. Pinned task inputs include `instruction.md`, `environment/Dockerfile`, `environment/rfc8878.txt`, `environment/src/{Makefile,harness.c,zstd_decompress.c,zstd_decompress.h}`, `environment/test.sh`, `environment/test_artifacts/compressed/*`, and `tests/test.sh`. In the agent runtime, expose only the official instruction and `/app` task workspace created by the environment image; do not expose task metadata, the Docker build context, or grader-only files. |
| Official grader | `tasks/zstd-decoder/tests/test.sh` at the benchmark commit. Harbor must run it only in its verifier/grader stage. The public `/app/test.sh` remains available to the agent as specified by the task. |
| Task environment recipe | `tasks/zstd-decoder/environment/Dockerfile` at that commit; Ubuntu `24.04`; Linux `amd64` is the proposed execution architecture. Task limits: 4 CPUs, 16,384 MiB RAM, 20,480 MiB storage, no GPU; agent timeout 18,000 s (5 h); build and verifier timeout 1,200 s each. Preserve task network modes: public environment build, allowlisted agent egress only for the model endpoint, no-network verifier. |
| Image identity | **Unresolved:** the task uses a Dockerfile and mutable `ubuntu:24.04` base tag rather than a recorded immutable image digest. A Harbor build must resolve the base and produce a concrete platform-specific image digest before the candidate can be frozen or either arm run. Pin and record Harbor’s resulting image digest and architecture; do not accept a tag alone. |
| Harbor | Proposed CLI version `0.20.0`, matching the benchmark repository’s `scripts/run-benchmark.sh`; proposed execution backend `modal`. Neither Harbor nor a usable Docker daemon is available on this host; Modal credentials are not configured. The task’s required execution host is therefore **not currently available**. |
| Pi / harness runtime | Intended installed runtime is `@earendil-works/pi-coding-agent` `0.87.1`; harness repository pin is above. A Harbor PyPI wrapper was found at `harbor-pi-sdk-agent==0.1.6`, wheel SHA-256 `09ee67e034df7d821d9e6ae9b985aaaf8fc2b6af744582001b3c64cc6deb736b`. Its public documentation describes a wrapper around `@mariozechner/pi-coding-agent`, while the installed harness extensions import `@earendil-works/pi-coding-agent`. The wrapper is alpha and PyPI marks it `LicenseRef-Proprietary`. **Compatibility is unverified and is a second execution blocker**; do not assume this wrapper runs the installed harness unchanged. |
| SoL-Pi adaptation | Local source commit `5fc5c983f94da9aa2da876db6c74b58e0833fd9e`, no remote. Source SHA-256s: `src/sol-pi/extensions/observation-pack/index.ts` `daede6c69ce8aede0f7d1adfe4a620d62762a5339ad32bedbc28ab8f03cc9688`; `observation.ts` `a4adba8b15f951261033811554044e65253b4b916ffdcc903f477bfa2887f341`; `src/sol-pi/index.ts` `a9cc7b4b05724a672428288381211838dafa668ba6031d777d5fb4b912609758`. |
| Model / serving | **Unresolved.** Freeze provider, model identifier and revision/quantization, serving build, tokenizer/usage-reporting behavior, endpoint identity, and credentials source before execution. Do not infer these from the machine’s current router or saved defaults. Harbor allowlist must expose only the selected model endpoint. |

The task describes implementation of a C99 decoder from RFC 8878, permits only the supplied `libxxhash` checksum helper, disallows existing zstd implementations, and says no network/package manager/interpreters during agent work. Its public task metadata estimates 12 expert hours; the pilot retains the stricter official 5-hour agent timeout. These requirements are from the pinned task definition, not additional instructions invented for the agent.

## Arms and adapter contract

After clearing the blockers, stage one read-only, content-addressed Pi extension bundle from the chosen harness identity and the SoL-Pi adaptation. Each arm gets a distinct Harbor trial, fresh Pi process, fresh session directory, fresh task workspace, fresh SoL-Pi runtime/archive directory, and isolated Pi agent home. Never reuse session history or ObservationPack archives between arms.

- **A — control:** Hashline enabled; `observationPack=false`; Action Fusion, Evidence-Preserving Reducer, and Online Context Compact false.
- **B — treatment:** same bundle, Pi runtime, model, serving, base prompt, task image, tools, limits, and configuration except `observationPack=true`; the other three mechanisms remain false.
- Record the `obs_recall` registration/schema as part of B’s treatment. In A it must be absent, not registered-but-inaccessible. This is a declared treatment difference and its schema-token cost is included in the effect.
- Use identical Pi system settings and the official task instruction in both arms. Do not supply this planning conversation, earlier agent sessions, reference code, solution explanations, hidden-test data, grader files, task metadata, or run receipts to the agent. Verify the exact Harbor agent prompt/context payload before starting; if Harbor or the Pi adapter includes anything beyond the official instruction and task workspace, stop.
- Hashline, ObservationPack, and harness source are immutable during both runs. Do not introduce follow-up prompts or automatic continuation. Keep the task’s 18,000-second timeout. Configure the adapter with its continuation feature disabled (`continue_after_compaction=0`); any ordinary Pi compaction behavior must otherwise match both arms and be recorded.

The installed SoL-Pi configuration is not to be edited for the experiment. Build two isolated homes from one reviewed config template and vary only `observationPack`; explicit values for the four mechanism flags are required. Run the actual Pi harness/SDK, not Claude Code, Codex, a substitute agent, or a locally scripted coding loop. Harbor is limited to provisioning, supervising those Pi trials, collecting artifacts, and running the official grader.

**Adapter gate:** verify in a no-model Pi/Harbor dry run that the selected Harbor Pi integration loads Pi `0.87.1` with the chosen `@earendil-works` SDK and both pinned extension packages in the recorded order; starts with the expected schemas; provides only the Harbor task workspace for read/write/bash operations; and does not copy grader files into agent-visible paths. The discovered PyPI wrapper’s different package scope means this has not yet been satisfied. Do not use `local_extension_paths` as proof that a multi-file package with relative imports and package dependencies was copied correctly. Preserve the full directory layout and verify all staged file hashes if a compatible adapter is established.

## Frozen pilot rules (execution remains blocked)

1. After all identity, host, and no-model adapter/grader checks pass, generate a 256-bit random seed immediately before the pilot. Derive the arm order from `SHA256(seed || pair_id)` modulo two, then record seed, order, timestamp, and manifest hash in an append-only receipt before either agent starts. Do not rerandomize. Execute sequentially with Harbor concurrency one.
2. One pair only. A timeout, provider failure, infrastructure failure, wrong tool surface, grader failure, or agent crash is retained as that arm’s result. Do not rerun or substitute a failed cell. Classify infrastructure/setup/grader failures separately from agent failures; any invalid pair is incomplete and cannot support a benefit conclusion.
3. Hard cap: 3,600 seconds agent time per arm and 7,200 aggregate agent-seconds (10 agent-hours). Separate allowance: at most 7,200 seconds for setup/preflight and 3,600 seconds total grader/artifact collection. Respect the stricter task timeout and Harbor limits.
4. Record independently for each arm: official reward/score and official test counts; completion status and failure class; Harbor wall time; provider-reported prompt/completion/total tokens if the serving response reports them; Pi/extension estimated counts separately and labeled estimated; Pi tool-call counts by name; `obs_recall` call/page counts and archived-byte counts; repeated reads (same normalized path and range/query repeated within that arm); compactions/continuations; and run/image/source/config/seed receipts. Missing provider usage remains unavailable, never filled with a Pi estimate.
5. Compare the paired outcomes descriptively only. Do not pool, replace, selectively exclude, or claim statistical evidence. One pair is diagnostic and cannot establish that ObservationPack is beneficial. Report both absolute arm outcomes and the observed within-pair difference, including cost/schema overhead.

## Validation attempted and current result

- Harness checkout: clean `main` at `5585ed2cc6fbc3310f902ea2aaa6bd107bbc25c0`; current source-surface hash recomputed as `3036caf58245ac7e26b50279b20946812793c1a26064504ea18dbe03708c58d7`.
- SoL-Pi release reconciliation: current package registration, local package commit, selected source hashes, settings state, and live activation hash agree with `SOL_PI_OBSERVATION_PACK_LIVE_RELEASE_2026-09-25.json` and `SOL_PI_OBSERVATION_PACK_ACTUAL_HOST_2026-09-25.json`.
- Harness/live diff: confirmed and recorded above. This is a blocker to choosing the exact benchmark bundle, not a request to alter live files.
- Execution host: `harbor` is not installed; Docker client `29.5.3` cannot connect because its daemon socket is absent; no Modal CLI/token is configured. Local host is Apple M3 Pro, 12 cores, 36 GiB RAM, arm64, which is not the proposed task architecture and has no running Docker backend. No Harbor environment was provisioned.
- Model-free environment/grader validation and official oracle/baseline check: **NOT RUN** because Harbor and a working execution host are unavailable. No substitute local/mock grader was used. The public `task.toml` contains solution-explanation metadata; this document excludes its contents, and the eventual agent context must exclude that metadata and all solution/grader materials. No reference implementation or hidden test contents were used for validation.
- No inference, benchmark solution work, live change, optimizer restart, push, or model call occurred.

## Required approvals and later execution command

Before execution, resolve: (1) canonical harness activation file and freeze its complete bundle; (2) a Harbor adapter using the `@earendil-works` Pi SDK/runtime, or approve a separately validated compatibility adaptation; (3) Harbor/Modal availability and isolated host; (4) immutable built image digest/architecture and official grader/oracle no-model check; and (5) exact model/serving identity plus provider token telemetry. Then approve the frozen candidate and the one-pair pilot as a separate action.

The intended Harbor invocation, to be run once per arm in the committed random order after those gates, is:

```sh
harbor run \
  -p tasks/zstd-decoder \
  --agent-import-path harbor_pi_sdk_agent.agent:PiSdkAgent \
  -m "$PI_MODEL_ID" \
  -e modal \
  --agent-kwarg "model_name=$PI_MODEL_ID" \
  --agent-kwarg "api_key_env=$PI_API_KEY_ENV" \
  --agent-kwarg "extension_paths=$PI_BUNDLE/extensions/hashline.ts,$PI_BUNDLE/extensions/context-dedup.ts,$PI_BUNDLE/extensions/tool-activation.ts,$SOL_PI_BUNDLE/src/sol-pi/index.ts" \
  --agent-kwarg "continue_after_compaction=0" \
  --agent-kwarg "progress_events=1" \
  --agent-kwarg "raw_events=0"
```

This is a command template, not an approved/executable command: the Pi adapter and package layout are not validated, model variables are unresolved, and the harness activation identity is blocked. Before execution, the trial adapter must replace the simple file list with a hash-verified staged bundle that preserves all relative-import and dependency paths, create isolated per-arm homes/configs without modifying live settings, and prove the official grader/oracle path through Harbor. Do not launch this command until those checks and separate execution approval are recorded.

## Source references

- [SWE-Marathon repository and official Harbor invocation](https://github.com/abundant-ai/swe-marathon)
- [Pinned zstd-decoder task definition](https://github.com/abundant-ai/swe-marathon/blob/146996e336fc5026aa52f5adb14c622c5886520e/tasks/zstd-decoder/task.toml)
- [Pinned official task instructions](https://github.com/abundant-ai/swe-marathon/blob/146996e336fc5026aa52f5adb14c622c5886520e/tasks/zstd-decoder/instruction.md)
- [Pinned environment Dockerfile](https://github.com/abundant-ai/swe-marathon/blob/146996e336fc5026aa52f5adb14c622c5886520e/tasks/zstd-decoder/environment/Dockerfile)
- [Pinned official verifier](https://github.com/abundant-ai/swe-marathon/blob/146996e336fc5026aa52f5adb14c622c5886520e/tasks/zstd-decoder/tests/test.sh)
- [SWE-Marathon Harbor run script](https://github.com/abundant-ai/swe-marathon/blob/146996e336fc5026aa52f5adb14c622c5886520e/scripts/run-benchmark.sh)
- [Harbor custom agents](https://github.com/harbor-framework/harbor/tree/main/docs/content/docs/agents)
- [Pi SDK Harbor wrapper documentation](https://pypi.org/project/harbor-pi-sdk-agent/)
- Local reconciliation evidence: `SOL_PI_OBSERVATION_PACK_LIVE_RELEASE_2026-09-25.json`, `SOL_PI_OBSERVATION_PACK_ACTUAL_HOST_2026-09-25.json`, and `SOL_PI_OBSERVATION_PACK_RECONCILIATION_2026-09-25.md`.
