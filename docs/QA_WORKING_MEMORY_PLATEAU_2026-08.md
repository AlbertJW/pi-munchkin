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
