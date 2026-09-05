# Preregistration — Qwen 35B parent-synthesis diagnostic (V11)

Date: 2026-09-04  
Subject: `local-llamacpp/qwen36-35b-iq3s`  
Source surface: `ece72490e4299357c69affd7726d15f4b8985fb80bdb36ad1090c05fda3c773b`  
Loaded disposable surface: `3772384d04153718033bc5f5eb289328147a6fdb72aba3e01e9037defe672cdd`

## Question

After the V10 follow-up exposed delegated leads, can Qwen 35B complete the
parent reread, evidence-card mapping, and `plan_settle` step without timeout or
evidence gaps? V10 remains a valid diagnostic of the handoff but is not pooled
with this run because its fixture allowed noisy search-derived leads.

## Instrument

Use the newly admitted immutable fixture
`compare-json-yaml-config-direct-mini` (manifest SHA-256
`05bb14059b3079c13a40f185ae8f42c021f39671214b21b659688153a1baad3b`). The
prompt names the two official source URLs, allocates zero searches and one read
per branch, requires immediate child dispatch, and tells the parent to reread
each original URL and copy the exact delegated claim text into its evidence
card. The negative-control prompt is unchanged and must not start a plan.

Candidate runs use `RESEARCH_LEDGER=on`, `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, and the parent-only headless lease. The matching
control is optional after the candidate mechanism gate and uses the same model,
fixture, and identities with planner flags off. Every run has a fresh private
agent/project directory, `--thinking minimal`, a 360-second process-group wall,
an 8,000,000-byte output cap, and one local research slot.

## Decision rule

Run three candidate repetitions. A clean mechanism success requires a terminal
head marker, one successful parent reread for every delegated source lead,
parent-validated cards whose claim IDs map to the delegated obligations, and a
successful `plan_settle` before the wall. Timeouts, open branches, missing or
deferred evidence, invalid reports, and unvalidated citations are failures.
Stop after three failures; do not run controls as if they could rescue a zero
of three settlement result.

The planner mechanism remains dark unless all three repetitions reach validated
parent settlement. Even then this is protocol evidence only: it cannot seed
optimizer candidates, efficacy rows, adoption, mirroring, or default changes.

## Execution gate and interpretation

Run `preflight.py --dry` and `planner_smoke.py --dry` with the exact hashes
above. Model execution is permitted only through an explicitly approved
`planner_smoke.py --run`. Retain only bounded classifications, byte counts,
event-kind counts, graph statuses, and provenance hashes; keep transcripts and
source content private under `/private/tmp`.

If the three direct-source repetitions settle cleanly, proceed to a separate
multi-fixture complex-research screen. Otherwise diagnose the remaining issue
as a model/tool-contract or serving-budget problem and keep
`PLAN_GRAPH`/`DEEP_RESEARCH_PLANNING` off.
