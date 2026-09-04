# Measurement programme — history

Three charter documents in `archive/` each declare the programme's status, and all three are
out of date. This page is the arc they describe, so no one has to reconstruct it from
conflicting banners.

## The shape of it

**2026-06 — design research.** What would it take to make a small local model a competent
coding agent? Recorded in `archive/HARNESS_SELF_IMPROVEMENT_DESIGN_2026-06.md`.

**2026-07 — the candidate era.** Dozens of dark mechanisms (`c13`…`c50`), each behind an env
flag, each A/B'd against a local model. The methodology written here
([`MEASUREMENT_METHODOLOGY_2026-07.md`](MEASUREMENT_METHODOLOGY_2026-07.md)) is still the
governing document.

**2026-07-27 — the correction that reframed everything.** Most rounds had used n=3–9 per arm,
scored pass/fail, for interventions aimed at efficiency. 40 of 45 candidates could not be shown
to have fired at all. Every `NEUTRAL` verdict before this date became **UNTESTED**, not
rejected. The gate is a one-sided regression detector at those sample sizes: it finds harm and
essentially never finds help.

**2026-08-03 — first mothball.** The instrument could not demonstrate a win.
(`archive/MOTHBALLED_2026-08-03.md`)

**2026-08-15 — unmothball.** Rebuilt around graded outcomes, a per-trial validity rubric, and a
preregistered fixture-admission rule. (`archive/UNMOTHBALL_2026-08.md`)

**2026-08-21 — second mothball, for the opposite reason.** The instrument now worked; the
*subject* could not drive the harness. Ling3 scored 0/8 on `audit-sweep` with ~70% tool-call
failure. Stopping was the honest call. ([`MOTHBALLED_2026-08-21.md`](archive/MOTHBALLED_2026-08-21.md))

**2026-08-27 onward — the Qwen 35B cohort.** A subject that *can* drive the tools, which was the
stated restart condition. This is where the programme actually is; see
[`NEXT_STEP_MODEL_QUALIFICATION_2026-08.md`](archive/NEXT_STEP_MODEL_QUALIFICATION_2026-08.md) and the
per-screen record in [`SCREENS.md`](SCREENS.md) and the full run log in
[`ROUND_LEDGER.md`](ROUND_LEDGER.md).

## What carried through every restart

The rules did. They are the durable asset, not the results:

- A rule chosen after seeing the numbers is not a rule — hence preregistration.
- Never pool measurements across a surface-hash boundary.
- A mechanism firing is evidence the implementation works, never evidence it helps.
- A self-consistent artifact cannot self-validate; pin the expected shape outside it.
- Negative and voided results stay in the record exactly as written.

## Reading the mothball banners

Both mothball documents are retained because each records a genuine stop and its reasoning.
Neither describes the present. `MOTHBALLED_2026-08-21.md` states that no further rounds would
run; roughly thirty screens ran on 2026-09-01 through 2026-09-03 under the Qwen cohort. The
banner was never formally retracted — treat [`SCREENS.md`](SCREENS.md) as the authority on what
has actually been executed.
