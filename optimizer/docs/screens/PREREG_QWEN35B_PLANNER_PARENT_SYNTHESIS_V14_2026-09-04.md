# Preregistration — Qwen 35B parent-synthesis diagnostic (V14)

Date: 2026-09-04  
Subject: `local-llamacpp/qwen36-35b-iq3s`  
Source surface: `39df03a3f05f1678cd6804ffc581eef5f04dac9d40e4d5be431a52f849422004`  
Loaded disposable surface: `8a2d637b0510e19b27434230c158dd2c36450c95d46887840e1ad50129a4a810`

## Question

Does the repaired parent handoff both settle a clean bounded research graph and
stop the active planner turn immediately after settlement? Earlier V10–V13
diagnostics remain separate hash boundaries and are not pooled.

## Instrument

Use the immutable admitted fixture
`compare-json-yaml-config-settle-mini` (manifest SHA-256
`ba8dff1613fc181c333e92de2bcf1fa399642d11ab644b3389b9f1a9e4f3fe0d`). It
names canonical JSON and YAML URLs, allocates two reads per branch but requires
only one, requires one combined source lead per child, and requires the parent
to reread both URLs and copy each claim text into exactly one parent-validated
evidence card.

Candidate runs use `RESEARCH_LEDGER=on`, `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, the parent-only headless lease, and
`--thinking minimal`. Each run has a fresh private agent/project directory, one
local research slot, a 360-second process-group wall, and an 8,000,000-byte
output cap.

## Decision rule

Run three candidate repetitions. A clean mechanism success requires: both
branches `done` with complete gap-free coverage; a terminal head marker; one
successful parent reread per delegated lead; exactly mapped parent evidence
cards; `plan_settle` success; and launcher completion before the wall. Any
timeout, post-settlement spin, open/deferred branch, incomplete coverage,
invalid report, unvalidated citation, or failed settlement is a failure. Stop
after three failures; controls cannot rescue a zero-of-three result.

Planner defaults remain dark unless all three repetitions pass. Even then this
is protocol evidence only and cannot influence efficacy rows, optimizer
candidates, adoption, mirroring, or defaults.
