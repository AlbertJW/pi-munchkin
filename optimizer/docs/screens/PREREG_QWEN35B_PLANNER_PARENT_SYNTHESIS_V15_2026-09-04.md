# Preregistration — Qwen 35B parent-synthesis diagnostic (V15)

Date: 2026-09-04  
Subject: `local-llamacpp/qwen36-35b-iq3s`  
Source surface: `39df03a3f05f1678cd6804ffc581eef5f04dac9d40e4d5be431a52f849422004`  
Loaded disposable surface: `8a2d637b0510e19b27434230c158dd2c36450c95d46887840e1ad50129a4a810`

## Question

Can the repaired parent handoff reach three clean settlements when child
dispatch is sequential and fork scheduling is removed from the diagnostic?
V10–V14 remain separate, quarantined diagnostics and are not pooled.

## Instrument

Use the immutable admitted fixture
`compare-json-yaml-config-sequential-mini` (manifest SHA-256
`601311ff3ee49dba77afc8dd75c1be8bf95ab14cd9ee68f4f8c2d91671517cfd`). It
names canonical JSON and YAML URLs, gives each branch two reads while requiring
only one, requires one combined source lead per child, and explicitly requires
the parent to dispatch JSON first, wait for its terminal report, then dispatch
YAML with a separate single-child call. The parent must reread both leads,
record exact claim-key evidence cards, and settle with a summary below 240
characters.

Candidate runs use `RESEARCH_LEDGER=on`, `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, the parent-only headless lease, and
`--thinking minimal`. Each has a fresh private agent/project directory, one
local research slot, a 360-second process-group wall, and an 8,000,000-byte
output cap.

## Decision rule

Run three candidate repetitions. A clean mechanism success requires both
branches `done` with complete gap-free coverage, a terminal head marker, one
successful parent reread per lead, exactly mapped parent evidence cards,
`plan_settle` success, and launcher completion before the wall. Any parallel
dispatch, wrong-branch report, retry of a valid child, timeout, post-settlement
spin, open/deferred branch, invalid report, unvalidated citation, or failed
settlement is a failure. Stop after three failures; controls cannot rescue a
zero-of-three result.

Planner defaults remain dark regardless of this protocol screen. Even three
successes would be mechanism evidence only and cannot influence efficacy rows,
optimizer candidates, adoption, mirroring, or defaults.
