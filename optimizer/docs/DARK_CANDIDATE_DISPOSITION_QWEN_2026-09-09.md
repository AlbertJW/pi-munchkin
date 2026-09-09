# Qwen dark-candidate disposition — 2026-09-09

This is the current disposition of the Qwen-facing dark/opt-in roster. It
supersedes the *active queue* wording in earlier planning notes without
rewriting any historical preregistration, screen, or boundary row. Historical
records remain authoritative for the evidence they describe; this file is the
authority for what is still an open candidate today.

The router health check on 2026-09-09 returned connection refused. No new
model session was started. Decisions below therefore use the latest
hash-bound Qwen receipts already recorded in the repository. A later live run
must use a new preregistration whenever the source, loaded surface, serving
epoch, or benchmark changes.

## Decision vocabulary

**APPROVED-QWEN-BOUNDARY** means the mechanism is cleared for explicit,
bounded Qwen use behind its existing flag. It is not a universal efficacy
claim, does not change a default, and does not authorize mirroring, clicking,
or automatic adoption.

**RETIRED-QWEN-ROSTER** means the item is removed from the active candidate
queue. Its implementation may remain as an explicitly opt-in compatibility or
diagnostic path when other features depend on it, but it is no longer an
unresolved candidate. Reopening it requires a new hypothesis, preregistration,
and fresh evidence; old incomplete or mechanism-only rows cannot be pooled.

## Final roster

| Candidate | Latest Qwen evidence | Decision | Runtime consequence |
|---|---|---|---|
| `CONTEXT_ADMISSION=on` | G02's 2026-09-07 Qwen→Ling switch recorded two status-200 turns, epochs 0/1, two admitted requests, one bound session/surface, and no raw payloads. | **APPROVED-QWEN-BOUNDARY** | Explicit Qwen safety use is allowed; `CONTEXT_ADMISSION` remains opt-in and no default changes. Capacity/quality benefit is unclaimed. |
| `VISION=on` with `VISION_GROUNDING=sam` | The current Qwen vision pack answered all three frozen semantic cases; SAM2.1 Tiny produced valid geometry on all three (IoU 0.8869–0.8942). The pack is synthetic and diagnostic. | **APPROVED-QWEN-BOUNDARY** | Explicit screenshot/grounding qualification is allowed; `VISION=off`, grounding remains non-clicking, and no automatic UI action is enabled. |
| `BASH_OUTPUT_GUARD=on` | The paired Qwen 35B mechanism screen withheld exactly one oversized result at the declared cap, emitted one bounded recovery error, and produced no second oversized request. No correctness or cost gain was shown. | **APPROVED-QWEN-BOUNDARY** | Explicit protective use is allowed with the existing cap and recovery path; it remains off by default and is not an efficacy adoption. |
| `PLAN_GRAPH=on` + `DEEP_RESEARCH_PLANNING=on` | G04 stopped at the first Qwen treatment timeout: treatment and control both reached the 300-second wall without a terminal answer; no parent settlement occurred. Earlier V5/V6/V3 planner screens were incomplete or no-go. | **RETIRED-QWEN-ROSTER** | Keep both flags off. The graph code remains available for a newly designed research study, but the current candidate is no longer in the adoption queue. |
| `RESEARCH_LEDGER=on` | Qwen Run 3 was incomplete (one overrun, no independent judge, no valid answer-quality comparison); Run 4 was prepared but never executed. | **RETIRED-QWEN-ROSTER** | Keep the ledger opt-in. Reopening requires a complete judge-backed comparison and a new preregistration. |
| `LOOP_EPISODE_MODE=enforce` | Qwen mechanism and delivery screens failed to produce a bounded intervention/settlement; the shutdown retest only repaired lifecycle safety. | **RETIRED-QWEN-ROSTER** | Keep `shadow`; do not run the current enforce candidate for Qwen adoption. |
| `WORKING_MEMORY=on` | Only a mechanism smoke exists (one upsert/list); there is no Qwen comparative value, context-cost, or recovery result. | **RETIRED-QWEN-ROSTER** | Keep off. Reopen only for a measured memory-dependent task where added context is justified. |
| `MUNCHKIN_TOOL_SURFACE=minimal` | A happy-path disposable smoke created a file, but no Qwen paired correctness/recovery comparison exists. | **RETIRED-QWEN-ROSTER** | Keep opt-in only; no active Qwen candidate remains. |
| `CONTEXT_DISCOVERY=on` | No Qwen value screen exists; the feature adds a synthetic handshake and its data is already represented by local serving truth. | **RETIRED-QWEN-ROSTER** | Keep off. Reopen only if a concrete serving-unknown failure cannot be solved from local metadata. |
| `JINA_READER=on` | The Qwen receipt only proved the formatter's surface could load while Jina was off; no retrieval-quality or latency comparison exists. | **RETIRED-QWEN-ROSTER** | Keep opt-in as a compatibility backend, but remove it from the active candidate queue. |
| `GREP_FIND_TOOLS=on` | The prepared screen targeted `qwopus35-4b` and has no Qwen execution or efficacy receipt. | **RETIRED-QWEN-ROSTER** | Keep the native tools available when explicitly selected; no Qwen adoption claim or queue entry remains. |

## Already resolved and therefore excluded

`GOALS=on` and normal `CONTEXT_HANDOFF=on` are already live defaults with
separate lifecycle and Qwen mechanism receipts; they are not dark candidates.
`PLAN_TOOL_GO`, `FORCE_PLAN_WRITE`, and `RESEARCH_BUDGET` are compatibility or
control switches, not current adoption candidates. Optimizer V2, G03, and G05
remain repository-only qualification work and cannot be decided by a Qwen
runtime screen.

## Result

There are no unresolved Qwen dark-candidate queue entries after this review:
three mechanisms are approved for bounded explicit use, and eight are retired
from the active roster. Defaults remain unchanged. A future candidate must be
newly named, hash-bound, and preregistered; it cannot inherit a retired item's
old evidence by resemblance.
