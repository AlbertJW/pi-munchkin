# Qwen 35B hierarchical planner / deep-research evaluation (V2)

Date: 2026-09-04  
Subject: `local-llamacpp/qwen36-35b-iq3s`  
Source surface: `84fbca135496a198937a6864d2fa43d59e589ab7a0b247efc68315057f26b0ee`  
Loaded disposable surface: `2ce87f6fa505fd38ea34a286f1dcac6c9af18f94d334cd0057741eb0dafe708d`

## Scope and controls

This was an explicitly approved, private, model-executing screen. The live
defaults and mirror were not changed. Candidate runs used the pending
deep-research profile (`RESEARCH_LEDGER=on`, `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, headless activation); controls used the matching
configuration with graph and deep-research planning off. Both arms used
`PI_RESEARCH_CONCURRENCY=1`, `PI_SUBAGENT_TIMEOUT_MS=120000`, Qwen 35B, and
the same 900-second / 8 MB launcher bound. A prior pre-fix run is excluded.

The primary sequence was interleaved by fixture and arm: JSON/YAML candidate,
JSON/YAML control, HTTP/GraphQL candidate, HTTP/GraphQL control,
SQLite/PostgreSQL candidate, SQLite/PostgreSQL control, followed by the same
order for repetition two. Six negative controls then used each fixture's
admitted lightweight prompt (candidate/control pairs). Raw transcripts and
telemetry remain outside the repository.

## Primary screen

| repetition | fixture | arm | seconds | result | planner starts | merged / failed branches | head marker | oracle |
|---|---|---:|---:|---|---:|---:|---|---:|
| 1 | JSON/YAML | candidate | 240.534 | completed | 1 | 2 / 0 | yes | 1/2 |
| 1 | JSON/YAML | control | 122.020 | completed | 0 | 0 / 0 | n/a | 0/2 |
| 1 | HTTP/GraphQL | candidate | 266.474 | completed | 1 | 0 / 2 | no | 0/3 |
| 1 | HTTP/GraphQL | control | 109.109 | completed | 0 | 0 / 0 | n/a | 0/3 |
| 1 | SQLite/PostgreSQL | candidate | 228.564 | completed | 1 | 1 / 2 | yes | 0/3 |
| 1 | SQLite/PostgreSQL | control | 91.576 | completed | 0 | 0 / 0 | n/a | 0/3 |
| 2 | JSON/YAML | candidate | 337.576 | completed | 1 | 2 / 0 | no | 0/2 |
| 2 | JSON/YAML | control | 90.646 | completed | 0 | 0 / 0 | n/a | 0/2 |
| 2 | HTTP/GraphQL | candidate | 400.215 | completed | 0 | 0 / 0 | n/a | 0/3 |
| 2 | HTTP/GraphQL | control | 103.816 | completed | 0 | 0 / 0 | n/a | 0/3 |
| 2 | SQLite/PostgreSQL | candidate | 296.384 | completed | 1 | 1 / 2 | yes | 0/3 |
| 2 | SQLite/PostgreSQL | control | 901.025 | wall timeout | 0 | 0 / 0 | n/a | 0/3 |

`head marker` means that every graph node reached a terminal branch status;
it is deliberately distinct from `settled_at`, which still requires the head
to reread and validate delegated evidence. Candidate branch failures were
reported as explicit blocked branches, not silently retried. The one control
timeout had no stderr and was terminated by the launcher wall bound.

The deterministic metadata oracle counts only parent-validated evidence-card
citations whose original URLs belong to the fixture's declared source family;
Jina wrapper URLs and unvalidated delegated claims do not count. The oracle is
payload-free and does not inspect answer prose. URL comparison now canonicalizes
fragment, default-port, trailing-slash, and `index.html` presentation variants.

## Negative controls

All six candidate/control negative controls exited 0 with empty stderr. None
emitted a `research-start` event. Five made no web calls at all; the SQL
control made two bounded search and two bounded read calls but still did not
activate planning. This supports the complex-only activation guard for the
tested lightweight prompts.

## Mechanism observations

The scheduler change worked as intended: planned depth-one/depth-two model
children were queued at one concurrent model call while web retrieval could
continue independently. Candidate JSON/YAML repetition one demonstrated two
merged branches and a terminal head marker. The same mechanism remained
stochastic: HTTP/GraphQL repetition one and both SQLite/PostgreSQL repetitions
had blocked child branches, JSON/YAML repetition two left a pending child, and
HTTP/GraphQL repetition two did not activate the planner at all. The tightened
child instruction reduced but did not eliminate protocol drift. A parent can
therefore finish with a terminal graph marker while still needing evidence
validation before settlement.

## Decision

This is a harness-protocol pass but a mechanism-quality **no-go**. Provenance,
fixture isolation, serialization, bounded output, negative-control behavior,
and explicit terminal failure handling are clean. The behavioral acceptance
criteria are not met: candidate branch failures are non-zero, one primary
control exceeded the preregistered wall bound, and claim/citation coverage is
not consistently above control (the only positive oracle result was 1/2 in the
first JSON/YAML candidate). No candidate is selected, no adoption or mirror is
authorized, and `PLAN_GRAPH` / `DEEP_RESEARCH_PLANNING` remain dark.

Recommended next screen: keep this scheduler and evidence-card work, then
repair parent synthesis and branch-report adherence with a smaller research
prompt and a model-independent fake-provider regression before another Qwen
screen. Re-preregister fresh hashes after any source change; do not pool these
observations with the earlier surface.
