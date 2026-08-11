# Fixture review: second-test-guard

- Schema: `pi.fixture/v1`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

This repository renders fixed-width plain-text tables. The code lives in
src/table.js and the existing test suite lives in test/visible.test.js.

Right now, when a value is too long for its column, fitCell() silently chops
off the end of it. A reader cannot tell whether they are looking at a complete
value or a value that lost its tail: "engineering" in a six-character column
comes out as "engine", which looks like a real word.

Change fitCell() in src/table.js so that a value which does not fit is marked
as truncated with a trailing ellipsis character "…" (U+2026, a single
character — not three periods). Requirements:

- A value is only truncated when it is longer than the column width. A value
  whose length is exactly the column width must be returned unchanged, with no
  ellipsis.
- The ellipsis is part of the column, not an addition to it. A truncated cell
  must still be exactly `width` characters long, exactly like a padded one, so
  that columns produced by formatRow() stay aligned.
- Values shorter than the width keep their current behaviour: padded on the
  right with spaces.

Do not change the signature of fitCell() or formatRow(), and do not change
test/visible.test.js.

Run the test suite with `node --test` and make sure the whole suite passes
before you finish.

## Hidden expectation sufficiency

- **A value longer than the column is truncated with a single U+2026 character.** — as truncated with a trailing ellipsis character
- **A truncated cell is still exactly `width` characters — the ellipsis comes out of the column's own budget.** — The ellipsis is part of the column, not an addition to it. A truncated cell
- **A value whose length equals the width is returned unchanged, with no ellipsis.** — whose length is exactly the column width must be returned unchanged, with no

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

This repository renders fixed-width plain-text tables. The code lives in
src/table.js and the existing test suite lives in test/visible.test.js.

Right now, when a value is too long for its column, fitCell() silently chops
off the end of it. A reader cannot tell whether they are looking at a complete
value or a value that lost its tail: "engineering" in a six-character column
comes out as "engine", which looks like a real word.

Change fitCell() in src/table.js so that a value which does not fit is marked
as truncated with a trailing ellipsis character "…" (U+2026, a single
character — not three periods). Requirements:

- A value is only truncated when it is longer than the column width. A value
  whose length is exactly the column width must be returned unchanged, with no
  ellipsis.
- The ellipsis is part of the column, not an addition to it. A truncated cell
  must still be exactly `width` characters long, exactly like a padded one, so
  that columns produced by formatRow() stay aligned.
- Values shorter than the width keep their current behaviour: padded on the
  right with spaces.

Do not change the signature of fitCell() or formatRow(), and do not change
test/visible.test.js.

Run the test suite with `node --test` and make sure the whole suite passes
before you finish.

### equivalent-2

Repository change request:
This repository renders fixed-width plain-text tables. The code lives in
src/table.js and the existing test suite lives in test/visible.test.js.

Right now, when a value is too long for its column, fitCell() silently chops
off the end of it. A reader cannot tell whether they are looking at a complete
value or a value that lost its tail: "engineering" in a six-character column
comes out as "engine", which looks like a real word.

Change fitCell() in src/table.js so that a value which does not fit is marked
as truncated with a trailing ellipsis character "…" (U+2026, a single
character — not three periods). Requirements:

- A value is only truncated when it is longer than the column width. A value
  whose length is exactly the column width must be returned unchanged, with no
  ellipsis.
- The ellipsis is part of the column, not an addition to it. A truncated cell
  must still be exactly `width` characters long, exactly like a padded one, so
  that columns produced by formatRow() stay aligned.
- Values shorter than the width keep their current behaviour: padded on the
  right with spaces.

Do not change the signature of fitCell() or formatRow(), and do not change
test/visible.test.js.

Run the test suite with `node --test` and make sure the whole suite passes
before you finish.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

This repository renders fixed-width plain-text tables. The code lives in
src/table.js and the existing test suite lives in test/visible.test.js.

Right now, when a value is too long for its column, fitCell() silently chops
off the end of it. A reader cannot tell whether they are looking at a complete
value or a value that lost its tail: "engineering" in a six-character column
comes out as "engine", which looks like a real word.

Change fitCell() in src/table.js so that a value which does not fit is marked
as truncated with a trailing ellipsis character "…" (U+2026, a single
character — not three periods). Requirements:

- A value is only truncated when it is longer than the column width. A value
  whose length is exactly the column width must be returned unchanged, with no
  ellipsis.
- The ellipsis is part of the column, not an addition to it. A truncated cell
  must still be exactly `width` characters long, exactly like a padded one, so
  that columns produced by formatRow() stay aligned.
- Values shorter than the width keep their current behaviour: padded on the
  right with spaces.

Do not change the signature of fitCell() or formatRow(), and do not change
test/visible.test.js.

Run the test suite with `node --test` and make sure the whole suite passes
before you finish.

## Automated admission

- Passed: `True`
- Checked: `2026-08-11T14:11:45Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
