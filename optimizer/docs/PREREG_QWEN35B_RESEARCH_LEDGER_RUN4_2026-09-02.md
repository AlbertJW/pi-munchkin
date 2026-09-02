# Preregistration: Qwen 35B research-ledger Run 4 (2026-09-02)

## Status and scope

**PREPARED — NO MODEL SESSIONS STARTED.** This is a fresh, judge-backed
comparison of the current deep-research skill with and without the research
ledger, after the non-graph 3-search/5-read wall was made explicit. It is a
dark-candidate value screen, not a gate round, optimizer campaign, rollout, or
adoption decision. The result cannot be pooled with Run 3 or any earlier
surface/model epoch.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source branch tip: `codex/qwen35b-provenance` at `54ac334`.
- Source surface SHA-256:
  `5b84241cbd47bdd61c1d4641166e6ec44f124ddac706778d5c477c3efac551bf`.
- Loaded Pi-agent surface SHA-256:
  `0c09cb637992c35176bd7ae4b0865850cb6a17bc2f1e5efaf4c06e59d2c1b4ef`.
- Arm A (control): current skill, `RESEARCH_LEDGER=off`.
- Arm B (treatment): current skill, `RESEARCH_LEDGER=on`, with the hard
  non-graph envelope enforced by `073eb21`.

Both arms use the same loaded surface, model, endpoint, project isolation,
prompt set, outer wall, and per-question research allowance. A changed source,
mirror, serving identity, model, or question hash starts a new preregistration.

## Questions and design

Use the already frozen questions Q2, Q3, Q4, Q6, and Q8 from
`RESEARCH_EVAL_QUESTIONS_2026-08.md`, spanning current-fact, contested,
comparative, and fast-moving research. Run one fresh A/B pair per question,
with randomized arm order and one session per arm. Each session has a 15-minute
wall, a private disposable agent/project directory, and a fresh session ID.

The comparison must hold the discovery allowance constant: at most three
search units and five distinct source-read units per arm/question. The runner
must stop or mark an arm incomplete when the allowance is exhausted; the
control may not use its lack of a ledger to obtain extra discovery. A timeout,
missing answer, budget overrun, identity drift, raw-payload retention, or
incomplete telemetry is `INCOMPLETE`, never silently dropped.

The paired judge is an independent configured endpoint, not the authoring
model. If no independent judge is available, retain deterministic ledger
fidelity receipts but report the synthesis half as `UNAVAILABLE`; do not
substitute a local authoring model or pool the result into adoption evidence.

## Predeclared outcomes

The primary outcome is blinded pairwise answer quality using the fixed rubric:
correctness, directness, attribution honesty, conflict handling, and explicit
uncertainty where the sources do not support a claim. The judge must not score
ledger presence, note counts, tool-call counts, or response length. A tie is
the default; a non-tie requires one concise reason grounded in both answers.

Deterministic secondary outcomes are recorded separately: answer completion,
search/read units consumed, verified notes, rejected note attempts by reason
class, corrected attributions, cache hits, evidence gaps, and bounded context
cost. Arm A has no ledger-note fields by design. The treatment must not receive
credit for a note that the parent cannot validate against a reread source.

## Acceptance and stop rules

This screen is informative only. For a later adoption proposal, B must be
non-inferior on the fixed answer-quality rubric, must not increase incomplete
answers by more than 20 percentage points, and must show lower unsupported or
unattributed material claims without exceeding the shared discovery envelope.
Any other result keeps `RESEARCH_LEDGER` dark and is reported as diagnosis or
insufficient evidence, not as a reason to weaken the guard.

Stop and quarantine on a budget mismatch, duplicate or missing pair, mixed
surface/model/serving identity, malformed judge output, raw query/URL/quote in
safe summaries, a note accepted without a matching reread, or any arm that
continues after its bounded allowance. Private transcripts and ledger files
remain outside Git.

## No-execution boundary

The exact loaded-surface preflight is:

```sh
python3 optimizer/research-fixtures/preflight.py --dry \
  --agent-dir /Users/Albert.Wessels/.pi/agent
```

The model-running command is intentionally not embedded in this file or any
test. A human must review the questions, configure an independent judge, and
explicitly approve the two-arm command before any session starts. No default,
mirror, optimizer, or historical evidence changes follow from this
preregistration.
