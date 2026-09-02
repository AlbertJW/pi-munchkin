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
- Source branch: `codex/qwen35b-provenance` at `abc39e2`.
- Source surface SHA-256:
  `62b1e565748394ec7aaccadcc4d9e3f5167dea31ca974d0ed9461d0d76fc0234`.
- Loaded mirror surface SHA-256:
  `9629b4dbd3d871703a82edbf12db76db813863a4c369b6d45edf2e3cb0671970`.
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
| `compare-http-api-styles` | comparative | `f4543130e6e2414e1acfdc259f457ffab904135291887b8f0dfff48ff51773ad` | `84d6cd5c82a4fb9c48c13d91bb656cefc62141641aeecf7d0a75e17332972413` |
| `password-expiration-guidance` | contested | `786c66c9e8a7a19c8d85afd36729282be6f3360d74e67de8316d000a3e99ccf3` | `7a2de48a4e7fc0638d4e3e9f420b8280d6a381666dd8c1235ee2d7b4e45e2766` |
| `sqlite-postgres-selection` | multi-part | `9aca1c35b47c6054e6cee938bfb91997f97b37abb7a37cd797980db3c625e975` | `0be1e9162d9d8b1afec9dd6d52ebe0f27274a9f8a9c91c90660035187a242ed4` |

This is structural admission only, not human review or model calibration. The
URLs are bounded leads, not fetched evidence; the local oracle checks only the
shape of a future answer artifact.
The exact source-time cutoff, provenance, and negative-control rules remain
bound to each manifest. A human still must review the slate and explicitly
start any model session.

The no-inference preflight now binds this slate to the prepared surface and
configuration identities:

```sh
python3 optimizer/research-fixtures/preflight.py --dry \
  --agent-dir /Users/Albert.Wessels/.pi/agent
```

On 2026-09-02 it returned `pi.planner-preflight/v1` with source
`62b1e565…`, loaded surface `9629b4db…`, the exact Qwen subject, both expected
flag maps, and all three fixture IDs. This output is a readiness receipt only;
the command never contacts the model server or starts Pi.

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
