# Preregistration — Qwen 35B parent-synthesis diagnostic (V13)

Date: 2026-09-04  
Subject: `local-llamacpp/qwen36-35b-iq3s`  
Source surface: `ece72490e4299357c69affd7726d15f4b8985fb80bdb36ad1090c05fda3c773b`  
Loaded disposable surface: `3772384d04153718033bc5f5eb289328147a6fdb72aba3e01e9037defe672cdd`

## Question

Can the repaired parent handoff produce three gap-free settlements when each
child has one canonical source, one combined claim, and unused read capacity?
V10–V12 are separate diagnostic boundaries and are not pooled.

## Instrument

Use the newly admitted immutable fixture
`compare-json-yaml-config-settle-mini` (manifest SHA-256
`ba8dff1613fc181c333e92de2bcf1fa399642d11ab644b3389b9f1a9e4f3fe0d`). The
fixture names canonical JSON and YAML URLs, allocates two reads per branch but
requires only one, requires exactly one combined source lead per child, and
requires the parent to reread both URLs and copy each claim text exactly into
one parent-validated evidence card. The negative-control prompt is unchanged
and must not start a plan.

Candidate runs use `RESEARCH_LEDGER=on`, `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, and the parent-only headless lease. Every run has
a fresh private agent/project directory, `--thinking minimal`, one local
research slot, a 360-second process-group wall, and an 8,000,000-byte output
cap.

## Decision rule

Run three candidate repetitions. A clean mechanism success requires a terminal
head marker, every branch status `done` (no evidence gaps or deferrals), one
successful parent reread per delegated lead, exactly mapped parent evidence
cards, and a successful `plan_settle` before the wall. Any timeout, open or
deferred branch, incomplete coverage, invalid report, unvalidated citation, or
failed settlement is a failure. Stop after three failures; controls cannot
rescue a zero-of-three settlement result.

The planner remains dark unless all three repetitions meet this criterion.
Even three successes are protocol evidence only and cannot influence efficacy
rows, optimizer candidates, adoption, mirroring, or defaults.
