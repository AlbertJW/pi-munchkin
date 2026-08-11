# Fixture review: ordered-steps

- Schema: `pi.fixture/v1`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

The community site publishes a member roster built by `buildRoster` in
src/roster.js. Right now that function normalises and masks each member's email
address and passes their display name through, but it has no fallback when a
member left the display name blank on the signup form: those rows go out with an
empty name, which the site will not accept.

Change src/roster.js so that no published row ever has a blank name. When an
entry supplies no name at all, or supplies one that is only whitespace, the
display name must instead be derived from the local part of the address that
member signed up with: split that local part on `.`, `_` and `-`, capitalise
each piece, and join the pieces with single spaces. For example a member who
signed up as `grace_hopper@example.com` and typed no name must be published as
`Grace Hopper`, and one who signed up as `Jean-Bartik@Example.com` must be
published as `Jean Bartik`.

Everything already true of a published row must stay true: the row still has
exactly the fields `id`, `email` and `name`; the email is still trimmed,
lower-cased and masked the same way; a name the member actually typed is still
used (trimmed) rather than replaced by a derived one; and the input entries are
not mutated. docs/roster.md describes the row format in full — read it before
you start.

The existing test suite in test/visible.test.js is a regression guard. Run the
tests with `npm test` (which runs `node --test`) and make sure they all pass
when you are done.

## Hidden expectation sufficiency

- **A row with no name gets a display name derived from the local part of the signup address.** — display name must instead be derived from the local part of the address that
- **A whitespace-only name is treated as no name.** — entry supplies no name at all, or supplies one that is only whitespace
- **All three separators split, and each piece is capitalised and joined with single spaces.** — each piece, and join the pieces with single spaces
- **Supplied names are still used (trimmed); email masking is unchanged; inputs are not mutated.** — used (trimmed) rather than replaced by a derived one

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

The community site publishes a member roster built by `buildRoster` in
src/roster.js. Right now that function normalises and masks each member's email
address and passes their display name through, but it has no fallback when a
member left the display name blank on the signup form: those rows go out with an
empty name, which the site will not accept.

Change src/roster.js so that no published row ever has a blank name. When an
entry supplies no name at all, or supplies one that is only whitespace, the
display name must instead be derived from the local part of the address that
member signed up with: split that local part on `.`, `_` and `-`, capitalise
each piece, and join the pieces with single spaces. For example a member who
signed up as `grace_hopper@example.com` and typed no name must be published as
`Grace Hopper`, and one who signed up as `Jean-Bartik@Example.com` must be
published as `Jean Bartik`.

Everything already true of a published row must stay true: the row still has
exactly the fields `id`, `email` and `name`; the email is still trimmed,
lower-cased and masked the same way; a name the member actually typed is still
used (trimmed) rather than replaced by a derived one; and the input entries are
not mutated. docs/roster.md describes the row format in full — read it before
you start.

The existing test suite in test/visible.test.js is a regression guard. Run the
tests with `npm test` (which runs `node --test`) and make sure they all pass
when you are done.

### equivalent-2

Repository change request:
The community site publishes a member roster built by `buildRoster` in
src/roster.js. Right now that function normalises and masks each member's email
address and passes their display name through, but it has no fallback when a
member left the display name blank on the signup form: those rows go out with an
empty name, which the site will not accept.

Change src/roster.js so that no published row ever has a blank name. When an
entry supplies no name at all, or supplies one that is only whitespace, the
display name must instead be derived from the local part of the address that
member signed up with: split that local part on `.`, `_` and `-`, capitalise
each piece, and join the pieces with single spaces. For example a member who
signed up as `grace_hopper@example.com` and typed no name must be published as
`Grace Hopper`, and one who signed up as `Jean-Bartik@Example.com` must be
published as `Jean Bartik`.

Everything already true of a published row must stay true: the row still has
exactly the fields `id`, `email` and `name`; the email is still trimmed,
lower-cased and masked the same way; a name the member actually typed is still
used (trimmed) rather than replaced by a derived one; and the input entries are
not mutated. docs/roster.md describes the row format in full — read it before
you start.

The existing test suite in test/visible.test.js is a regression guard. Run the
tests with `npm test` (which runs `node --test`) and make sure they all pass
when you are done.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

The community site publishes a member roster built by `buildRoster` in
src/roster.js. Right now that function normalises and masks each member's email
address and passes their display name through, but it has no fallback when a
member left the display name blank on the signup form: those rows go out with an
empty name, which the site will not accept.

Change src/roster.js so that no published row ever has a blank name. When an
entry supplies no name at all, or supplies one that is only whitespace, the
display name must instead be derived from the local part of the address that
member signed up with: split that local part on `.`, `_` and `-`, capitalise
each piece, and join the pieces with single spaces. For example a member who
signed up as `grace_hopper@example.com` and typed no name must be published as
`Grace Hopper`, and one who signed up as `Jean-Bartik@Example.com` must be
published as `Jean Bartik`.

Everything already true of a published row must stay true: the row still has
exactly the fields `id`, `email` and `name`; the email is still trimmed,
lower-cased and masked the same way; a name the member actually typed is still
used (trimmed) rather than replaced by a derived one; and the input entries are
not mutated. docs/roster.md describes the row format in full — read it before
you start.

The existing test suite in test/visible.test.js is a regression guard. Run the
tests with `npm test` (which runs `node --test`) and make sure they all pass
when you are done.

## Automated admission

- Passed: `True`
- Checked: `2026-08-11T14:11:42Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
