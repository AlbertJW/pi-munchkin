# G04 deep-research screen — approved execution report

Date: 2026-09-07
Decision: **no-go / inconclusive; keep `PLAN_GRAPH=off` and
`DEEP_RESEARCH_PLANNING=off`**
Execution: explicitly approved in-session; no mirror, adoption, or defaults
change

## Binding and procedure

The screen used the frozen G03 research-shaped fixture manifests and the
candidate/control configuration pair named by the fresh G04 preregistration.
The source surface was `5d333e03d863c7374f7a45b3d277e85b54725b7c33f08140eda90bcc0253c62f`;
the disposable loaded mirror was
`7d5353d80cd2ee75acc8ceab6d0d0633aaef1701ee8d716061a107764c77319d`.
Candidate config was
`0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e` and
control config was
`a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.
The frozen G03 pack was revision `2026-09-07.r1`, digest
`c17737ae192126e014f2895cca61b2d85cdeb40896c91602b331755ba62561e7`.

The single-slot llama-swap router was used sequentially. Ling
(`local-llamacpp/ling3-tiny-fast`) ran first as a protocol smoke. Qwen 35B
(`local-llamacpp/qwen36-35b-iq3s`) ran next as the efficacy subject. Each
attempt used a disposable project directory, private telemetry/output paths,
`--thinking minimal`, an 8,000,000-byte cap, and a 300-second wall for Qwen
(180 seconds for Ling). No raw model output is reproduced here.

The preregistered stop rule fired on the first Qwen treatment timeout. The
remaining cases and repetitions were not run; this is therefore not a
complete efficacy cohort.

## Safe receipts

All byte counts are launcher counts. `graph start` is the count of the
`research_plan_start` lifecycle event. Branch and answer fields are derived
from private plan/telemetry state, not transcript text.

| subject | fixture | arm | result | wall s | output bytes | graph start | branch state | terminal answer | citation signal |
|---|---|---|---|---:|---:|---:|---|---|---|
| Ling | `sqlite-postgres-selection` | candidate | completed | 156.945 | 1,002,385 | 1 | 3 blocked; no settlement | no settled answer | citation guard saw 5, but no claim-level settlement |
| Ling | `sqlite-postgres-selection` | control | wall timeout | 181.017 | 779,185 | 0 | no graph | no; `unverified-end` | none |
| Ling | `python-release-fact-lookup` negative control | candidate | completed | 28.480 | 32,265 | 0 | no graph state | short answer emitted | one URL; no planner start |
| Qwen 35B | `compare-http-api-styles` | candidate | wall timeout | 300.182 | 480,439 | 0 | no graph state before wall | no | none |
| Qwen 35B | `compare-http-api-styles` | control | wall timeout | 301.026 | 945,237 | 0 | no graph | no; `unverified-end` | none |

The Ling treatment exhausted its bounded discovery path and ended with
explicit blocked branches. The Qwen treatment performed bounded retrieval
events but did not invoke the graph before the wall; its control likewise did
not reach a final answer. The negative fact lookup did not start a graph, as
required by the fixture. The candidate arm necessarily exposed a headless
tool lease to make graph activation possible, but no graph lifecycle was
created for that simple prompt.

## Measures and guard assessment

Correctness and material citation support are **inconclusive**: the timed-out
Qwen cases have no final answer to score, and the Ling treatment's citation
counter is not parent-validated claim coverage. Completion is zero for the
research treatment/control pairs in this early-stop sample. Wall time and
bounded output bytes were measured, but they are cost/operability signals,
not quality scores. No fabricated or unverified citation settled a head plan,
no child report was accepted as parent evidence, and no cross-arm evidence was
observed. The hard timeout/open-branch guard prevents promotion.

This result does not qualify either model for adoption and does not establish
that the research-round contract improves answer quality. It does establish a
portable protocol receipt for the Ling run and a reproducible Qwen failure
under the declared wall. Historical G03 and earlier planner screens remain
unchanged and are not pooled with this report.

## Follow-up

Keep both planner flags dark. Before another quality screen, diagnose the
Qwen treatment's failure to start the graph and the single-slot latency bound;
then issue a new preregistration with a completion-shaped prompt, an explicit
model-appropriate wall, and a deterministic claim/citation oracle. Re-run the
full matched G03 research cohort only after that remediation and a fresh
source/loaded receipt. Ling remains smoke-only and must not be pooled into a
Qwen efficacy decision.
