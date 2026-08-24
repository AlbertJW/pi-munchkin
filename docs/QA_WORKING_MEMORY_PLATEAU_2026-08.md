# Working-memory and plateau series — QA record

This bounded document records counterfactual regressions for the prepared, unmerged
series. It contains test names and commands only; no matched secret text, commands
from evaluated sessions, endpoints, private artifact paths, or raw model output.

## PR 1 — exact-gate frontier

- Counterfactual: changed the first recognized frontier from an advance to a
  non-advance, temporarily restoring the defect where productive progress has no
  baseline.
- Command: `node --experimental-strip-types --test --test-name-pattern='tracks productive advance' harness/tests/verification-frontier.test.ts`
- Expected failure observed: `tracks productive advance separately from a failed-gate plateau`.
- Restoration: the first internally consistent exact-gate TAP summary establishes
  the baseline and the targeted test passes.
- Full acceptance: `npm run verify` passed all five stages; the optimizer network
  seatbelt self-test required permission to bind a temporary loopback socket.

## PR 2 — semantic terminology

- Counterfactual: temporarily restored the tier-two claim that a failure persisted
  after a strategy change, even though the runtime observes only call arguments.
- Command: `node --experimental-strip-types --test --test-name-pattern='semantic tiers steer' harness/tests/loop-breaker.test.ts`
- Expected failure observed: `semantic tiers steer at two/four and abort silently at
  six with a private receipt` rejected the legacy message because it omitted the
  measured call-variant count and frontier state.
- Restoration: the correction reports only failure class, distinct call-variant
  count, frontier state, and a required next action. Recovery receipt v2 retains
  `call_variant_hashes` and no strategy claim.

## PR 3 — dark structured working memory

- Counterfactual: temporarily bypassed the dark-mode registration guard.
- Command: `node --experimental-strip-types --test --test-name-pattern='extension is absent by default' harness/tests/working-memory.test.ts`.
- Expected failure observed: `extension is absent by default and contributes no tool prompt surface`
  found the tool registered with the option unset.
- Target: `extension is absent by default and contributes no tool prompt surface`.
- Restoration requirement: unset `WORKING_MEMORY` registers no tool, command, or
  lifecycle handler and contributes zero prompt bytes.
- Full acceptance: `npm run verify` passed all five stages; deterministic package
  smoke loaded 31 extensions and two skills; peer boundaries and isolated packed
  consumers for Pi 0.80–0.84 passed.

## PR 4 — shadow plateau recovery

- Counterfactual: temporarily delayed the strict exposure threshold from the
  third paired unchanged epoch to the fourth.
- Command: `node --experimental-strip-types --test --test-name-pattern='three paired unchanged' harness/tests/verification-plateau.test.ts`.
- Expected failure observed: `three paired unchanged mutation/gate epochs expose
  one strict plateau` received no tier-three observation.
- Restoration: the third paired epoch emits one shadow observation; the fifth
  emits the activation tier without a second correction.
- Additional counterfactual: restored the 2 KiB prefix used by failure
  classification as the frontier parser's input.
- Command: `node --experimental-strip-types --test --test-name-pattern='bounded terminal suffix' harness/tests/verify-gate.test.ts`.
- Expected failure observed: `frontier reads the bounded terminal suffix rather
  than losing TAP behind long output` recognized zero gates.
- Restoration: the frontier reads a bounded 4 KiB suffix without joining full
  output; failure classification retains its independent bounded prefix.
- Full acceptance: `npm run verify` passed all five stages with 625 tests;
  deterministic package smoke loaded 31 extensions and two skills; peer
  boundaries and isolated packed consumers for Pi 0.80–0.84 passed.

## PR 5 — Mirror-mini fixture contract

- Counterfactual: temporarily disabled the v3 guard that prevents one hidden
  case from receiving credit under multiple weighted requirements.
- Command: `PYTHONDONTWRITEBYTECODE=1 python3 optimizer/prompt-lab/integrity_selftest.py`.
- Expected failure observed: `test_mirror_v3_fixture_contracts` reported
  `invalid v3 fixture contract accepted`.
- Restoration: hidden scored cases are disjoint; visible seed cases may anchor
  multiple requirements because they receive no hidden weighted credit.
- Targeted acceptance: both fixtures pass three-run pristine, gold, and two-mutant
  proofs. Cross-file shortcuts score 60/100, 30/100, and 15/100; partial-order
  shortcuts score 50/100, 30/100, and 30/100. The third shortcut in each fixture
  hardcodes the visible cases and is rejected by changed hidden duals. Oracle
  self-tests produce the same hash in all three
  runs, and the query, timeout, executable-root, and output bounds fail closed.
- Full acceptance: `npm run verify` passed all five stages with 625 harness tests;
  deterministic package smoke loaded 31 extensions and two skills. Peer-range
  boundaries passed, and isolated packed consumers for Pi 0.80, 0.81, 0.82,
  0.83, and 0.84 each typechecked and loaded all 31 extensions and both skills.
  The first sandboxed verifier attempt was blocked only from binding its temporary
  loopback self-test port; the approved offline rerun passed. No model or gate
  round was started.

## 2026-08-24 inspection release — inert shim retirement and context headroom

- Provider-shim counterfactual: temporarily restored a `PROVIDER_PATIENCE` reference in
  loadable subagent runtime code.
- Command: `node --experimental-strip-types --test --test-name-pattern='retired environment options have no loadable runtime reader' harness/tests/retired-surface.test.ts`.
- Failure observed: `retired environment options have no loadable runtime reader` named the
  restored runtime reference. Removing it makes the structural retirement test pass.
- Dense-read counterfactual: temporarily restored the normal unbounded-read threshold from
  32 KiB to 64 KiB.
- Command: `node --experimental-strip-types --test --test-name-pattern='large reads require bounded pages' harness/tests/context-inlet.test.ts`.
- Failure observed: `large reads require bounded pages before their contents enter context`
  allowed the fixed 40 KiB reproduction. Restoring 32 KiB blocks it while a 200-line page and
  small direct read remain available.
