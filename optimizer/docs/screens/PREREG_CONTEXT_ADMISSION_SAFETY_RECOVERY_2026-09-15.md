# Preregistration: CONTEXT_ADMISSION broader safety/recovery qualification (2026-09-15)

## Status

**PREPARED — NOT EXECUTED.** No case in this study has been run in this task.
This is the broader safety/recovery preregistration the Phase 3 handover names:
it closes the gap the V3 current-source screen leaves (V3 proved only one
normal admission forwarded once and one oversized request rejected pre-dispatch).
It supersedes nothing; V1/V2/V3 remain historical, not pooled evidence.

## Standing constraints (every stage)

- Each stage requires Albert's explicit approval before execution. No stage is
  self-authorizing.
- `CONTEXT_ADMISSION` remains **dark** regardless of outcome. No default,
  flag, gate, calibration, mirror, rollout, or adoption decision is made here.
- This qualifies **safety/mechanism only** — pre-dispatch admission, reservation
  and recovery behaviour. It does **not** prove task benefit, answer quality, or
  adoption. A mechanism receipt is not a value receipt.

## Frozen identity

- Study: `context-admission-safety-recovery`
- Source commit: `da3445b` (full `da3445b819976d5343847892fb4c3a58e83b0e5a`)
- Source hash: `6d5e85496ded7b4a70fdefaea1d911b6aaf409a5e5b0bcd0c9e2327be54bdf64`
  (recomputed via `npm run surface:hash:source`, 2026-09-15; matches the
  `docs/SURFACE_BOUNDARIES.md` `da3445b` row and its Scope A addendum).
- Scope A carried by `da3445b` (explicit `observed_usage_provenance`
  `estimated`/`unavailable`, admission telemetry carrying that provenance, and
  confidence downgrade when exact provider counts coexist with estimated usage)
  is the mechanism under study; the addendum is append-only, not a rewrite.

## Fixture and runner assets (SHA-256, frozen)

| Asset | Path | SHA-256 |
| --- | --- | --- |
| Qwen live-screen manifest (cases 1–2) | `harness/tests/fixtures/context-admission-qwen-v3.json` | `c47ba03c2feb98a6c73627ba2729bf74d7cfd3061aed6f7569044a617a193715` |
| Ling live-screen manifest (new, protocol arm) | `harness/tests/fixtures/context-admission-ling-v1.json` | `4490cec4b6cfaac52f0b1254cac9c0758c7395e2a249bd4ed31f04dc45e104d5` |
| Live probe runner | `harness/scripts/context-admission-live-probe.mjs` | `c1d482d6db5a1d6eb535fff94327664befc6435f1c344f76a294521fe885b4fa` |
| Admission screen evaluator | `harness/lib/context-admission-screen.ts` | `a0a041558ff41b5b3afe7b1545697f7782cfdb2f01cfab6fce3364baa7d0a68e` |
| Local forwarding proxy route | `harness/lib/local-proxy-route.ts` | `5ed9cac3fca57c816862d67fc71778d2803bcb070df4fb46a3` |
| Admission extension (admission/rejection receipts) | `harness/extensions/context-admission.ts` | `2df2fa7ab7f0fc5993f9521ee806b706363c3b3f0e75574b297f63bcaa9ead80` |
| Context accounting (provenance + confidence) | `harness/lib/context-accounting.ts` | `6862ab30fa1b0ccb278e750e26202336d82b1b7e923013ff58e9e828d75feefc` |
| Telemetry flush | `harness/extensions/telemetry-flush.ts` | `571128f7fc6e70312f345a808b39144954e6c2af876be0957fe708723386d532` |
| Deterministic accounting fault-injection tests | `harness/tests/context-accounting.test.ts` | `d909f1e4b63cb05ddce664ec8dcbce6a5164600830705c17c5e16a8b7aad3760` |
| Deterministic recovery-assembly fault-injection tests | `harness/tests/run-capsule.test.ts` | `9b90997a36ab19df8c1d7593758427628d18da64444fc19bb6987c608766b0dd` |

The Ling manifest is a **new narrowly-scoped declarative fixture** added because
the existing runner only ships a Qwen v3 manifest; it reuses the exact v3 schema
(`pi.context-admission-live-screen/v1`) and acceptance rule, with the documented
Ling identity. It is validated by the existing probe (`--dry` passes, no
inference). No new framework, runner, or option was built.

## Model identities (two separate, matched arms — no pooling)

1. **Ling protocol qualification** — subject `local-llamacpp/ling3-tiny-fast`
   (served `ling3-tiny-fast`), declared context window 61,440, output reserve
   `max_tokens` 128. Ling is a **protocol/smoke subject only**: it proves the
   admission/dispatch mechanism runs on a portable target. It is not pooled
   with Qwen and carries no efficacy weight.
2. **Matched Qwen safety/recovery qualification** — subject
   `local-llamacpp/qwen36-35b-iq3s` (served `qwen36-35b-iq3s`), declared
   context window 32,768, output reserve `max_tokens` 128. This is the
   efficacy model and the matched arm for the safety/recovery mechanism.

