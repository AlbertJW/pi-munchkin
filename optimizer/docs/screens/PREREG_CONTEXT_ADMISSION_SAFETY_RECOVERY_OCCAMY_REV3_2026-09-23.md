# Preregistration: CONTEXT_ADMISSION safety/recovery qualification — Occamy revision 3

## Status and revision history

**PREPARED — NOT EXECUTED.** Revision 2 stopped after case 2 failed its frozen
reason-class assertion: the request was blocked before dispatch, but the
receipt reported `observed_budget_exceeded` instead of
`aggregate_budget_exceeded`. The aggregate payload was independently over its
window, so the observation-first classification hid the independently
sufficient aggregate guard. Candidate `632409d` fixes only that classification:
aggregate overflow remains explicit when both the request estimate and
advisory usage exceed capacity, while observation-only overflow retains
`observed_budget_exceeded`. A red/green regression covers both signals. No
revision-2 receipts are pooled into this screen.

This is a new, separately bound qualification. It inherits the original
preregistration's eleven case definitions and stop rules, but uses the current
candidate and Occamy. Cases 1–2 are model-backed transport checks; cases 3–11
are deterministic fault tests. The model is never asked to create faults.

`CONTEXT_ADMISSION` remains off by default. A pass supports only a reviewed
opt-in installation; it does not establish task benefit or default adoption.
The user's explicit implementation request authorizes this revised screen and
conditional rollout. The optimizer remains mothballed.

## Frozen candidate and Occamy identity

- Study: `context-admission-safety-recovery-occamy-v3`
- Candidate commit: `632409ddbc12085064f4953b1c1eaec73999ba91`
- Source surface SHA-256:
  `121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`
- Model: `local-llamacpp/occamy`; served alias: `occamy`
- Artifact: `models/occamy-1.0.Q3_K_M.gguf`; SHA-256:
  `e1c4179e1ae3b8545a6e8d7858009e499e1fa58136b2e4b0d08a1e620fbe7be5`
- Text-only profile: context 131,072; output reserve 128; one backend. Use an
  isolated Occamy endpoint on port 8098 if the normal router is unavailable;
  do not stop, reconfigure, or replace the router.
- The complete source and fixture binding below must be re-derived before
  execution. Any change voids this revision.

## Frozen screen assets

| Asset | SHA-256 |
| --- | --- |
| Occamy manifest `harness/tests/fixtures/context-admission-occamy-v1.json` | `84d238b4caf1a5b46b524723f411a42a0398557a0d0606d5f226264d478140b7` |
| Live probe `harness/scripts/context-admission-live-probe.mjs` | `c1d482d6db5a1d6eb535fff94327664befc6435f1c344f76a294521fe885b4fa` |
| Deterministic manifest `harness/tests/fixtures/context-admission-safety-recovery-v2.json` | `6ed64ab0329d3c8c7916fc75091285ca8f129414377a55190f9c9d4360d363a1` |
| Deterministic runner `harness/scripts/context-admission-safety-recovery-screen.mjs` | `fa1c656cbcaa06600a418c584d42cead37f5cd536214fbbdb649e03fb3302de3` |
| Context accounting implementation / tests | `30f7feeacefbf9956e57017b09f4633967a335f1c8749b77a66eb68eb6e292f7` / `fd1d47f552c366f2d8b942dc2edafa8d5582cc44bc02504302a1be6ca0af4d66` |
| Recovery capsule implementation / tests | `97a480d83c46fa1a9d43d8d3a6e849a98b8af636b1a0da2ce36099f10a7bb626` / `9b90997a36ab19df8c1d7593758427628d18da64444fc19bb6987c608766b0dd` |

## Execution and decision rules

1. **Cases 1–2, Occamy live:** run the isolated probe with
   `CONTEXT_ADMISSION=on`, `CONTEXT_HANDOFF=off`, and telemetry enabled. Case 1
   requires one `admitted` receipt and exactly one forwarded request. Case 2
   requires `rejected` / `aggregate_budget_exceeded`, zero forwarded requests,
   and no raw-context exposure. Bind the actual served alias, artifact hash,
   context, endpoint fingerprint, approval digest, process status, and proxy
   counts.
2. **Cases 3–11, deterministic fault injection:** run every exact test named
   by the frozen deterministic manifest individually. Each must report exactly
   one test, one pass, zero failures, and zero skips. Bind the runner,
   manifest, production sources, and test sources. Persist result counts and
   digests only; retain no test stdout/stderr.
3. All eleven cases must pass. Any missing receipt, timeout, or incomplete
   count is `INCOMPLETE`. Unexpected dispatch, stale authorization, duplicate
   recovery, false success, raw-context disclosure, or a reason-class mismatch
   is `FAIL` and stops this revision. Do not retry, pool, or reclassify results.
4. Run all six `npm run verify` stages against this candidate. Any failed or
   incomplete case blocks installation; diagnosis or changed source requires a
   new preregistration revision.

## Conditional live overlay and rollback

The existing Phase 3B live package has unrelated source/live drift. The Phase
3A runtime overlay is limited to:

- `harness/extensions/context-admission.ts`
- `harness/extensions/run-capsule.ts`
- `harness/lib/context-accounting.ts`
- `harness/lib/telemetry-catalog.ts`

Before installation, create a new private copy of the complete current live
package and verify it against per-file hashes. Install only those four files;
preserve the package manifest and every nonselected file. Verify selected
hashes against the frozen candidate and nonselected hashes against the
pre-install receipt. Record the loaded surface hash, then run fresh Pi sessions
with `CONTEXT_ADMISSION=off` and `on`. The off session must preserve current
behavior; the on session must pass one normal request and one pre-dispatch
rejection. Restore and verify the complete rollback copy if any installation
check fails. Do not change defaults, enable optimizer execution, or push.
