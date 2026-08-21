# The optimizer is mothballed again — 2026-08-21

> **Supersedes [`UNMOTHBALL_2026-08.md`](UNMOTHBALL_2026-08.md) operationally.** That charter's
> instrument work is DONE and its rules stand — `PREREG_FIXTURE_ADMISSION_2026-08.md` remains the
> one admission rule, and nothing in it is retracted. What stops is the *programme*: no further
> rounds, no candidate trials, no box time.

**Status: PARKED, and this time the instrument is not the problem.** `npm run verify` is green
(6 stages), the harness is live and mirrored, 24/24 fixtures are approved and authoritative, 38
carry an admitted case pin, and the graded path was validated end-to-end on a real run. It is
parked because the next real result costs more than it is worth, and this document says exactly
why so nobody re-derives it.

If you read one section, read **Why it stopped this time** — the reason is different from
2026-08-03's and inverts it.

---

## What changed since the 2026-08-15 restart

The restart's premise was that the instrument could not show a win, so the instrument was rebuilt.
It was, and three adversarial inspection rounds hardened it. The 2026-08-21 round closed the last
two forgeries and is written up in `SECURITY_BOUNDARY.md`:

- **C-1** — the admitted case pin was written to `<workdir>.row-context.json`, a sibling of the
  model's own workdir that `gate.sb` let the session read. Measured on the real `parens` fixture:
  honest 0/3 became a sealed, unblocked **3/3**. Closed by removing the secret from disk entirely
  (`eval_fixture.grading_secrets`), plus a second reporter recording where each graded test was
  registered.
- **C-2** — `score`, the field adoption reads, came from an un-jailed, un-preloaded `node --test`.
  The four-line `node:assert` neuter forged it: honest 3/6 became a gate-passing **6/6**. Closed by
  jailing every scoring run (`binary.sb` + the assertion preload + `env -i` + fd scrub).

Both were confirmed closed on a live run, not only in selftests (see below).

## Instrument validation — it works. This is the durable result.

The Phase-6 n=1 smoke ran on 2026-08-21 (`GEN=p6smoke`, `PI_MODEL=ling3-tiny-experimental`,
`--calibrate audit-sweep`) and **passed every criterion the charter declared in advance**:

| check | result |
|---|---|
| `row_contract.validate_powered_row` | PASS |
| `validate_powered_row(require_complete=True)` | **PASS** — the settlement-authority tightening, never previously exercised |
| `fleet_report.integrity_errors` | clean (only "cand: no rows", expected under `--calibrate`) |
| validity sidecar | built; `row_key` carries model/split/variant; `row_sha256` binds; workdir resolved; 0 voided |
| row | `pi.eval-row/v4`, authoritative, complete, sandboxed, serving stable, surface `3d361874…` |
| graded subscores | `0/8` via `.audit-grade.json`, `subscores_blocked=None` |

The charter had pre-declared that if the tightening voided the smoke, "that is a finding, not an
inconvenience". It did not void it.

**Three of the day's fixes confirmed in production, not in a selftest:** the gate-written
row-context carried none of the four grading secrets (C-1); `.audit-grade.json` was written by the
*jailed* binary run while every other workdir write stayed fenced (`binary.sb`'s one allow); and the
model's own `ls ~/.pi/agent/` probe returned **EPERM ×3** with zero references to the mirror
package (`gate.sb`'s read-deny, tested by a model that actually tried).

`results/` is gitignored, so the row itself will not survive a clean. Its facts, for the record:
`model=ling3-tiny-experimental task=audit-sweep run=1063a8 gate=0 graded=0/8 authoritative=True
surface=3d361874a806d595 turns=81 tool_calls=82 tool_errors=57`.

## Why it stopped this time

**2026-08-03 stopped because the instrument could not show a win. 2026-08-21 stops because the
subject cannot drive the harness — and that is not a measurement problem.**

Three data points, all from today, all on `ling3-tiny-experimental`:

| run | fixture | result | turns | tool errors |
|---|---|---|---|---|
| p6smoke | `audit-sweep` | gate 0, graded **0/8** | 81 | **57 / 82 (~70%)** |
| p7ling rep1 | `ling-cross-file-contract` | gate 0, graded **1/4** | 199 | **181 / 191 (~95%)** |
| p7ling rep2 | `ling-cross-file-contract` | gate 0, graded **1/4** | 164 | **148 / 166 (~89%)** |

Both `p7ling` rows were authoritative and graded cleanly — the instrument recorded them
faithfully. What it recorded is a model spending 199 turns to score 1/4 while ~95% of its tool
calls fail. Inspecting the `audit-sweep` session: 61 of 82 calls were `bash`, mutating through
`sed -i` and `cat >` rather than the `edit`/`write` tools.

A 7-fixture × n=6 round was launched against the fixtures authored for this tier and **stopped
after 2 rows**, because two rows had already answered the question the other forty would have
cost seven box-hours to restate. That is the whole reason for the park: the box time buys no
information at this error rate.

**This is pre-declared informative, not a failure.** The charter's exit says so for the flooring
case, and the same logic applies here.

## What must NOT be re-derived

- **Fixture admission is unchanged.** 24/24 approved and authoritative, 0 artifact drift, 38
  case-pinned. `qs-error-swallow` and `path-near-miss` were pinned on 2026-08-21 with their
  original review clocks preserved.
- **Never add a case pin via `build_fixture_catalog.build()`.** It regenerates the patches from an
  in-code generator that has drifted from the committed artifacts: measured, it writes a
  **zero-byte `gold.patch`** for `qs-error-swallow` and crashes on `path-near-miss`. Write
  `tests.fail_to_pass.expected_cases` surgically and re-approve with `--expires-at`.
- **`ling3` saturates the pre-reboot pool** (3/3, 3/3, 3/3, 0/3 — zero of four in band) and
  **floors the reboot pool** at the tool-error rates above. It is not a viable subject on either.
- **Judge calibration is blocked by the CORPUS, not the labeler.** All 12 `calib4b` sessions edit
  exactly one `src/` file and touch no test, so `scope_discipline` is constant and
  `MIN_DISTINCT_HUMAN_SCORES` refuses. Demonstrated with a *perfect* judge: exact 1.0, within-one
  1.0, kappa 1.0, `passed: false`. See `JUDGE_LABELING_2026-08.md`.
- **Two operational traps behind llama-swap.** `PI_MODEL` is both pi's model id and llama-swap's
  and they differ — the provider-qualified form 404s at warm-up (fails closed, no row). And
  `loaded_alias()` returns `data[0]`, first *alphabetically*, not the loaded model: **always set
  `PI_MODEL`** or every row is mislabelled.

## What would justify restarting

In order, and none of them is "run another round":

1. **A subject that can drive the harness.** The measured blocker is tool-call failure, not
   capability. Either a model tier that operates the tools, or harness work aimed squarely at the
   failure — note `tool-call-rescue` recorded **zero** steers across these sessions despite being
   built for exactly this class.
2. **A judge held-out set that spans the rubric**, so calibration can return something other than
   a refusal.
3. **The out-of-process verifier** named in `SECURITY_BOUNDARY.md`. Model code still shares the
   reporter's process; today's work raised the bar structurally but did not close that.

Everything else — code, fixtures, rules, tests — is preserved and green. Nothing here is broken.
