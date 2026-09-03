# Optimizer — the measurement programme

This directory is the instrument, not the harness. It exists to answer one question honestly:
does a given harness change actually help a small local model, or does it only look like it
does?

## Where the programme actually is

The Qwen 35B cohort has been running screens since 2026-08-27; roughly thirty ran on
2026-09-01 through 2026-09-03. [`docs/SCREENS.md`](docs/SCREENS.md) is the authority on what has
been executed and what each run concluded.

Two mothball charters in `docs/archive/` and `docs/MOTHBALLED_2026-08-21.md` declare the
programme stopped. Both record genuine stops with sound reasoning, and neither describes the
present — the 2026-08-21 stop was conditional on finding "a subject that can drive the tools",
and the Qwen cohort is that subject. [`docs/PROGRAMME_HISTORY.md`](docs/PROGRAMME_HISTORY.md)
tells the whole arc in one page.

**Nothing about that makes a round self-starting.** Restarting a gate round, adopting a
candidate, or deleting optimizer material still requires explicit human approval, every time.

## New campaigns

Use the dark, review-only [Optimizer V2](v2/README.md). The original scripts and results here
are frozen under [LEGACY.md](LEGACY.md): still readable and verifiable, but they cannot seed or
satisfy V2 evidence.

## The rules, which outlived every restart

[`docs/MEASUREMENT_METHODOLOGY_2026-07.md`](docs/MEASUREMENT_METHODOLOGY_2026-07.md) is still the
governing document, and [`docs/PREREG_FIXTURE_ADMISSION_2026-08.md`](docs/PREREG_FIXTURE_ADMISSION_2026-08.md)
is still the single admission rule.

The 2026-07-27 audit found that most rounds could not support their recorded interpretation:
sample sizes were too small, pass/fail did not measure the efficiency target, and most candidates
could not prove their mechanism fired at all. **Every pre-audit `NEUTRAL` remains recorded as
history but is currently UNTESTED, not rejected.** Pass/fail is a harm guard; a positive decision
needs continuous effort measures, exposure evidence, adequate power, an in-band task, and a
single model-visible surface.

[`docs/SECURITY_BOUNDARY.md`](docs/SECURITY_BOUNDARY.md) states what the grading guards do and
do not guarantee. Read it before citing any score.
