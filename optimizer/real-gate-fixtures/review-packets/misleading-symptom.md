# Fixture review: misleading-symptom

- Schema: `pi.fixture/v1`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

A user reported a bug in the ledger reporting tool.

Their ledger file contains lines that leave off the trailing fields, like:

    alpha|3
    beta|2|2
    gamma

Running buildReport (src/report.js) over that text prints NaN in the value
column and in the TOTAL row instead of numbers. Lines that spell out all three
fields render fine, which is why the existing test suite is green.

The data format, the per-field defaults, and the guarantee that consumers of
the parsed entries are allowed to rely on are all written down in
docs/data-contract.md. Read it, then compare it against both source files:
src/parse.js, which turns raw text into entry objects, and src/report.js,
which formats them.

Fix the code so that:

  * a line with omitted trailing fields produces exactly the same report as
    the equivalent line with those fields written out explicitly, and
  * both source files end up consistent with docs/data-contract.md — the
    guarantee that document makes to consumers has to actually hold, and the
    obligation it places on consumers has to be respected.

Do not change the report's layout, the exported function signatures, or the
tests in test/. Run `node --test` and make sure the suite passes.

## Hidden expectation sufficiency

- **parseEntries applies the documented per-field defaults to omitted trailing fields, never NaN.** — a line with omitted trailing fields produces exactly the same report as
    the equivalent line with those fields written out explicitly
- **Every parsed entry's amount and weight are finite numbers, so the guarantee to consumers holds.** — both source files end up consistent with docs/data-contract.md — the
    guarantee that document makes to consumers has to actually hold
- **buildReport renders a short line identically to the fully written equivalent, including the TOTAL row.** — a line with omitted trailing fields produces exactly the same report as
    the equivalent line with those fields written out explicitly

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

A user reported a bug in the ledger reporting tool.

Their ledger file contains lines that leave off the trailing fields, like:

    alpha|3
    beta|2|2
    gamma

Running buildReport (src/report.js) over that text prints NaN in the value
column and in the TOTAL row instead of numbers. Lines that spell out all three
fields render fine, which is why the existing test suite is green.

The data format, the per-field defaults, and the guarantee that consumers of
the parsed entries are allowed to rely on are all written down in
docs/data-contract.md. Read it, then compare it against both source files:
src/parse.js, which turns raw text into entry objects, and src/report.js,
which formats them.

Fix the code so that:

  * a line with omitted trailing fields produces exactly the same report as
    the equivalent line with those fields written out explicitly, and
  * both source files end up consistent with docs/data-contract.md — the
    guarantee that document makes to consumers has to actually hold, and the
    obligation it places on consumers has to be respected.

Do not change the report's layout, the exported function signatures, or the
tests in test/. Run `node --test` and make sure the suite passes.

### equivalent-2

Repository change request:
A user reported a bug in the ledger reporting tool.

Their ledger file contains lines that leave off the trailing fields, like:

    alpha|3
    beta|2|2
    gamma

Running buildReport (src/report.js) over that text prints NaN in the value
column and in the TOTAL row instead of numbers. Lines that spell out all three
fields render fine, which is why the existing test suite is green.

The data format, the per-field defaults, and the guarantee that consumers of
the parsed entries are allowed to rely on are all written down in
docs/data-contract.md. Read it, then compare it against both source files:
src/parse.js, which turns raw text into entry objects, and src/report.js,
which formats them.

Fix the code so that:

  * a line with omitted trailing fields produces exactly the same report as
    the equivalent line with those fields written out explicitly, and
  * both source files end up consistent with docs/data-contract.md — the
    guarantee that document makes to consumers has to actually hold, and the
    obligation it places on consumers has to be respected.

Do not change the report's layout, the exported function signatures, or the
tests in test/. Run `node --test` and make sure the suite passes.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

A user reported a bug in the ledger reporting tool.

Their ledger file contains lines that leave off the trailing fields, like:

    alpha|3
    beta|2|2
    gamma

Running buildReport (src/report.js) over that text prints NaN in the value
column and in the TOTAL row instead of numbers. Lines that spell out all three
fields render fine, which is why the existing test suite is green.

The data format, the per-field defaults, and the guarantee that consumers of
the parsed entries are allowed to rely on are all written down in
docs/data-contract.md. Read it, then compare it against both source files:
src/parse.js, which turns raw text into entry objects, and src/report.js,
which formats them.

Fix the code so that:

  * a line with omitted trailing fields produces exactly the same report as
    the equivalent line with those fields written out explicitly, and
  * both source files end up consistent with docs/data-contract.md — the
    guarantee that document makes to consumers has to actually hold, and the
    obligation it places on consumers has to be respected.

Do not change the report's layout, the exported function signatures, or the
tests in test/. Run `node --test` and make sure the suite passes.

## Automated admission

- Passed: `True`
- Checked: `2026-08-11T14:11:40Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
