# Run Kernel PR 7 QA ledger

Scope: adaptive planning is dark. `PLAN_MODE=forced` and current model-visible
behavior remain unchanged. No live mirror or adoption occurred.

## Regression coverage

- Stable-ID deltas preserve item membership, order, dependencies, and titles.
- Identical deltas are idempotent; conflicting duplicates, unknown IDs,
  malformed notes, and invalid failure classes reject.
- Gated completion through `plan_update` remains read-only-gate checked and
  receipt-backed.
- Adaptive new plans are private under the run-capsule namespace and leave no
  `.pi/plan-state.json` or `TODO.md` until `/plan-export` is explicitly called.
- Legacy project-local plan files remain loadable as read-only imports.
- `/plan-direct` refuses risky/oversized/multiline requests, accepts one
  bounded low-risk request, and does not create an engine-owned dispatcher.
- Direct mode clears at session/agent end; forced and off modes do not expose
  adaptive tools or commands.

## Counterfactual regression

The stable delta applicator was temporarily changed to return an empty update.
The focused adaptive integration then failed its `1 changed` assertion; the
implementation was restored and the focused tests passed. The temporary run
recorded no raw request, command, path, endpoint, or secret.

## Verification lanes

| Lane | Result |
|---|---|
| adaptive delta/mode/integration tests | green: 6/6 focused |
| canonical test runner | green: 501/501 |
| typecheck | green |
| health | green |
| deterministic package smoke | green: 131 files; 31 extension entry points and 2 skills |
| optimizer verification | green |
| Pi 0.80–0.83 packed consumers | green: each typechecked with 31 extensions and 2 skills loaded |
| peer boundaries | green: below-lower and at-upper rejected; lower and inside-upper accepted |
| isolated Pi 0.83 mirror/load | green: 108 first-party files match; local-only additions ignored |
| secret scan | pending final staged scan |
| protected paths | no `context-pressure*` path changed |

Source surface hash: `a4d5692f6065f977402cfb1d37ea275aa2140e911c16bbe9d99d3fd64c79a0a4`.
