# Qwen 35B hierarchical planner / deep-research evaluation

**Date:** 2026-09-04  
**Decision:** do not promote; keep `PLAN_GRAPH=off` and
`DEEP_RESEARCH_PLANNING=off`  
**Status:** complete paired screen, insufficient evidence for efficacy

## What was evaluated

This was a fresh, private, hash-bound candidate/control screen of the dark
hierarchical planner on three admitted complex research fixtures. The subject
was `local-llamacpp/qwen36-35b-iq3s`. Both arms used the same loaded surface
(`184c9178950c38c2caf469f68bfee242bddbbf24af299172bd3a91d68511417a`, source
commit `7c080e9e11c560fcb4efbafd7fb727a4ddeade29`), the same model, disposable
agent/project directories, `--thinking minimal`, a 120-second delegated-child
timeout, a 900-second wall bound, and an 8,000,000-byte output bound. The
candidate config was bound to
`0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e`; the
control config was bound to
`a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.
`VERIFY_GATE=off` was applied identically because this private research
project has no Pi gate; this is a declared screen deviation, not a source or
model change. No live mirror, default, campaign, or source file was modified.

The fixture admission digests were `c59fd0a480fc370b17e3df7fb8fccbbbf0279b2932ef6049791f7cd03adab646`
(JSON/YAML), `f4543130e6e2414e1acfdc259f457ffab904135291887b8f0dfff48ff51773ad`
(REST/GraphQL), and `9aca1c35b47c6054e6cee938bfb91997f97b37abb7a37cd797980db3c625e975`
(SQLite/PostgreSQL). Raw transcripts and telemetry remain outside Git.

## Safe run results

The values below are aggregate classifications only. URLs are counts, not
the URLs themselves; no model arguments, source contents, or answer text is
stored in this packet.

| fixture | arm | wall seconds | output bytes | planner branches | branch result | searches / reads | final answer chars / URLs | plan phase |
|---|---|---:|---:|---:|---|---:|---:|---|
| JSON/YAML | candidate | 499.841 | 1,530,454 | 2 | 2 deferred, 2 merged | 4 / 5 | 1,923 / 4 | executing |
| JSON/YAML | control | 72.008 | 381,495 | 0 | n/a | 0 / 0 | 3,125 / 4 | n/a |
| REST/GraphQL | candidate | 362.989 | 1,599,439 | 3 | 3 blocked (`child_failed`), 0 merged | 16 / 4 | 457 / 0 | executing |
| REST/GraphQL | control | 160.591 | 845,417 | 0 | n/a | 0 / 0 | 0 / 0; final stop was `error` | n/a |
| SQLite/PostgreSQL | candidate | 300.393 | 1,022,699 | 3 | 3 blocked (`child_failed`), 0 merged | 12 / 6 | 816 / 0 | executing |
| SQLite/PostgreSQL | control | 581.649 | 2,264,753 | 0 | n/a | 0 / 0 | 6,374 / 7 | n/a |

The JSON/YAML candidate is the only clean graph execution: both branches
merged, both were explicitly deferred with evidence gaps, and the parent made
settle calls. Even there, the persisted graph still reported `phase=executing`
after Pi exited, so this is not a terminal head-plan completion. The other two
candidate runs created their expected branches, but every child failed and the
parent retained an executing graph. The repeated three-branch failure pattern
appeared only when the fixture fanned out to three children; process snapshots
showed concurrent child Pi processes on a single-slot router. That is a strong
orchestration/saturation lead, not proof of a model reasoning defect.

Across candidates, 8 branches were created, 2 merged, and 6 blocked. Across
controls, no `research_plan_start` or delegated child was observed. Candidate
wall time was 499.841, 362.989, and 300.393 seconds; control wall time was
72.008, 160.591, and 581.649 seconds. The broad spread means raw wall time is
not a valid efficacy metric by itself.

## Quality and validity interpretation

This screen cannot establish answer quality. The checked-in
`research_shape.py` oracle validates only an answer artifact's evidence-family
and claim shape; it does not grade the text produced by the model. The packet
therefore uses only conservative answer-shape signals: a terminal answer
block, citation-count, and whether the graph reached terminal branch states.
On those signals, a citation-bearing terminal answer occurred in one of three
candidate runs and two of three controls. The candidate HTTP and SQL runs
produced no citation-bearing final answer because their branches failed; the
HTTP control also ended with a model error, so this is not a clean efficacy
win for either arm.

There is a second comparison limitation: `FORCE_PLAN_WRITE=on` was retained
for both launcher arms to preserve the existing mechanism fixture. The
control stayed graph-off and never called `research_plan_start`, but it did
make ordinary flat `plan_write` calls on some fixtures. The next preregistration
must separate flat-plan availability from graph activation explicitly.

The arms were run sequentially (candidate before control for each fixture) and
there was one repetition per fixture. No claim-level blinded judge or
independent citation verifier was run. These results are consequently a
mechanism/operability screen with bounded answer-shape evidence, not a model
quality estimate.

## Decision and required next step

Do not enable either planner flag and do not use these runs as adoption or
optimizer evidence. The planner currently adds substantial interaction and
output cost while failing closed on multi-branch child completion, and its
parent graph does not reliably become terminal even when branch work succeeds.

The next goal is to repair the single-slot orchestration boundary before a
quality rerun. The planner should queue or serialize child Pi sessions (or
derive fan-out from serving concurrency), require a terminal branch report for
each child, and settle the head graph to a terminal phase only after all
required evidence rereads complete. The control launcher should disable the
flat-plan forcing knob or record it as a separate factor. Then preregister a
fresh, interleaved screen with at least two repetitions per fixture, include
the negative controls, and add a deterministic claim/citation oracle. Adoption
should require no infrastructure child failures, terminal head plans, and
candidate claim/citation completion at least as good as control under a
predeclared cost guard. No rollout or mirror action is authorized by this
packet.

