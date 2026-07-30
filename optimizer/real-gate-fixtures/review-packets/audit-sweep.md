# Fixture review: audit-sweep

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

This inventory service has accumulated defects. docs/audit-notes.md is the authoritative
specification of intended behavior -- where the code and that document disagree, the code is
wrong. Audit the ENTIRE codebase against the document, fix every defect you find, and record
each one in AUDIT.md (file, what was wrong, why the fix is correct). The existing tests pass
and must keep passing. Be thorough: a partial audit leaves defects in production. Run
node --test to confirm nothing regresses.

## Hidden expectation sufficiency

- **Every one of the 8 seeded divergences from docs/audit-notes.md is findable by comparing code to the doc (money-in-cents, per-category tax, discount-after-tax, qty>=1, fresh stock reads, no log mutation, full-date UTC grouping, full-page pagination).** — docs/audit-notes.md is the authoritative
specification of intended behavior -- where the code and that document disagree, the code is
wrong
- **Thoroughness is the graded dimension: the hidden grader scores per-defect (0-8, .audit-grade.json) so partial audits score partially; hardcoding is structurally impossible (behavioral checks).** — Audit the ENTIRE codebase against the document, fix every defect you find
- **The visible suite is pristine-green and must remain green (regression guard).** — The existing tests pass
and must keep passing

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

This inventory service has accumulated defects. docs/audit-notes.md is the authoritative
specification of intended behavior -- where the code and that document disagree, the code is
wrong. Audit the ENTIRE codebase against the document, fix every defect you find, and record
each one in AUDIT.md (file, what was wrong, why the fix is correct). The existing tests pass
and must keep passing. Be thorough: a partial audit leaves defects in production. Run
node --test to confirm nothing regresses.

### equivalent-2

Repository change request:
This inventory service has accumulated defects. docs/audit-notes.md is the authoritative
specification of intended behavior -- where the code and that document disagree, the code is
wrong. Audit the ENTIRE codebase against the document, fix every defect you find, and record
each one in AUDIT.md (file, what was wrong, why the fix is correct). The existing tests pass
and must keep passing. Be thorough: a partial audit leaves defects in production. Run
node --test to confirm nothing regresses.

Use the smallest correct changes and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

This inventory service has accumulated defects. docs/audit-notes.md is the authoritative
specification of intended behavior -- where the code and that document disagree, the code is
wrong. Audit the ENTIRE codebase against the document, fix every defect you find, and record
each one in AUDIT.md (file, what was wrong, why the fix is correct). The existing tests pass
and must keep passing. Be thorough: a partial audit leaves defects in production. Run
node --test to confirm nothing regresses.

## Automated admission

- Passed: `True`
- Checked: `2026-07-30T09:00:03Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
