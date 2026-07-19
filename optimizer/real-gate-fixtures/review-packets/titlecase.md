# Fixture review: titlecase

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

Fix titleCase(s) in src/index.js. It must capitalize the first letter of each word and
lowercase the rest of that word. Words are separated by SPACES ONLY — an apostrophe or a
hyphen does NOT start a new word. So "i don't know" -> "I Don't Know", "well-known fact" ->
"Well-known Fact", and "HELLO WORLD" -> "Hello World". The current code capitalizes the
letter after every non-letter character, which is wrong. Fix it without breaking the
existing visible tests. Run node --test until all tests pass.

## Hidden expectation sufficiency

- **apostrophe is not a word boundary** — Fix titleCase(s) in src/index.js. It must capitalize the first letter of each word and
lowercase the rest of that word. Words are separated by SPACES ONLY — an apostrophe or a
hyphen does NOT start a new word. So "i don't know" -> "I Don't Know", "well-known fact" ->
"Well-known Fact", and "HELLO WORLD" -> "Hello World". The current code capitalizes the
letter after every non-letter character, which is wrong. Fix it without breaking the
existing visible tests. Run node --test until all tests pass.
- **hyphen is not a word boundary** — Fix titleCase(s) in src/index.js. It must capitalize the first letter of each word and
lowercase the rest of that word. Words are separated by SPACES ONLY — an apostrophe or a
hyphen does NOT start a new word. So "i don't know" -> "I Don't Know", "well-known fact" ->
"Well-known Fact", and "HELLO WORLD" -> "Hello World". The current code capitalizes the
letter after every non-letter character, which is wrong. Fix it without breaking the
existing visible tests. Run node --test until all tests pass.
- **all-caps with apostrophe** — Fix titleCase(s) in src/index.js. It must capitalize the first letter of each word and
lowercase the rest of that word. Words are separated by SPACES ONLY — an apostrophe or a
hyphen does NOT start a new word. So "i don't know" -> "I Don't Know", "well-known fact" ->
"Well-known Fact", and "HELLO WORLD" -> "Hello World". The current code capitalizes the
letter after every non-letter character, which is wrong. Fix it without breaking the
existing visible tests. Run node --test until all tests pass.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Fix titleCase(s) in src/index.js. It must capitalize the first letter of each word and
lowercase the rest of that word. Words are separated by SPACES ONLY — an apostrophe or a
hyphen does NOT start a new word. So "i don't know" -> "I Don't Know", "well-known fact" ->
"Well-known Fact", and "HELLO WORLD" -> "Hello World". The current code capitalizes the
letter after every non-letter character, which is wrong. Fix it without breaking the
existing visible tests. Run node --test until all tests pass.

### equivalent-2

Repository change request:
Fix titleCase(s) in src/index.js. It must capitalize the first letter of each word and
lowercase the rest of that word. Words are separated by SPACES ONLY — an apostrophe or a
hyphen does NOT start a new word. So "i don't know" -> "I Don't Know", "well-known fact" ->
"Well-known Fact", and "HELLO WORLD" -> "Hello World". The current code capitalizes the
letter after every non-letter character, which is wrong. Fix it without breaking the
existing visible tests. Run node --test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Fix titleCase(s) in src/index.js. It must capitalize the first letter of each word and
lowercase the rest of that word. Words are separated by SPACES ONLY — an apostrophe or a
hyphen does NOT start a new word. So "i don't know" -> "I Don't Know", "well-known fact" ->
"Well-known Fact", and "HELLO WORLD" -> "Hello World". The current code capitalizes the
letter after every non-letter character, which is wrong. Fix it without breaking the
existing visible tests. Run node --test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-14T18:49:23Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
