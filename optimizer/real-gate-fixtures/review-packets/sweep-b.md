# Fixture review: sweep-b

- Schema: `pi.fixture/v2`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `2026-11-16T09:19:56Z`

## Canonical prompt

The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.

## Hidden expectation sufficiency

- **D1 blank lines are skipped, real malformed lines still throw** — The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.
- **D2 EXP is an accepted category** — The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.
- **D3 zero-amount records are kept and flagged** — The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.
- **D4 average excludes EXP records from the denominator** — The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.
- **D5 categories are in first-seen feed order, not alphabetical** — The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.

### equivalent-2

Repository change request:
The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

The feed pipeline in src/pipeline.js has drifted from its documented contract.
Read docs/PIPELINE.md — it is authoritative — and bring the pipeline back in
line with every invariant it states: blank lines skipped while genuinely
malformed lines still throw, the EXP category accepted, zero-amount records
kept and flagged, the average computed over non-EXP records only, and
categories listed in first-seen feed order. The project has its own gate: run
`npm test` (not a bare `node --test`) — it runs the unit tests and a pipeline
gate that names any invariant you have not yet satisfied. Iterate against it
until it is green.

## Difficulty crux (author's pre-data claim)

- Mechanism: iterative pipeline recovery against a project gate: five documented invariants (blank/malformed handling, EXP category, zero-kept-and-flagged, non-EXP average denominator, first-seen category order) surfaced only by running `npm test` (unit tests + scripts/pipeline-gate.mjs), not a bare `node --test`
- Expected failure: runs bare `node --test`, sees the visible suite green, never discovers or iterates against the project gate
- Band prediction: `[0.3, 0.6]`

## Automated admission

- Passed: `True`
- Checked: `2026-08-18T09:19:07Z`

## Human decision

- Reviewer: `albert`
- Approved: `True`
