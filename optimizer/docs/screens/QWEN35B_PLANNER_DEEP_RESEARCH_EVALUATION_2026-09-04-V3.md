# Qwen 35B hierarchical planner / deep-research evaluation (V3)

Date: 2026-09-04  
Subject: `local-llamacpp/qwen36-35b-iq3s`  
Source surface: `ae60bdc167b12add717649056019748f42a423315630424ef988f5121cfcc175`  
Loaded disposable surface: `41ff832c8df9fbc611b8192384bcc2959073435686db60f68dc01839d820f97d`

## Scope and bound

This was an explicitly approved, private diagnostic screen after the parent
synthesis and cross-process reservation repairs. The live mirror and defaults
were untouched. Candidate runs enabled `RESEARCH_LEDGER=on`, `PLAN_GRAPH=on`,
and `DEEP_RESEARCH_PLANNING=on`; the matching control used the same source and
model with both planner flags off. Planned child concurrency was one. The
launcher used a 300-second wall and an 8,000,000-byte cap; child calls were
allowed 300 seconds. This shorter wall was chosen to prevent another
unbounded Qwen planning loop from consuming the entire screen.

The screen stopped after three candidate fixtures failed the hard parent-
settlement criterion. The remaining repetitions and negative controls were
not run; they would not be capable of rescuing a zero-of-three settlement
result. This is an early-stop no-go, not a complete efficacy comparison.

## Bounded session receipts

| run | fixture | arm | launcher result | seconds | stdout bytes | planner starts | branch merges | branch failures | head marker | settled |
|---|---|---|---|---:|---:|---:|---:|---:|---|---|
| 01 | `compare-json-yaml-config` | candidate | completed | 720.971 | 3,089,266 | 1 | 2 | 0 | yes | no |
| 02 | `compare-json-yaml-config` | control | completed | 231.398 | 1,442,177 | 0 | 0 | 0 | n/a | n/a |
| 03 | `compare-http-api-styles` | candidate | completed | 277.783 | 1,240,013 | 1 | 1 | 0 | yes | no |
| 05 | `sqlite-postgres-selection` | candidate | wall timeout | 300.132 | 826,197 | 1 | 3 | 0 | no | no |

All four launcher receipts exited with bounded stderr `0` and carried the
exact loaded surface hash above. Telemetry rows were private and payload-free;
the aggregate counts were inspected from `ext/kind` classifications only.
Run 05 ended with one open branch when the process-group wall fired. Runs 01
and 03 reached terminal graph markers but their parent plans remained
unsettled; both exposed deferred/evidence-gap outcomes instead of falsely
claiming completion.

## Decision

**Harness protocol: pass. Mechanism quality: no-go.** The new behavior is
safer than the prior screen: delegated reports were merged transactionally,
terminal markers were explicit, and the parent did not silently settle on
unvalidated delegated evidence. However, the required parent synthesis
lifecycle was not achieved in any of the three candidate fixtures, and one
fixture still hit the bounded wall with an open branch. No quality score,
adoption decision, mirror operation, or planner-default change is authorized.
`PLAN_GRAPH` and `DEEP_RESEARCH_PLANNING` remain off.

The new claim-obligation check was exercised offline by the fake-provider
regression: an unrelated parent-validated card is rejected, while a card whose
claim ID is derived from the delegated source lead is accepted. Cross-process
query and canonical-URL reservations likewise pass deterministic concurrent
tests. These are protocol evidence only and cannot substitute for a
research-shaped Qwen screen.

Raw transcripts, URLs, quotes, page bodies, and private telemetry remain under
`/private/tmp/qwen35b-planner-screen-20260904`; they are not copied into Git.

## Follow-up

First diagnose why Qwen spends its bounded turn on branch synthesis and does
not perform the parent reread/settle step. Re-preregister a smaller
completion-shaped prompt and, if needed, a lower reasoning budget before any
new model run. Do not pool this early-stop screen with V2 or earlier hashes.
