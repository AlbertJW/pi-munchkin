# Preregistration: Qwen 35B planner-graph mechanism smoke (2026-09-02)

## Status and purpose

**EXECUTED — invalid/incomplete 2026-09-02.** The semantic-loop candidate has
been explicitly retired from the near-term Qwen queue, so this isolated smoke
tests the next dark candidate: hierarchical planning for deep research. It
does not compare answers, measure research quality, or authorize either flag.
The larger planner screen remains blocked until purpose-built research fixtures
and a paired negative-control design are admitted.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source branch: `codex/qwen35b-provenance`
- Source tip: `80bf330`
- Package source surface SHA-256: `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi surface SHA-256: `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Model-registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`

The smoke runs in a disposable private agent directory and project workspace.
Its prompt, transcript, and raw telemetry remain outside Git. The current
mirror remains unchanged and the router must be idle before launch.

## Treatment and bounded question

Run one candidate-only session with `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, and `RESEARCH_LEDGER=on`; all other dark flags stay
off. Ask a comparative, two-branch public-source question with at most one
search and one read per branch, then require parent synthesis and settlement.
The prompt is hashed in the private receipt; no source text or URL is retained
in the repository.

The smoke passes its mechanism check only if the session emits exactly one
`plan-runner/research-start`, each branch reaches a terminal validated report,
the parent records one settlement after evidence validation, total usage stays
within the declared three-search/five-read envelope, and no child mutates the
parent capsule. A proposal or pending graph without settlement is incomplete.

## Stop and interpretation rules

Stop on identity drift, malformed telemetry, budget inflation, depth violation,
duplicate/missing settlement, unverified child evidence, or a timeout. A clean
mechanism pass proves only that the graph can be reached and closed on this
subject; it does not justify enabling `PLAN_GRAPH` or
`DEEP_RESEARCH_PLANNING`, and it cannot seed an efficacy decision. A failure is
diagnostic subject/fixture evidence and must not be pooled with prior planner
runs on another surface.

## Follow-up

If the smoke is clean, author and admit three research fixtures (comparative,
contested, and multi-part with a real gap) plus fact-lookup negative controls,
then issue a six-session mechanism preregistration. If it does not settle,
keep the flags dark and redesign the prompt envelope before any longer run.

## Execution receipt

The first attempt used `--tools`, which correctly preserved explicit manual
selection but made the planning family unavailable; this was a harness-surface
configuration error, not model evidence. A corrected ambient run then emitted
one `plan-runner/research-start` and created two pending schema-v5 branches, but
produced no branch merge or settlement and ended with an open plan after an
unbounded tool-call stream. The session itself settled with one failure-episode
summary and no raw research payload was retained.

The corrected run is **invalid for this preregistration** because its disposable
agent copy had surface hash
`4f5516aa8eda4fbedd599e4c0860d81ba1b48cb809964a02d6df71e5ef525ba0`, not the
frozen live-mirror hash above. Its graph/lifecycle events are retained only as a
diagnostic lead; they cannot count as planner exposure or quality evidence.
The planner flags remain dark. Before any longer run, reproduce against the
exact mirrored surface (or issue a new preregistration for a fully content-
identical disposable copy), add admitted research fixtures and fact-lookup
controls, and enforce an outer wall-clock/stream-size bound.

## Exact-copy probe and launcher boundary

A follow-up disposable copy was made directly from the live mirror and resolved
to the frozen loaded hash `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
The probe then emitted one `plan-runner/research-start` and two pending branches,
but no branch merge or parent settlement before observation stopped. It is
**incomplete, not mechanism evidence**; the probe predates the reusable bound and
its private transcript remains outside Git. Commit `07f555a` adds
`optimizer/v2/planner_smoke.py`, which verifies this hash before launch, requires
an explicit `--run`, caps combined stdout/stderr bytes, terminates the complete
process group on wall timeout or cap, and emits only safe counts/classifications.
Use that launcher for the next preregistered run.

## Bounded exact-surface run receipt

The first run through `planner_smoke --run` used the frozen loaded surface and
returned a safe `pi.planner-smoke/v1` result after 52.667 seconds: `reason` was
`output_cap`, `exit_code` was 143, combined stdout/stderr was exactly 350,000
bytes, and stderr was zero bytes. Telemetry contained one
`plan-runner/research-start`, one `plan-runner/ended-open`, one failure-episode
settlement, and no branch merge or plan settlement; the project graph still had
two pending depth-one branches. Tool execution reached one `capability`, one
`research_plan_start`, and one `bash` call before the bound. This is a valid
bounded-run/lifecycle receipt but an **incomplete mechanism result**, not an
efficacy result. The new launcher prevented another unbounded session; keep the
flags dark and do not count this run toward the six-session mechanism gate.

A second bounded run used a stricter scripted sequence and the same exact
surface. It also reached the 350,000-byte cap, after 131.258 seconds with zero
stderr. Safe telemetry recorded one `research-start`, two `ended-open` notices,
one `branch-failed` with `failure_class=child_failed`, and one research summary;
the graph remained at two depth-one branches (`blocked`, `pending`) with no
branch merge or parent settlement. The model made three capability calls, one
`research_plan_start`, and one `subagent` call before the cap. This is a useful
child-failure diagnostic and bounded lifecycle receipt, but it is still an
**incomplete mechanism result** and does not count toward the six-session gate.

## Child-failure diagnosis and new surface boundary

The `child_failed` result has a concrete protocol cause, not an inference about
Qwen's research ability. `branch_plan` wrote the exact depth-two contexts to its
private details object, but its model-visible result text omitted those contexts
while instructing the planner to copy them into each `research-scout` call. The
model consequently dispatched a scout without `plan_context`; the existing
fail-closed wrapper correctly rejected that call and marked the owning branch
failed. Commit `10b3faa` repairs the transport and adds a deterministic red-green
integration test asserting that the child ID, depth, and owner reference appear
in model-visible content.

This is a new model-visible source boundary with source hash
`043f35a8f6358616a9cd9eec65fafbc734b127b2f410a9034435b366ad950dfd`. The live
mirror and the frozen preregistration above still identify the prior loaded hash
`251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`; neither
bounded run may be pooled with a rerun after rollout. Re-prepare this smoke
against the new loaded hash before collecting any planner mechanism or quality
evidence. The planner flags remain dark.
