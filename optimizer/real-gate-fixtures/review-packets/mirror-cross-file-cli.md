# Fixture review: mirror-cross-file-cli

- Schema: `pi.fixture/v3`
- Cohort: `2026-08-mirror-mini`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.

## Hidden expectation sufficiency

- **dual:vocabulary follows a later policy extension** — Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.
- **dual:vocabulary follows a later policy removal** — Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.
- **dual:transitions insert blocked at the declared boundary** — Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.
- **dual:transitions reject skipped blocked edges** — Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.
- **dual:validation trims and normalizes CLI input** — Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.
- **dual:validation rejects malformed and unknown CLI input** — Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.

### equivalent-2

Repository change request:
Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Add a `blocked` status between `queued` and `running`. Keep `STATUS_ORDER` in `src/policy.js` as the single source of truth: parsing must accept exactly the statuses currently present there, including later runtime extensions or removals. Preserve trimming, lower-casing, malformed-input rejection, JSON CLI output, and adjacent-only transitions. Run `npm test` when the coordinated change is complete.

## Difficulty crux (author's pre-data claim)

- Mechanism: cross-file semantic ownership observed through a CLI: parsing follows the live canonical policy rather than a copied vocabulary
- Expected failure: adds blocked to two independent lists or only to the parser, passing visible legacy cases while breaking policy coupling
- Band prediction: `[0.2, 0.8]`

## Weighted behavioural contract

- `canonical-vocabulary` (40%): parsing follows runtime changes to the policy vocabulary
- `transition-order` (30%): blocked participates in adjacent-only transitions
- `cli-validation` (30%): the CLI preserves normalization and rejects malformed input

## Visible/hidden duals

- `canonical-vocabulary`: `visible: normalizes an existing status through the CLI` → `dual:vocabulary follows a later policy extension`, `dual:vocabulary follows a later policy removal`
- `transition-order`: `visible: preserves adjacent transition behavior` → `dual:transitions insert blocked at the declared boundary`, `dual:transitions reject skipped blocked edges`
- `cli-validation`: `visible: normalizes an existing status through the CLI` → `dual:validation trims and normalizes CLI input`, `dual:validation rejects malformed and unknown CLI input`

## Oracle boundary

- Execute-only entry: `real-gate-fixtures/oracles/mirror-cross-file-cli.mjs`
- Budget: `32` queries; timeout `2000 ms`; output cap `4096 bytes`
- Source is admission-hashed but never staged, installed as an overlay, or included in one-shot context.
- Model snapshot boundary: Ling Tiny fleet snapshot predates this fixture generation

## Automated admission

- Passed: `True`
- Checked: `2026-08-17T16:14:54Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
