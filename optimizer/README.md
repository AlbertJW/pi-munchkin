# Optimizer — mothballed

**Switched off by Albert on 2026-09-16.** The optimizer has not produced useful
results for his workflow. Its launchers refuse execution; no campaigns,
calibration, proposal loops or optimizer improvement work are active.

See [the current mothball decision](docs/MOTHBALLED_2026-09-16.md) and
[the disabled-entrypoint inventory](MOTHBALLED.json). Earlier restart charters
are historical and do not authorize revival. Restoration requires explicit
human instruction and a reviewed source change; there is no environment override.

Code and evidence remain archived. The offline `prompt-lab/config.py` validator
is retained for harness schema consumers. `npm run verify:optimizer` now checks
shutdown barriers, not the archived optimizer test battery.

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