Sequence: Ling protocol arm **first**, then the matched Qwen arm. Each arm is a
separate serving/model/source boundary; results are never pooled across them.

## Control / treatment settings

- **Control:** `CONTEXT_ADMISSION=off` (byte-compatible flag-off path; the
  admission extension is inactive and the recovery assembly returns the full
  combined brief unchanged).
- **Treatment:** `CONTEXT_ADMISSION=on`, `CONTEXT_HANDOFF=off`, `TELEMETRY=on`
  (the model-backed probe hardcodes this environment in its private overlay).
- Serving identity: the single-slot llama-swap router at
  `http://127.0.0.1:8080/v1`. The served model must be the exact loaded model
  bound in each manifest (`ling3-tiny-fast` / `qwen36-35b-iq3s`).
- Configuration receipt required before execution: the probe's `--validate`
  launcher check (`pi --list-models`) in a fresh private Pi overlay directory,
  plus the generated `models.json` compat binding (supportsDeveloperRole
  false, supportsReasoningEffort false, supportsUsageInStreaming false,
  maxTokensField `max_tokens`, thinkingFormat `qwen-chat-template`,
  supportsStrictMode false, contextWindow 61,440 / 32,768, maxTokens 128).
- Output reserve: the per-model `max_tokens` (128) in each manifest is the
  completion reserve the admission screen accounts against.
- No retries, fallback models, calibration calls, or added cells. The proxy
  retains counts and digests only; raw prompts, responses, endpoints, and model
  errors stay private or are discarded.

## Deterministic fault-injection cases (offline, no inference)

These cases exercise the `da3445b` mechanism with **fake payloads and injected
faults** in offline harness tests — the model is never asked to produce a fault
on demand. They are the primary qualification for cases 3–11 and the offline
control for cases 1–2. Each is already present in the frozen test files above.

| # | Required case | Offline coverage (frozen test) | Expected result | Failure / incomplete rule |
| --- | --- | --- | --- | --- |
| 1 | Small normal request: admission + exactly one dispatch | `context-accounting.test.ts` aggregate-admission admission path; `context-admission-screen.test.ts` evaluator | One `admitted` receipt; one forwarded request; no reject | Any forwarded > 1, or admitted-with-no-dispatch |
| 2 | Oversized aggregate request: rejection before dispatch | `context-accounting.test.ts` "aggregate admission extension aborts an oversized payload and never exposes raw context" | `rejected`, `aggregate_budget_exceeded`; 0 forwarded; no raw context exposed | Forwarded > 0, or raw context leak |
| 3 | Estimated usage provenance, incl. alongside an exact request receipt | "ordinary Pi usage is explicitly estimated provenance"; "missing usage is explicitly unavailable provenance"; "exact request counts and advisory Pi usage remain distinguishable"; "exact request counts stay verified when no advisory usage is present" | Provenance = `estimated` with Pi usage; `unavailable` with none; exact-only stays `verified` | `verified` coexisting with estimated usage, or missing provenance |
| 4 | Retained overflow after compaction with missing fresh usage | "missing usage cannot erase an observed overflow"; "a retained overflow observation is generation-bound across compaction" | Retained overflow stays blocking after compaction until a fresh valid reading; missing usage does not erase it | Overflow cleared by missing usage |
| 5 | Served-window/model change invalidates stale usage and reservations | "serving-window shrink creates a distinct accounting epoch"; "window switches preserve the goal/evidence identity while recalculating admission"; "bound observations reject stale serving epochs and compaction generations"; "reservation ledger is idempotent, shared, and epoch-scoped" | New epoch on window/model change; stale usage + reservations invalidated; identity preserved | Stale usage/reservations survive the change |
| 6 | Completion reserve + concurrent output reservations | "observed retained context reduces remaining output allowance"; "reservation ledger is idempotent, shared, and epoch-scoped"; "admission coordinator accounts producer reservations and releases them at tool finalization"; "allowance allocation cannot multiply the remaining budget" | Reserve + concurrent reservations reduce allowance once each; no double-spend; release at finalization | Allowance multiplied, double-spend, or un-released reservation |
| 7 | Failed compaction: bounded attempts, no automatic replay | "unsafe admission makes only one coordinated compaction attempt for an unchanged request"; "a corrected request cancels obsolete pending compaction" | Exactly one coordinated compaction attempt for an unchanged request; a corrected request cancels the pending one | Automatic replay, or > 1 attempt on the same unchanged request |
| 8 | Insufficient recovery: no empty/garbled injection, no false success | "zero, invalid and tiny budgets are explicitly unavailable or insufficient"; "a sub-one-character budget cannot return ok with an empty brief"; "missing required content is detected even when some text survives"; "small budgets do not regain the old floor"; "automatic caller reports failure and preserves pending on tiny budget"; "manual caller reports failure on tiny budget without sending" | `unavailable`/`insufficient`, never `ok` with empty/garbled brief; pending recovery preserved; failure status surfaced | `ok` with empty brief, false success, or dropped pending recovery |
| 9 | Pending compaction recovery survives settlement and later succeeds with a valid budget | "real lifecycle: compaction -> insufficient assembly -> settlement -> valid-budget retry injects"; "pending recovery later succeeds with a valid budget" | Pending recovery survives `agent_settled`; injects once a valid budget is available | Recovery lost at settlement, or no injection at valid budget |
| 10 | Manual delivery failure: honest failure receipt + actionable status | "a throwing sendMessage produces an honest failure receipt, not ok:true" | `delivery_failed` receipt, not `ok:true`; no delivery; bounded actionable status | `ok:true` on a throwing delivery, or silent failure |
| 11 | Flag-off compatibility | "flag-off returns the full combined brief unchanged"; "aggregate admission remains inactive until explicitly enabled" | Flag-off brief byte-identical to the full combined brief; admission inactive | Any flag-off divergence from the byte-compatible path |

