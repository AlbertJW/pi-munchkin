# Preregistration: CONTEXT_ADMISSION safety/recovery qualification — Occamy revision 2

## Status and relationship to the original preregistration

**PREPARED — NOT EXECUTED.** This revision separately qualifies the current
candidate with Occamy. It does not alter or pool with
`PREREG_CONTEXT_ADMISSION_SAFETY_RECOVERY_2026-09-15.md`, whose Ling/Qwen arms
remain unexecuted. The eleven-case definitions and stop rules below inherit the
original preregistration's frozen safety cases; this revision changes the
source/model binding and makes the evidence split explicit: cases 1–2 are
model-backed transport checks, while cases 3–11 are deterministic injected
fault tests. No fault is elicited from the model.

`CONTEXT_ADMISSION` remains off by default. A passing screen authorizes only a
reviewed opt-in installation; it does not establish task benefit or default
adoption. The explicit user request to implement this revision authorizes its
screen and conditional rollout. The optimizer remains mothballed.

## Frozen candidate and model identity

- Study: `context-admission-safety-recovery-occamy-v2`
- Candidate commit: `8066257cc7a66d268c60f3f7419af5fdfca04218`
- Source surface SHA-256: `8a9e5e7d2989c17a74ea0393d90ae4a93bec17f177423af0525e77b3ef148c89`
- Model ID: `local-llamacpp/occamy`; served alias: `occamy`
- Artifact: `models/occamy-1.0.Q3_K_M.gguf`
- Artifact SHA-256: `e1c4179e1ae3b8545a6e8d7858009e499e1fa58136b2e4b0d08a1e620fbe7be5`
- Text-only serving profile: context 131,072; request output reserve 128;
  one backend. Use an isolated Occamy server on port 8098 if the normal router
  is unavailable; do not stop, reconfigure, or replace a router process.
- Cases 1–2 bind to the Occamy manifest and live probe; cases 3–11 bind to the
  deterministic screen manifest and exact test-source hashes below.

## Frozen screen assets

| Asset | SHA-256 |
| --- | --- |
| Occamy live manifest `harness/tests/fixtures/context-admission-occamy-v1.json` | `84d238b4caf1a5b46b524723f411a42a0398557a0d0606d5f226264d478140b7` |
| Live probe `harness/scripts/context-admission-live-probe.mjs` | `c1d482d6db5a1d6eb535fff94327664befc6435f1c344f76a294521fe885b4fa` |
| Deterministic manifest `harness/tests/fixtures/context-admission-safety-recovery-v2.json` | `6ed64ab0329d3c8c7916fc75091285ca8f129414377a55190f9c9d4360d363a1` |
| Deterministic runner `harness/scripts/context-admission-safety-recovery-screen.mjs` | `fa1c656cbcaa06600a418c584d42cead37f5cd536214fbbdb649e03fb3302de3` |
| Context accounting production/test source | `6862ab30fa1b0ccb278e750e26202336d82b1b7e923013ff58e9e828d75feefc` / `d909f1e4b63cb05ddce664ec8dcbce6a5164600830705c17c5e16a8b7aad3760` |
| Recovery capsule production/test source | `97a480d83c46fa1a9d43d8d3a6e849a98b8af636b1a0da2ce36099f10a7bb626` / `9b90997a36ab19df8c1d7593758427628d18da64444fc19bb6987c608766b0dd` |

Re-derive these hashes and the source surface immediately before execution. Any
changed candidate, manifest, runner, model artifact, or serving identity voids
this receipt and requires a new revision.

## Frozen execution and decision rules

1. **Cases 1–2, Occamy live transport:** run the existing isolated probe with
   `CONTEXT_ADMISSION=on`, `CONTEXT_HANDOFF=off`, and telemetry enabled. Case 1
   must have one admitted receipt and exactly one forwarded request. Case 2
   must have `aggregate_budget_exceeded`, zero forwarded requests, and no raw
   context exposure. Record the actual loaded alias, artifact hash, context,
   endpoint fingerprint, approval digest, Pi exit status, and proxy counts.
2. **Cases 3–11, deterministic fault injection:** run the exact test-name list
   in the frozen deterministic manifest one test at a time. Each receipt must
   report exactly one test, one pass, zero failures, zero skips, and bind the
   runner, manifest, production sources, and test sources. Persist only hashes,
   result counts, and case status; never persist test stdout/stderr.
3. **All-case acceptance:** cases 1–11 must pass. Missing exposure, missing
   receipt, timeout, or incomplete test count is `INCOMPLETE`, never `PASS`.
   Unexpected dispatch, stale authorization, duplicate recovery, false
   success, or raw-context disclosure is `FAIL` and stops the screen. No
   retries or pooling across sources, models, or serving configurations.
4. Run `npm run verify` on the frozen candidate and require all six stages.
   A failed or incomplete screen blocks installation. Keep results immutable;
   diagnosis or a changed candidate requires a new preregistration revision.

## Conditional live overlay and rollback

The current live package is Phase 3B-promoted and contains unrelated local
drift. The reviewed Phase 3A runtime overlay is limited to these source files:

- `harness/extensions/context-admission.ts`
- `harness/extensions/run-capsule.ts`
- `harness/lib/context-accounting.ts`
- `harness/lib/telemetry-catalog.ts`

Immediately before a passing promotion, copy the complete current live package
to a new private rollback directory and verify the copy against per-file hashes.
Install only the four reviewed files above; preserve the package manifest and
all nonselected files. Require selected hashes to match the frozen candidate
and every nonselected hash to match the pre-install receipt. Record the loaded
surface hash and run fresh Pi sessions with `CONTEXT_ADMISSION=off` and `on`.
The off session must preserve current behavior; the on session must load the
admission extension and pass one normal request plus one pre-dispatch reject.
Restore and verify the complete rollback package if any post-install check
fails. Do not change defaults, enable optimizer execution, or push.
