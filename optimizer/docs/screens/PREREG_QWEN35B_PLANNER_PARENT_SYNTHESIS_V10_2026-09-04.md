# Preregistration — Qwen 35B parent-synthesis diagnostic (V10)

Date: 2026-09-04  
Subject: `local-llamacpp/qwen36-35b-iq3s`  
Source surface: `a79a654c3f6277a5ca81cb0c8aeac6f2aa3cc038d8cb8a91233d08436f81b108`  
Loaded disposable surface: `3859a4e6d7debf7223c9f0877301f1a762315242a5ef6dcc3a4d6329a19174b9`

## Question

Does the parent follow-up repair allow Qwen 35B to complete the missing
reread-and-settle step after delegated research branches return? The earlier
V3 diagnostic reached terminal graph markers but ended the parent turn before
source rereads and `plan_settle`; it is a separate hash boundary and is not
pooled here.

## Instrument

The admitted fixture is
`compare-json-yaml-config-mini` (manifest SHA-256
`aa90ad98fc27aa5b65f59b4cec6fbb87010e9bd1ecc27e35ab01a023f1b5a457`). Its
completion-shaped prompt requires exactly two branches, one search and one
read per branch, immediate child dispatch, parent rereads, parent evidence
cards, and settlement. The negative-control prompt remains the existing
one-source JSON fact lookup and must not start a plan.

Candidate runs use `RESEARCH_LEDGER=on`, `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, and the parent-only headless lease. The matching
control uses the same model, fixture, source, and loaded hashes with planner
flags off. Each run is isolated to a disposable agent/project directory and
uses `--thinking minimal`, a single local research slot, a 360-second
process-group wall, and an 8,000,000-byte output cap. No live mirror or source
tree is touched.

## Decision rule

Run three candidate repetitions. A candidate repetition counts as a clean
mechanism success only if the graph records a terminal head, every delegated
source lead is reread by the parent, the parent evidence ledger contains the
required claim mappings, and `plan_settle` succeeds before the wall. A blocked
or deferred branch is an explicit bounded outcome, not a success. Any timeout,
open branch, missing report, invalid provenance, or unvalidated citation is a
failure for this diagnostic. Stop early if all three repetitions fail the
settlement criterion; do not run controls as if they could rescue a zero of
three mechanism result.

The protocol is considered repaired only when at least three candidate
repetitions reach validated parent settlement. This is still mechanism
evidence, not a quality or adoption decision. Planner defaults remain dark
regardless of the result.

## Execution gate

Preparation and dry-run checks must pass with the exact identities above. Model
execution is permitted only through the explicit `planner_smoke.py --run`
command after human approval. Summaries may retain only exit classification,
byte counts, event-kind counts, graph statuses, and hash-bound provenance;
transcripts, URLs, quotes, and page bodies remain private under `/private/tmp`.

## Interpretation

Three clean settlements would justify a separate, larger complex-research
screen using the existing comparative, contested, and multi-part fixtures.
Fewer than three clean settlements leaves the planner dark and triggers another
diagnosis of the parent handoff, prompt shape, or Qwen serving budget. No result
from this screen may seed optimizer candidates, efficacy rows, or a rollout.
