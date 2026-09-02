# Preregistration: Qwen 35B hierarchical planner mechanism screen v2 (2026-09-02)

## Status and purpose

**PREPARED — NO MODEL SESSIONS STARTED.** This document replaces the stale
2026-08-25 draft as the execution envelope for the dark hierarchical
deep-research graph. It asks only whether the parent/child lifecycle can
activate, conserve budget, validate delegated evidence, merge branches, and
settle safely. It is not a quality comparison, adoption gate, or permission to
enable either planner flag.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source branch: `codex/qwen35b-provenance` at `b45ff0b`.
- Source surface SHA-256:
  `5b84241cbd47bdd61c1d4641166e6ec44f124ddac706778d5c477c3efac551bf`.
- Loaded mirror surface SHA-256:
  `0c09cb637992c35176bd7ae4b0865850cb6a17bc2f1e5efaf4c06e59d2c1b4ef`.
- Candidate configuration `deep-research-planning.json`:
  `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e`.
- Control configuration `deep-research-planning-control.json`:
  `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.
- Both configurations set `RESEARCH_LEDGER=on`; its non-graph arm now has a
  hard three-search/five-distinct-read wall. Candidate graph allocations and
  parent validation reads remain separately bounded.

The launcher must resolve the loaded hash immediately before every run. Any
source, mirror, model, registry, provider, serving, or configuration mismatch
voids that session; rows never pool across the resulting boundary.

## Fixtures and controls

Before execution, admit three immutable artifact-graded research fixtures:

1. a comparative question with two independent evidence families;
2. a contested claim requiring supporting and counter-evidence branches; and
3. a multi-part synthesis with one deliberately unresolved evidence gap.

Each fixture must have a frozen prompt, source-time cutoff, expected evidence
families, citation/claim oracle, budget receipt, and a paired straightforward
fact-lookup sibling. The fact siblings are negative controls: they must not
activate `research_plan_start`. Existing coding fixtures are ineligible because
they cannot expose research branching or parent evidence validation. Fixture
admission, source manifests, and oracles are prerequisites, not model evidence.

The structural admission pass is now complete for the first slate. It validated
`optimizer/research-fixtures/admission.py` without network or inference and
emitted these content-addressed receipts:

| fixture | kind | manifest SHA-256 | admission receipt SHA-256 |
|---|---|---|---|
| `compare-http-api-styles` | comparative | `f4543130e6e2414e1acfdc259f457ffab904135291887b8f0dfff48ff51773ad` | `206d6e66eabbb9ee5274fbfe2f05c88e408605d794c7b6171ca9b4ef4ba09b4c` |
| `password-expiration-guidance` | contested | `786c66c9e8a7a19c8d85afd36729282be6f3360d74e67de8316d000a3e99ccf3` | `8890d33adbeaabd3873752030cbb36e13f995a85b671c9877a12839f3ee2e92f` |
| `sqlite-postgres-selection` | multi-part | `9aca1c35b47c6054e6cee938bfb91997f97b37abb7a37cd797980db3c625e975` | `d0ce6db9d6c664f1bc8515850ba4103885e0293e072244569e594fa3b58fa7cd` |

This is structural admission only. The URLs are bounded leads, not fetched
evidence; the local oracle checks only the shape of a future answer artifact.
The exact source-time cutoff, provenance, and negative-control rules remain
bound to each manifest. A human still must review the slate and explicitly
start any model session.

## Arms and run sequence

The control uses the current deep-research skill with the ledger but with
`PLAN_GRAPH=off` and `DEEP_RESEARCH_PLANNING=off`. The candidate sets both flags
to `on`. No other tool profile, context, model, provider, endpoint, or semantic
loop setting may differ. Run six candidate-only mechanism sessions, balanced
across the three fixtures and randomized by fixture; then run three candidate
fact-lookup controls. Use the hash-verifying `planner_smoke.py` launcher with a
180-second outer wall and 350,000-byte combined stream cap. A timeout or output
cap is an incomplete lifecycle observation, never a pass or a quality score.

The candidate mechanism pass requires at least four of six sessions to contain
exactly one `research-start`, at least one validated `branch-merged`, no
`branch-failed`, no telemetry schema rejection, no budget inflation, and one
terminal `settled` event after parent evidence rereads. Every delegated source
used in a final answer must be reread by the parent before settlement. The
negative controls require zero `research-start`, `branch-merged`, and `settled`
events in all three sessions.

## Safe receipts and stop rules

Retain only counts and bounded structural classifications: graph node/depth
counts, allocated and consumed search/read units, branch merges/failures,
parent validation rereads, delegated-lead counts, evidence gaps, deferred
nodes, child exit classes, turns, tool calls, tokens, wall time, and artifact
oracle outcomes. Never retain query, URL, quote, page, prompt, or answer text
in the report. Private transcripts and ledgers remain outside Git.

Stop and quarantine immediately on identity drift, malformed telemetry, raw
payload retention, duplicate/missing settlement, an invalid or missing child
report, a completed node without coverage, depth above two, budget inflation,
child mutation of the parent capsule, post-settlement mutation, or a model
attempt to delegate from depth two. A blocked branch is an explicit lifecycle
outcome; it cannot silently complete the head plan.

## Interpretation and next gate

A clean mechanism screen proves only that this bounded graph is operable on the
admitted Qwen subject. It cannot justify defaults, adoption, or a claim that
research answers improve. A failed screen is a diagnosis signal, not negative
efficacy evidence. Only after this mechanism screen passes may a separate
powered comparative preregistration compare graph and control on evidence
coverage, synthesis correctness, completeness, context/tool cost, and latency.

No execution is authorized by this file. The next allowed action is a human
preflight of these admitted manifests, followed by explicit approval of the
exact launcher command and current loaded hash.
