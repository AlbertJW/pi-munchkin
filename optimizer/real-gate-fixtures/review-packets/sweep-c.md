# Fixture review: sweep-c

- Schema: `pi.fixture/v2`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.

## Hidden expectation sufficiency

- **D1 dependencies come before dependents** — The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.
- **D2 ready steps keep input order as the tie-break** — The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.
- **D3 an unknown dependency is rejected** — The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.
- **D4 a duplicate step name is rejected** — The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.
- **D5 a cycle is rejected and the input is not mutated** — The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.

### equivalent-2

Repository change request:
The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

The build planner in this project ignores step dependencies. Read docs/BUILD.md
— it is authoritative — and make `planBuild` honour it: dependencies ordered
before the steps that need them, input order as the tie-break among ready
steps, and a thrown error on an unknown dependency, a duplicate step name, or a
cycle, without mutating the input. Follow the import in src/index.js to the
module that is actually wired up (there are two similarly named files; only one
matters). The visible tests must keep passing.

## Difficulty crux (author's pre-data claim)

- Mechanism: partial-order construction + path-evidence target selection: build a topological planner (deps-first, input-order tie-break, reject unknown-dep/duplicate/cycle, non-mutating) in the file src/index.js actually imports, not the similarly-named decoy
- Expected failure: edits the camelCase decoy src/steps/planBuild.js and/or keeps a comparator/input-order pass that cannot express a DAG
- Band prediction: `[0.1, 0.45]`

## Automated admission

- Passed: `True`
- Checked: `2026-08-14T12:51:41Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