These are **deterministic fault-injection cases**: the fault is injected by the
test (fake payload, forced budget, throwing channel), not produced by a model.
Missing exposure or missing receipts means **INCOMPLETE**, not PASS.

## Model-backed cases (live Pi against the served model)

Only the existing live runner supports the 2-cell probe (cases 1 and 2) for a
single served model. The model-backed arm runs that probe on the Ling arm, then
the matched Qwen arm. **The live arms for cases 3–11 are NOT ready**: they
require new collector/fixture/runner support (per-cell estimated-provenance,
stale-usage, reservation, compaction, recovery, and delivery-fault receipts),
which is **not implemented** and is listed below as a prerequisite. They must
not be described as ready to execute.

### Case 1 (model-backed) — Small normal request: admission + exactly one dispatch

- Setup / treatment exposure: private Pi overlay with the arm's manifest
  (`context-admission-ling-v1.json` / `context-admission-qwen-v3.json`),
  `CONTEXT_ADMISSION=on`, TELEMETRY on, `--no-session --no-tools`, the arm's
  model, and the local forwarding proxy. Normal cell = a short prompt.
- Required observable receipts: Pi exit 0; telemetry `context-admission/admitted`;
  proxy count of exactly **1** forwarded request.
- Expected result: one `admitted` receipt; exactly one dispatch.
- Failure / incomplete rule: forwarded ≠ 1, no admission receipt, or proxy
  count drift → FAIL. Missing receipt → INCOMPLETE.

### Case 2 (model-backed) — Oversized aggregate request: rejection before dispatch

- Setup / treatment exposure: same overlay; oversized private system prompt
  (`oversize_bytes` per manifest, conservatively ≥ 4× the declared window).
- Required observable receipts: telemetry `context-admission/rejected` with
  `aggregate_budget_exceeded`; proxy count of **0** forwarded requests.
- Expected result: rejection before dispatch; no forwarded request.
- Failure / incomplete rule: forwarded > 0 (a request reached the proxy), no
  reject receipt, or raw context exposure → FAIL. Missing receipt → INCOMPLETE.

### Cases 3–11 (model-backed) — NOT READY (prerequisite)

These safety/recovery mechanisms are qualified offline in the deterministic
table above. A live model-backed arm for each would additionally require, before
execution: a runner cell that (a) injects the specific fault (compaction
failure, stale served-window/model, concurrent reservation, insufficient
recovery budget, manual delivery throw), (b) captures the corresponding receipt
(provenance, stale-authorization, duplicate-recovery, delivery-failure), and
(c) asserts exactly-once dispatch. That collector/fixture/runner support does
not exist in `da3445b`. It is a **prerequisite**, not an executed arm. A model is
never relied on to create a particular fault on demand; the fault must be
injected by the runner.

## Decision rule

- Every required safety case **must pass**. A case that cannot be exposed with
  a receipt is **INCOMPLETE**, not PASS.
- **Unexpected dispatch, stale authorization, duplicate recovery, or false
  success** is a **failure** — the study stops and is not silently rerun.
- **No pooling** across source/model/serving boundaries. Ling and Qwen arms are
  separate; the deterministic offline arm is separate from the live arm. A
  changed source, model, or serving identity voids prior receipts.
- This qualifies **safety/mechanism only**, not task benefit or adoption. A
  passing receipt does not adopt `CONTEXT_ADMISSION` (it stays dark).
- A failed or incomplete study requires **diagnosis and a new
  preregistration**, never a silent rerun or reclassification of an earlier
  receipt.

## Missing execution prerequisites (not executed in this task)

- Ling arm: the served `ling3-tiny-fast` must be loaded on the single-slot
  router; the `--validate` launcher receipt must be green for that manifest.
  The manifest is new and its served-model binding must be re-derived at
  execution (do not trust a cited SHA without re-deriving).
- Matched Qwen arm: the served `qwen36-35b-iq3s` must be loaded; the V3 manifest
  binding must be re-derived at execution.
- Live arms for cases 3–11: collector/fixture/runner support for per-cell
  fault injection and receipts is **not implemented**; they are prerequisites,
  not ready-to-execute arms.
- No case in this study was run here. No inference, calibration, screen
  execution, mirror, rollout, or default change occurred.