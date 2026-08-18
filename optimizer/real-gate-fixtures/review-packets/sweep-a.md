# Fixture review: sweep-a

- Schema: `pi.fixture/v2`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `2026-11-16T09:19:56Z`

## Canonical prompt

The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.

## Hidden expectation sufficiency

- **D1 money carries thousands separators** — The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.
- **D2 zero quantity renders the OUT marker** — The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.
- **D3 the currency rate comes from settings, not a restated constant** — The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.
- **D4 rows are sorted alphabetically by name** — The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.
- **D5 the handling fee is added after the discount, never discounted** — The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.
- **D6 TOTAL sums active items only** — The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.

### equivalent-2

Repository change request:
The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

The stock report module has drifted from its documented contract. Read
docs/FORMAT.md — it is authoritative — and bring src/report.js back in line
with it. Every convention in that document must hold: thousands separators in
money amounts, the OUT marker for zero quantities, the settings in
src/config.js as the single source of truth for every rate and fee (no module
may restate their values), alphabetical row order, the discount applied to the
goods value before the handling fee is added (the fee is never discounted), and
a TOTAL line that sums active items only. The visible tests must keep passing;
run them to check your work.

## Difficulty crux (author's pre-data claim)

- Mechanism: multi-defect documentation sweep: six independent, individually-findable drifts from docs/FORMAT.md spanning doc-lookup (separators, OUT marker), cross-file coupling (restated rate), collection blindness (sort), non-commuting charge order (discount before fee), and population selection (active-only TOTAL)
- Expected failure: fixes the doc-lookup defects the prompt telegraphs, misses the coupling/order/population defects the visible suite never exercises
- Band prediction: `[0.35, 0.65]`

## Automated admission

- Passed: `True`
- Checked: `2026-08-18T09:19:04Z`

## Human decision

- Reviewer: `albert`
- Approved: `True`
