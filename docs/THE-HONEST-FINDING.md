# The honest finding

The hard part isn't the optimizer — it's finding a **(model, task) pair in the discriminating
band** (roughly 20–85% pass rate). Empirically:

- Capable models **saturate** bounded tasks (100% pass) → no headroom to optimize against.
- Tiny models are **bimodal** (0% / 100%) → no gradient either.
- You need a model that *sometimes* solves a task but not reliably. That pairing is the prerequisite
  for any measurable harness gain, and it's narrow.

`optimizer/prompt-lab/calibrate.py` exists to find that band per model before you spend GPU hours
optimizing.

The second honest finding, learned the hard way: **the instrument fails more often than the
hypothesis.** Every result above survived only because the gate distinguishes "the model failed
the task" from "the harness never measured anything": tasks that score a no-op as success,
sessions that never reached the model, a silently hot-swapped model, an orphaned sweep writing
rows into the next run's files. Each has a dedicated guard now (`t2-check` fail-to-pass grading,
connection-error abort, a degraded-model token tripwire, gate-process reaping) — budget as much
effort for instrument integrity as for candidates.

