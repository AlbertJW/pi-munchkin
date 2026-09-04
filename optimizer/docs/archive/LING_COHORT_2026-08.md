# Ling cohort design doc (2026-08)

**Status: DESIGN RECORD, written 2026-08-15 for the four `ling-*` fixtures generated
on 2026-08-13 without one.** Template: `BAND_FIXTURES_2026-08-11.md` (trap /
findability / visible-suite blindness / shortcut sharpness), extended with the
`pi.fixture/v2` fields (`difficulty_crux`, `episode_variance`, `band_prediction`).
Band predictions are the authors' pre-data claims — the point of writing them down
before calibration is that being wrong is informative
(`PREREG_FIXTURE_ADMISSION_2026-08.md` governs actual admission).

These four fixtures differ from the 2026-08-11 band cohort by design: the band cohort
set **semantic-subtlety traps in a single file**; this cohort sets **process and
structure traps** — run the right gate, coordinate the right set of files, pick the
right one of two similar files, produce the right algorithm class. They are generated
(`build_fixture_catalog.py`), so gold/shortcut are reproducible from source.

**Repair note (2026-08-15):** two hidden suites originally asserted on source text /
import paths. Under the behaviour-only rule (charter flag 7) those assertions were
replaced with behavioural equivalents; the sections below describe the repaired form.

---

## ling-exact-gate-recovery

- **Trap.** `package.json`'s test script is `node --test test/visible.test.js &&
  node scripts/project-gate.mjs`. A bare `node --test` (the habitual verify) passes
  while the project's own gate fails. The required change (urgency-ranked greedy
  allocation with a draining remainder) is only fully exercised by the gate script.
- **Findability.** The prompt states a bare `node --test` is insufficient; the gate
  script is named in `package.json` — one file read away. The chain: read
  `package.json` → notice the compound test script → run it → read the failure.
- **Visible-suite blindness.** `test/visible.test.js` exercises only the
  cap-at-full-pool behaviour; the draining remainder and ranking order are gate-only.
- **Shortcut sharpness.** The generated shortcut mutant special-cases the gate's
  sample inputs; it passes visible, fails the gate's property checks.
- **difficulty_crux.** mechanism: *exact-gate discovery and recovery* — does the model
  find and satisfy the project's declared verification rather than its habitual one?
  expected_failure: model runs bare `node --test`, sees green, claims done.
  band_prediction (4B): **0.30–0.50**.
- **episode_variance.** expected: **true** — gate failures after the first edit should
  open `verification_assertion` episodes; recovery variance is the loop cohort's food.

## ling-cross-file-contract

- **Trap.** Adding the `blocked` status requires two coordinated edits: extend
  `STATUS_ORDER` in `src/policy.js` (the declared single source of truth) AND remove
  the duplicated hand-written vocabulary in `src/parse-job.js` so the parser derives
  from `STATUS_ORDER`. Editing only `policy.js` leaves the parser rejecting `blocked`.
- **Findability.** The duplication is visible by reading both files; the prompt names
  the single-source-of-truth requirement. Chain: read prompt → grep the status
  vocabulary → find both definitions.
- **Visible-suite blindness.** Visible tests never feed `blocked` through the parser,
  so the uncoordinated single-file edit stays green.
- **Shortcut sharpness.** Mutant adds `blocked` to BOTH lists independently (keeping
  the duplication) — passes naive behaviour checks, defeats the coupling.
- **Repair (behaviour-only).** The old hidden assertion `assert.match(source,
  /STATUS_ORDER/)` + forbidden-`new Set(['queued...` regex is replaced by a
  behavioural coupling test: mutate the exported `STATUS_ORDER` at runtime (append a
  novel status) and assert the parser accepts it — a private duplicate list diverges
  observably; no source text is read.
- **difficulty_crux.** mechanism: *cross-file contract coordination* — one semantic
  change, two files, one source of truth. expected_failure: single-file edit,
  visible-green, done-claim. band_prediction (4B): **0.20–0.40**.
- **episode_variance.** expected: false — failures here are silent (green visible
  suite), not episodic. Not loop-cohort food; capability instrument.

## ling-partial-order-release

- **Trap.** `scheduleJobs` is a plain urgency sort; the requirement (dependencies
  honoured, urgency-then-input-order tie-break, reject duplicates/unknown deps/cycles,
  non-mutating) needs a topological scheduler. A comparator cannot express a DAG — the
  fix demands an algorithm-class change, not a tweak.
- **Findability.** The dependency requirement is stated in the prompt; the rejection
  cases are enumerated. Nothing is hidden — the difficulty is genuinely constructive.
- **Visible-suite blindness.** Visible tests use dependency-free inputs, so the
  urgency sort stays green.
- **Shortcut sharpness.** Mutant hard-codes the sample DAG's expected order — passes
  visible, fails the hidden property set.
- **difficulty_crux.** mechanism: *algorithm-class upgrade under a partial order* —
  the `ordered-steps` crux class, which floored 0/6 at both tiers. expected_failure:
  keeps the comparator, adds patches around it. band_prediction (4B): **0.05–0.25
  full-pass — but the graded suite (4 hidden tests: ordering, duplicate-reject,
  unknown-dep/cycle-reject, non-mutation) is expected to land graded_rate in band via
  partial credit**: the rejection guards are writable without the topological insight.
  This fixture is the cohort's test of whether graded outcomes rescue the floor class.
- **episode_variance.** expected: **true** — repeated hidden-style failures during
  self-checks and non-mutation violations should open episodes.

## ling-path-evidence

- **Trap.** The bug lives in the *exported* `src/tickets/normalize-ticket.js`; a
  decoy `src/normalise-ticket.js` (British spelling) sits beside it, plausibly named
  and similar in shape. Editing the decoy is a no-op on behaviour.
- **Findability.** `src/index.js` shows the export path; the decoy's header comment
  states the export does not use it. Chain: follow the import from the entry point —
  path evidence over name similarity.
- **Visible-suite blindness.** Visible tests import through the public entry point but
  don't hit the buggy branch, so a decoy edit changes nothing and stays green.
- **Shortcut sharpness.** Mutant fixes the decoy and adds a partial patch at the
  export that satisfies only the visible inputs.
- **Repair (behaviour-only).** The old hidden assertion
  `assert.match(index, /tickets\/normalize-ticket\.js/)` is removed; the hidden suite
  drives the trap inputs through the public entry point, which a decoy-only edit
  fails behaviourally. (Its coverage was already behavioural; the regex added only a
  shape check.)
- **difficulty_crux.** mechanism: *evidence-based target identification* — resolve
  which of two similar files is load-bearing by following imports, not names.
  expected_failure: edits the decoy, claims done. band_prediction (4B): **0.40–0.60**.
- **episode_variance.** expected: false — the failure mode is a silent wrong-target
  edit. Capability instrument.

---

## Cohort summary

| fixture | crux class | band_prediction (4B) | loop-cohort eligible (E1 expected) |
|---|---|---|---|
| ling-exact-gate-recovery | exact-gate recovery | 0.30–0.50 | yes |
| ling-cross-file-contract | cross-file contract | 0.20–0.40 | no |
| ling-partial-order-release | algorithm-class / partial order | 0.05–0.25 full-pass; graded in band via partial credit | yes |
| ling-path-evidence | path evidence vs decoy | 0.40–0.60 | no |

Verification: all four pass `fixture_admission.py verify` (6 proof cells × 3 runs)
in their repaired form; approval remains Albert's checkpoint. Calibration under
`PREREG_FIXTURE_ADMISSION_2026-08.md` grades these predictions.
