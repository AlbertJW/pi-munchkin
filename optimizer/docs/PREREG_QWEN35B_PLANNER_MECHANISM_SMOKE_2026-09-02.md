# Preregistration: Qwen 35B planner-graph mechanism smoke (2026-09-02)

## Status and purpose

**PREPARED — one-session mechanism smoke.** The semantic-loop candidate has
been explicitly retired from the near-term Qwen queue, so this isolated smoke
tests the next dark candidate: hierarchical planning for deep research. It
does not compare answers, measure research quality, or authorize either flag.
The larger planner screen remains blocked until purpose-built research fixtures
and a paired negative-control design are admitted.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source branch: `codex/qwen35b-provenance`
- Source tip: `80bf330`
- Package source surface SHA-256: `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi surface SHA-256: `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Model-registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`

The smoke runs in a disposable private agent directory and project workspace.
Its prompt, transcript, and raw telemetry remain outside Git. The current
mirror remains unchanged and the router must be idle before launch.

## Treatment and bounded question

Run one candidate-only session with `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, and `RESEARCH_LEDGER=on`; all other dark flags stay
off. Ask a comparative, two-branch public-source question with at most one
search and one read per branch, then require parent synthesis and settlement.
The prompt is hashed in the private receipt; no source text or URL is retained
in the repository.

The smoke passes its mechanism check only if the session emits exactly one
`plan-runner/research-start`, each branch reaches a terminal validated report,
the parent records one settlement after evidence validation, total usage stays
within the declared three-search/five-read envelope, and no child mutates the
parent capsule. A proposal or pending graph without settlement is incomplete.

## Stop and interpretation rules

Stop on identity drift, malformed telemetry, budget inflation, depth violation,
duplicate/missing settlement, unverified child evidence, or a timeout. A clean
mechanism pass proves only that the graph can be reached and closed on this
subject; it does not justify enabling `PLAN_GRAPH` or
`DEEP_RESEARCH_PLANNING`, and it cannot seed an efficacy decision. A failure is
diagnostic subject/fixture evidence and must not be pooled with prior planner
runs on another surface.

## Follow-up

If the smoke is clean, author and admit three research fixtures (comparative,
contested, and multi-part with a real gap) plus fact-lookup negative controls,
then issue a six-session mechanism preregistration. If it does not settle,
keep the flags dark and redesign the prompt envelope before any longer run.

