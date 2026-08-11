# Fixture review: documented-escape

- Schema: `pi.fixture/v1`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `2026-11-09T20:44:51Z`

## Canonical prompt

The settlement report in src/report.js currently assumes every entry's amount is
written in our own plain decimal format, so it sends all of them through
parseAmount from src/money.js.

We are now also fed entries that came out of a partner's ledger export. Those
entries carry the field source: 'ledger', and their amount strings are written in
that export's accounting format rather than ours. Entries with no source field,
or with source: 'strict', are our own rows and must keep behaving exactly as they
do today.

Change buildReport in src/report.js so it handles both kinds of entry. It must
still return { lines, total } with the same line format as now and with total in
integer cents, and a ledger amount must contribute its correct signed value to
both the line and the total. An amount that cannot be read at all must still
raise an error rather than quietly counting as zero.

Two constraints on how you get there:

- The strict parser parseAmount in src/money.js must keep rejecting everything it
  rejects today. Its strictness is relied on elsewhere, so do not widen it, and
  do not route ledger amounts through it.
- The repository's docs/ directory describes the amount formats this codebase
  deals with and how each one is meant to be handled. Read it before you write
  the change; the accounting format has a convention that is easy to get subtly
  wrong.

The existing test suite in test/ must keep passing. Run the tests with
`node --test` when you are done.

## Hidden expectation sufficiency

- **Ledger-dialect amounts with separators and currency symbols are read correctly.** — that export's accounting format rather than ours
- **Parenthesised ledger amounts contribute a negative value to both the line and the total.** — a ledger amount must contribute its correct signed value to
- **A report mixing both dialects totals them together in integer cents.** — still return { lines, total } with the same line format as now and with total in
- **parseAmount is unchanged: strict entries still reject accounting formatting.** — or with source: 'strict', are our own rows and must keep behaving exactly as they
- **Unreadable ledger data raises rather than silently counting as zero.** — raise an error rather than quietly counting as zero

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

The settlement report in src/report.js currently assumes every entry's amount is
written in our own plain decimal format, so it sends all of them through
parseAmount from src/money.js.

We are now also fed entries that came out of a partner's ledger export. Those
entries carry the field source: 'ledger', and their amount strings are written in
that export's accounting format rather than ours. Entries with no source field,
or with source: 'strict', are our own rows and must keep behaving exactly as they
do today.

Change buildReport in src/report.js so it handles both kinds of entry. It must
still return { lines, total } with the same line format as now and with total in
integer cents, and a ledger amount must contribute its correct signed value to
both the line and the total. An amount that cannot be read at all must still
raise an error rather than quietly counting as zero.

Two constraints on how you get there:

- The strict parser parseAmount in src/money.js must keep rejecting everything it
  rejects today. Its strictness is relied on elsewhere, so do not widen it, and
  do not route ledger amounts through it.
- The repository's docs/ directory describes the amount formats this codebase
  deals with and how each one is meant to be handled. Read it before you write
  the change; the accounting format has a convention that is easy to get subtly
  wrong.

The existing test suite in test/ must keep passing. Run the tests with
`node --test` when you are done.

### equivalent-2

Repository change request:
The settlement report in src/report.js currently assumes every entry's amount is
written in our own plain decimal format, so it sends all of them through
parseAmount from src/money.js.

We are now also fed entries that came out of a partner's ledger export. Those
entries carry the field source: 'ledger', and their amount strings are written in
that export's accounting format rather than ours. Entries with no source field,
or with source: 'strict', are our own rows and must keep behaving exactly as they
do today.

Change buildReport in src/report.js so it handles both kinds of entry. It must
still return { lines, total } with the same line format as now and with total in
integer cents, and a ledger amount must contribute its correct signed value to
both the line and the total. An amount that cannot be read at all must still
raise an error rather than quietly counting as zero.

Two constraints on how you get there:

- The strict parser parseAmount in src/money.js must keep rejecting everything it
  rejects today. Its strictness is relied on elsewhere, so do not widen it, and
  do not route ledger amounts through it.
- The repository's docs/ directory describes the amount formats this codebase
  deals with and how each one is meant to be handled. Read it before you write
  the change; the accounting format has a convention that is easy to get subtly
  wrong.

The existing test suite in test/ must keep passing. Run the tests with
`node --test` when you are done.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

The settlement report in src/report.js currently assumes every entry's amount is
written in our own plain decimal format, so it sends all of them through
parseAmount from src/money.js.

We are now also fed entries that came out of a partner's ledger export. Those
entries carry the field source: 'ledger', and their amount strings are written in
that export's accounting format rather than ours. Entries with no source field,
or with source: 'strict', are our own rows and must keep behaving exactly as they
do today.

Change buildReport in src/report.js so it handles both kinds of entry. It must
still return { lines, total } with the same line format as now and with total in
integer cents, and a ledger amount must contribute its correct signed value to
both the line and the total. An amount that cannot be read at all must still
raise an error rather than quietly counting as zero.

Two constraints on how you get there:

- The strict parser parseAmount in src/money.js must keep rejecting everything it
  rejects today. Its strictness is relied on elsewhere, so do not widen it, and
  do not route ledger amounts through it.
- The repository's docs/ directory describes the amount formats this codebase
  deals with and how each one is meant to be handled. Read it before you write
  the change; the accounting format has a convention that is easy to get subtly
  wrong.

The existing test suite in test/ must keep passing. Run the tests with
`node --test` when you are done.

## Automated admission

- Passed: `True`
- Checked: `2026-08-11T14:11:47Z`

## Human decision

- Reviewer: `Albert Wessels (chat approval 2026-08-11)`
- Approved: `True`
