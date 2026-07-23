# Evidence Ladder

This codebase has long used a hierarchy of evidence strength for trajectory checks
without ever naming it, which let `trajectory_check.py`'s docstrings overclaim
("unforgeable evidence" for what was actually only invocation+execution proof —
fixed alongside this doc, Reddit #2 in `UPGRADE_MAP.md`). Writing the ladder down
gives future checks (and reviewers of them) shared vocabulary for what a piece of
session evidence actually proves, so a claim can be pinned to a rung instead of
argued about from scratch each time. Rungs are cumulative: each one subsumes what
the rung below it proves and narrows what remains unproven.

## The five levels

| # | Level | Proves | Does NOT prove | Real example in this codebase |
|---|---|---|---|---|
| 1 | **Testimony** | The model said/narrated something | The claim is true, or that anything actually happened | `check_sv_ambiguous_spec`'s fallback, `_mentions_both_conventions` (`trajectory_check.py:185`, consulted `:222`) — scans assistant text for both precedent filenames. Its own docstring already flags this as weaker: "free text a model could produce while still guessing." |
| 2 | **Invocation** | A specific tool was called with specific arguments | The call executed without error, or that the underlying work happened | `check_t4` and `check_sv_ambiguous_spec`'s primary signal (`trajectory_check.py:133`, `:190`) — a recorded `subagent`/`plan_write` toolCall naming the right agent / declaring an uncertainty. (Both checks also require a matching non-error `toolResult`, which is rung 3 — see the docstring fix.) |
| 3 | **Execution receipt** | The execution layer accepted the call and attests to what it did | The attestation is accurate, or that it matches reality | `check_bigdata` requiring `receipt.get("schema") == "pi.tool-receipt/v1"` (`trajectory_check.py:58`) — a structured attestation the `search_spans` tool implementation writes at execution time, not something the model's own arguments can produce. |
| 4 | **State-change receipt** | A specific local mutation left the filesystem in a determinate, checkable state | The mutation is what the task actually needed | `harness/extensions/micro-gate.ts` (`MICRO_GATE=on`) — after an `edit`/`write`/`bash` turn, reads the just-changed file back off disk and runs `node --check` / `ast.parse` / `JSON.parse` on it (`micro-gate.ts:78-84`), deterministically confirming the mutated file parses, independent of the edit tool's own success claim. |
| 5 | **Postcondition receipt** | The claimed outcome matches an independent read-back of the real system of record | Nothing further within this task — this is the ceiling | `validate_search_receipt` (`trajectory_check.py:52`) cross-checks the rung-3 receipt's `sha256`/`size_bytes`/`total_lines_scanned` fields against `file_facts()` (`:21`) computed fresh from the actual corpus file on disk at check time — not trusting the tool's self-report, reading the real file. |

## Why this ordering, not a flat "receipt vs. no receipt" split

Each rung closes a specific forgery/error surface the one below leaves open.
Testimony can be produced with no tool access at all. Invocation requires the
harness to actually route a real tool call, but the call's own arguments are
whatever the model wrote — nothing yet confirms the tool ran or ran cleanly.
An execution receipt closes that gap (the execution layer, not the model,
produced it), but a buggy or lying tool implementation could still emit a
receipt that doesn't match what actually happened on disk. A state-change
receipt closes that for *local* mutations by reading the file back. A
postcondition receipt goes one step further and independently recomputes the
expected facts from the real system of record rather than trusting any
component's self-report — the strongest evidence this codebase currently
produces. `check_t4`/`check_sv_ambiguous_spec` stop at rung 2 (well, 2+3 — see
above) because rung 2 is sufficient for what they're testing: *did the model
choose to delegate / declare uncertainty*, a fact about the model's behavior,
not about some downstream artifact's correctness. `check_bigdata` needs rungs
3 and 5 because its claim — *the file was actually, exhaustively scanned* — is
a fact about the world that no amount of argument-only or narration-only
evidence can establish.
