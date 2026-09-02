# Preregistration: Qwen 35B research-ledger Run 3 (2026-09-02)

## Status and scope

**PREPARED — no model session has run under this preregistration.** This is the
post-fix comparison of the legacy deep-research skill (arm A) and the verified
research-ledger pipeline (arm B). It is a dark-candidate study, not a gate
round, optimizer campaign, rollout, or adoption decision. A clean mechanism
result cannot by itself justify enabling `RESEARCH_LEDGER`.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`.
- Loaded Pi-agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
- Arm A: the pre-ledger skill text from commit `094c0cc`, with
  `RESEARCH_LEDGER` unset.
- Arm B: the current deep-research skill and ketch pipeline, with
  `RESEARCH_LEDGER=on`.
- Both arms use isolated temporary `PI_CODING_AGENT_DIR` and project
  directories, one fresh session per question, the same pinned model, and no
  saved session. The live mirror and source checkout are never mutated.

## Questions and sequence

Run the preregistered subset Q2, Q3, Q6, Q8, and Q9 from
`RESEARCH_EVAL_QUESTIONS_2026-08.md`, sequentially and in randomized arm order
per question. The model receives the same question and the same deep-research
invocation in each arm. Each session has a 15-minute wall bound; a timeout,
missing answer, mixed surface identity, raw-payload retention, or incomplete
telemetry is **INCOMPLETE**, never silently dropped.

For arm B, retain only safe counts and structural fields: searches, reads,
verified notes, corrected attributions, refusals by reason class, cache hits,
and the final `research/run-summary`. Keep the private ledger long enough to
check quote provenance, then remove it with the isolated run directory. Arm A
has no ledger and is not penalized for its absence in the synthesis score.

## Predeclared outcomes

The deterministic outcome is the ledger's fidelity signal. Report all six
reason classes (`ok`, `corrected`, `url_not_read`, `quote_not_found`,
`quote_ambiguous`, and write/degradation failures), plus whether each recorded
note's quote is present in the source page and whether corrected notes carry a
true source attribution. A refusal storm, zero-note answer, or wrap-up steer is
reported as observed behavior, not hidden as a run failure.

The synthesis outcome is a blinded pairwise judgment using the fixed rubric in
`RESEARCH_EVAL_QUESTIONS_2026-08.md`: correctness, directness, attribution
honesty, and conflict handling. Do not score ledger presence, note numbers, or
tool-call counts a second time. The default verdict is `tie`; a non-tie needs a
one-sentence difference grounded in both answers. If no independent frontier
judge is available, record the deterministic half and label synthesis
judgment **UNAVAILABLE** rather than substituting the authoring model.

## Stop, quarantine, and interpretation rules

Stop the run if the router or ketch backend is unavailable, if any session
leaks raw prompt/response/tool/source payloads into the report, or if any row
fails its loaded-surface/session binding. Do not pool these sessions with Run 1,
Run 2, the 4B Run 3, any earlier source hash, or any other model epoch.

The adoption rule remains unchanged: `RESEARCH_LEDGER` stays dark unless the
post-fix run shows no answer collapse, a materially lower refusal burden, and
no unacceptable synthesis regression under an independent judge. This study
does not authorize changing defaults or mirroring.
