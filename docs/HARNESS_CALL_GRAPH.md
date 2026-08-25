# The Pi Munchkin Harness as a Call Graph

> **Provenance.** Authored by the Aug 20–22 pi session (archived at
> `~/Desktop/pi-session-2026-08-20_harness-improvements/`) from two sources: NVIDIA's AVO
> architecture (arXiv 2603.24517 + technical blog) and Khairallah AL-Awady's "How to Become a
> Graph Architect With Zero Experience" (the 20-step course, 2026-07-31). Imported into the repo
> 2026-08-24 per the course's own Step 20 — *"document the graph so someone else could maintain
> it"* — after verifying its file inventory (11/11 named modules exist) and updating the sections
> reality moved past. Update this document when the graph itself changes; its per-file claims are
> checkable and were checked.

## Primary-source review: the AVO system itself (2026-08-24)

The NVIDIA blog (Aug 21 2026) and arXiv 2603.24517 were reviewed directly, not only through the
session's reading. The primary source confirms the dispositions in this document and HANDOVER, and
converges with three standing rules of this repo — independently arrived at on both sides:

1. **"Evaluating a model is not the same as evaluating an agent."** NVIDIA states their own
   headline (Opus 5: 30% model baseline → 100.00 RHAE inside AVO) is *"not a controlled
   ablation... not a direct measurement of the performance contribution of AVO."* That is this
   repo's measurement doctrine verbatim: the harness is the instrument, cross-system comparisons
   are not ablations, and no adoption claim follows from an uncontrolled delta.
2. **Efficiency is the score, not just completion.** RHAE combines completion with per-level
   ACTION efficiency vs human baselines (AVO: 6,624 actions; VISTA: 7,542 on the same levels).
   This repo made the same pivot on 2026-07-27 — pass/fail does not measure the efficiency
   target — and `effort_report`'s continuous outcomes (turns, tool calls, tokens) are the local
   RHAE analogue.
3. **The harness must be model-independent.** AVO runs Opus 5 and GPT-5.6 Sol with complementary
   operating profiles; the standing rule here ("models are measurement instruments") is the same
   design constraint. Slow-local request survival is governed by Pi's `httpIdleTimeoutMs`; the
   separately loaded `provider-patience` probe was later measured inert inside Pi sessions.

One confirmation specific to this batch: NVIDIA's supervisor description — *the main agent
remained responsible for deciding what to inspect, change, test, and evaluate, while the
supervisor helped maintain forward progress when the search plateaued* — is exactly the shape of
the `VERIFICATION_PLATEAU` enforce tier adopted 2026-08-24: an observation plus "obtain one
discriminating fact", never a prescription. Their text-only observation interface (64x64 grid, no
image tokens) and evolutionary lineage (500 directions, 40 committed versions) map to the
(mothballed) optimizer's evaluator-optimizer graph in §8 and stay deferred with it.

## The 20-step course, answered against this harness (2026-08-24)

| Course step | Harness answer |
|---|---|
| 1–4 loop + strict verifier + loop failure modes | The atom (§0) + `verify-gate`/`hashline` (§1b); the four failure modes are why §6–§8's gates, parallel subagents, checkpoints and recovery paths exist |
| 5–8 nodes/edges/state, most nodes NOT LLMs | §§1–3; the deterministic table (§1b) outnumbers the LLM table (§1a), as Step 6 demands |
| 9 one framework, deeply | pi's extension seams — no orchestration framework added, deliberately |
| 10 router | `role-routing.ts` (§2c) |
| 11 orchestrator-worker | the vendored subagent (parallel mode, 1800s child budget since 2026-08-24) |
| 12 fan-out / fan-in | subagent parallel delegation with the self-consistent parallel header |
| 13 evaluator-optimizer | the optimizer (§8) — the one real graph; mothballed with named restart conditions |
| 14 human-in-the-loop gates | §6 — seven of them, kept as gates, not routers |
| 15 validation gates | §7 row 1 |
| 16 recovery paths, not retries | failure-episode classes → tiered steers → blocked walls → `/loop-resume`; capsule recovery briefs |
| 17 checkpoints + resume | `RUN_CAPSULE` — **default `recovery` since 2026-08-24**: checkpoint every settle, inject one bounded brief at compaction/provider-retry |
| 18 observability / replay | typed telemetry (102-event catalog, forbidden-field tripwire), surface receipts, session jsonl replay, trial manifests |
| 19 when NOT to graph | §9 — the spine of this document; the harness is loops + gates + ONE graph, and stays that way |
| 20 evals + docs for the team | `npm run verify` after every change; the (mothballed) measurement doctrine for model-visible adoptions; THIS document |

---

*A design of the harness's runtime call structure, modeled in the "Graph Architect" frame
(nodes = units of work, edges = routing/decisions, state = the info flowing between nodes),
mapped onto NVIDIA AVO's vocabulary (loops, verifiers, conditional edges, orchestrator-worker,
evaluator-optimizer, human-in-the-loop, validation gates, recovery, checkpoints, observability),
and filtered through the "when NOT to build a graph" judgment.*

Reference approach: NVIDIA AVO — *Build agents that learn from their mistakes* (Terry Chen et al.,
Aug 21 2026). Its named primitives: persistent memory, a supervisor that watches the trajectory for
stagnation and redirects, candidate lineage/selection updates, execution-grounded feedback, and
recovery across model invocations. The article's own discipline is the useful lens here: a graph is
a tool for *decision structure*, not a universal property of every loop.

Grounding: this is derived from the harness at `harness/` (extensions + lib) and the README
guardrail inventory in `pi_munchkin-wt/reboot`. The main turn loop itself lives in the parent
`pi-coding-agent` package; the harness instruments that loop at its seams (session-start and
tool-call lifecycle hooks). Everything below describes the harness's contribution to the graph.

---

## 0. The atom — the one loop everything else hangs off

The **main loop is the atom**. It is pi's per-turn cycle:

```
model call  →  dispatch tool call(s)  →  execute tool  →  observe result  →  back to model
```

It is a *tight deterministic dispatch loop* around a single LLM node. The harness never rewrites this
loop; it wraps it. Every harness extension is either (a) a **verifier** that sits inside the tool
execution leg and can *refuse or mutate* an action, or (b) a **side-channel** that reads/writes shared
state as the tool stream passes.

Design rule that follows immediately: **the atom is a loop, not a graph.** It has one decision
(point: does the model emit a tool call or a final answer?) and one back-edge (another turn). Adding
graph nodes here would be a loop in disguise. Keep it a loop.

---

## 1. Nodes — units of work, and whether they need an LLM

Split by whether the node's output requires a model. This is the single most important axis for the
"lazy" judgment: LLM nodes are expensive and are the only ones worth routing as a graph; deterministic
verifiers are cheap and belong inside the loop edges.

### 1a. LLM nodes (expensive, the only ones that earn graph routing)

| Node | File(s) | Needs a model | Role in the graph |
|---|---|---|---|
| **Primary model call** | `ketch.ts` (parent), instrumented by every extension | yes | The central hub of the atom |
| **Subagent task** | `subagent` ext, `harness-signals.ts` (EventBus) | yes | Orchestrator-worker child |
| **Role routing** | `role-routing.ts` | yes (routing decision) | Router node |
| **Did-you-mean** | `did-you-mean.ts` | yes (classification) | Conditional edge / router |
| **Teaching hints** | `teach-hints.ts` | yes (one-shot nudge) | Optional side-edge |
| **Plan generation** | `plan-runner.ts` | yes (model owns items) | Graph builder for the plan sub-graph |
| **Compaction summary** | `compact-tool.ts` | yes (summarise self) | Recovery/checkpoint node |
| **Dynamic activation decision** | `tool-activation.ts` | borderline (heuristic; model-evidence gated) | Edge toggle |

### 1b. Deterministic nodes (cheap, belong on edges, not as hubs)

| Node | File | Verdict / purpose |
|---|---|---|
| **hashline edit matcher** | `hashline.ts` | Transactional edit: lands exactly or is refused. A *verifier* on the edit edge. |
| **loop-breaker detector** | `loop-breaker.ts` | Detects repeated calls / reasoning / outcomes / thrown executions / session grinding. A *supervisor* node (see §5). |
| **verify-gate verifier** | `verify-gate.ts` | Accepts work as done only after ordered verification evidence after the latest mutation. The core *validation gate*. |
| **control arbiter** | `control-arbiter.ts` / `control-proposal.ts` | Decides allow / steer / proceed on a control proposal. A *conditional edge*. |
| **bounded planner** | `plan-runner.ts` | Read-only plan entry plus stable-ID structural writes and small progress deltas. It owns intent, never verification. |
| **git-guard** | `git-guard.ts` | Confirms before destructive commands. A *human gate*. |
| **context / bash guards** | `context-inlet-guard.ts`, `bash-output-guard.ts` | Refuse oversized provider-bound I/O. *Verifiers* on the I/O edges. |
| **ketch validators** | `ketch.ts` (publicHttpUrl, redirect checks) | URL / redirect validation on the web-search edge. *Verifiers*. |
| **run-kernel state machine** | `run-kernel.ts`, `run-kernel-state.ts` | Canonicalizes lifecycle/tool events into a typed per-run state machine. A *finite state machine*, not an open graph. |
| **blackboard renderer** | `session-blackboard.ts` | Bounded redacted summary + private cockpit. *Persistence* node. |
| **telemetry recorder** | `telemetry.ts`, `telemetry-writer.ts`, `surface-receipt.ts` | Records that a mechanism fired (counts only) + exact harness provenance. *Observability*. |
| **drift scanner** | `drift-scanner.ts` | Reviews manifest drift. *Validation gate* (human). |

---

## 2. Edges — routing and decisions

Edges are where control branches. The harness's entire design philosophy lives here: **branch points
are explicit, reversible, and mechanism-observed.**

### 2a. Conditional edges (the decision structure)

| Edge | Branch condition | Node | Source → target |
|---|---|---|---|
| verify-gate pass/fail | ordered verification evidence present after latest mutation? | `verify-gate.ts` | done ⇐ pass · model ⇐ fail (back-edge) |
| hashline land/refuse | unique anchor matched? | `hashline.ts` | file ⇐ landed · model ⇐ refused (back-edge) |
| loop-breaker activate | same action repeated past threshold? | `loop-breaker.ts` | steer ⇐ yes · continue ⇐ no |
| loop steer outcome | did the steer change behaviour? | `loop-outcome.ts` / `loop-recovery.ts` | recover ⇐ yes · escalate ⇐ no |
| control arbiter | proposal within allowed control domain? | `control-arbiter.ts` | allow / steer / proceed |
| did-you-mean | ambiguous spec detected? | `did-you-mean.ts` | clarify ⇐ yes · proceed ⇐ no |
| role routing | task matches a role? | `role-routing.ts` | role ⇐ yes · primary ⇐ no |
| dynamic activation | session shows need (evidence)? | `tool-activation.ts` | expose ⇐ yes · hide ⇐ no (toggle edge) |
| capability switch | requested specialist family is allowed in this phase? | `tool-activation.ts` | add family ⇐ yes · preserve surface ⇐ no |
| git-guard | command could discard uncommitted work? | `git-guard.ts` | confirm ⇐ yes · run ⇐ no |
| context/bash guard | input/output oversized? | guards | refuse ⇐ yes · pass ⇐ no |

### 2b. Loop edges (back-edges)

Every back-edge returns to the model or to an earlier node — these are the *loops* the article warns
about when unmanaged, and the *supervised loops* when they have a verifier:

- **edit-retry loop:** model → hashline refused → model (bounded by hashline's all-or-nothing)
- **verify loop:** model → verify-gate fail → model (the critical gate; without it, "done" is a lie)
- **steering loop:** model → loop-breaker steer → model (supervisor redirect)
- **plan loop:** model → plan-runner (add/complete items) → model (model-owned, not a trap)
- **compaction loop:** model → compact_context → model (with one resume handoff)

### 2c. Router pattern

`role-routing.ts` is the one pure **router** node (the article's "decide which specialized agent
handles this input"). `did-you-mean.ts` is a conditional-nudge router. Everything else routes on a
binary verifier, not a K-way router — so there is no fan-out graph, just gated edges.

---

## 3. State — the info flowing between nodes

State is the shared context that each node reads and writes as the tool stream passes. The harness
keeps this **bounded and redacted by design** (a persistent-memory discipline, not an unbounded
accumulator).

| State | File | Carries | Reader / writer |
|---|---|---|---|
| **Tool-call stream** | (atom) | the raw per-turn action log | every verifier reads it; never persisted verbatim |
| **Run kernel** | `run-kernel-state.ts`, `run-kernel.ts` | typed per-run event record (redacted) | run-kernel writes; audit / recovery read |
| **Working memory** | `working-memory.ts` | bounded per-run notebook (model-authored hypotheses) | model writes/lists via explicit tool calls; dark (`WORKING_MEMORY=off`); NEVER injected into context automatically |
| **Plan state** | `plan-state-storage.ts`, `plan-runner.ts` | structured intended work + item status | model writes; plan-runner reads; verification remains session-owned |
| **Blackboard** | `session-blackboard.ts` | bounded redacted session summary | writes persist; cockpit reads |
| **Context surface** | `context-surface.ts` | which surface mode is active | read by context-inlet guard |
| **Failure episodes** | `failure-episodes.ts` | semantic-failure tracking for steering | loop-breaker / arbiter read |
| **Telemetry** | `telemetry.ts` | mechanism-fire counts | every mechanism writes; reports read |
| **Surface receipt** | `surface-receipt.ts` | exact harness build provenance | written once per load; reports read |
| **Run capsule** | `run-capsule-store.ts`, `run-capsule-renderer.ts` | checkpoint snapshot | write on capsule; `/run-resume` reads |

**Flow discipline (the AVO persistent-memory parallel):** AVO keeps persistent memory as the
conversation history itself (accumulated edits, compiler output, profiling, reasoning). The harness
does the same thing *plus* a bounded redacted projection — the kernel, blackboard, and working memory
are *derived views* over the tool stream, not a parallel truth. This is the safe shape: persistent
memory is real (the history), the projection is bounded and untrusted (model-authored, not
instructions).

---

## 4. Mapping onto AVO's vocabulary

| AVO primitive | Where it lives in the harness |
|---|---|
| **Persistent memory** | deterministic run capsules plus external observational memory recall; neither owns plan status or verification |
| **Supervisor that watches for stagnation and redirects** | `loop-breaker.ts` (detects repeated failing actions) → `loop-recovery.ts` (redirects) |
| **Candidate lineage / selection updates** | the optimizer (`optimizer/`: `grade_reporter.py`, `real_gate.sh`, `trial_validity.py`) — currently *mothballed/rebooted, not live* |
| **Execution-grounded feedback** | `verify-gate.ts` (feedback only after real verification after the edit) + hashline (edit grounded in actual file change) |
| **Recovery across model invocations** | `recovery-brief.ts`, `run-capsule.ts`, `/run-resume` |
| **Scoring function f and knowledge base K** | the optimizer's grader + `prompt-lab/` (judge_render, rft_harvest) — design-parity only, not running |

The harness already implements 5 of AVO's 6 primitives as *reversible extensions*. What it does **not**
have, and what the article implies a mature system needs, is a **live candidate-lineage loop** (the
evaluator-optimizer) — that's the one gap.

---

## 5. The supervisor pattern (the article's centerpiece) — and its one weak spot

`loop-breaker.ts` → `loop-outcome.ts` → `loop-recovery.ts` is the harness's supervisor: it watches the
trajectory for stagnation (repeated failing action) and redirects the model. This is exactly AVO's
supervisor.

> **RESOLVED 2026-08-24.** The forward-progress guard this section asks for already existed as
> `VERIFICATION_PLATEAU`'s enforce tier (steer at 3 successful-mutation epochs with no frontier
> advance) and is now the DEFAULT (Albert-approved judgment adoption; `=shadow` is the rollback).
> The original weak-spot analysis is kept below because it is the reasoning that motivated the flip.

**Weak spot to design next (historical):** the current supervisor reacts to *repeat count* (a proxy for
stagnation), not to a *forward-progress metric*. AVO's supervisor guards forward progress. The natural
upgrade is: attach a bounded progress signal (e.g. `semantic_failure_overrun` from `failure-episodes.ts`,
or latest-blackboard-diff delta) and let the breaker trigger on *no forward progress across N turns*,
not just *same action N times*. That's a single edge-condition change, not a graph rewrite — see §7.

---

## 6. Human-in-the-loop gates

These are the nodes whose "execution" requires a human. They are the **only** edges that cross the
machine→human→machine boundary.

| Gate | File | What it gates |
|---|---|---|
| **verify-gate human** | `verify-gate.ts` | treats work done only after human-visible ordered verification |
| **session verification** | `verify-gate.ts` / `verify_project` | one exact project gate after the latest mutation |
| **git-guard** | `git-guard.ts` | destructive-command confirmation |
| **secret-scan** | `optimizer/real_gate.sh` / `secret-scan.ts` | push safety (public repo) |
| **mirror:check** | `live-mirror.ts` | live-harness mirror integrity |
| **drift-scanner** | `drift-scanner.ts` | manifest drift review |
| **the governor** | `APPEND_SYSTEM.md` | plan workflow, delegation, Done/Blocked reporting |

Design note: these are **gates, not branches.** A gate is a single-edge chokepoint, not a fan-out.
Keep them as gates — adding routing around a gate is a graph pretending to be a decision.

---

## 7. Validation gates, checkpoints, recovery, observability

| Category | AVO term | Harness nodes |
|---|---|---|
| **Validation gates** | validation gate | verify-gate, hashline matcher, bash/context guards, ketch validators |
| **Checkpoints / persistence** | checkpoint | run-kernel snapshot, working-memory, blackboard, plan-state, run-capsule-store |
| **Recovery paths** | recovery | recovery-brief → run-capsule → `/run-resume`; loop-recovery |
| **Observability** | observability | telemetry (mechanism counts), surface receipt (provenance), blackboard cockpit, runtime-truth |

The recovery path is a small **branch**: normal → (recovery-brief on failure) → capsule checkpoint →
resume. It's a branch because there's a real decision (did we fail hard enough to checkpoint?), not a
loop. Keep it a branch.

---

## 8. The evaluator-optimizer sub-graph (currently dormant)

The optimizer is the only place a *second* graph exists: **evaluator-optimizer**.

```
fixture (candidate) → run under gate (real_gate.sh) → grade (grade_reporter.py)
    → verdict (judge) → report (effort_report.py) → admission / reject → next candidate
```

Files: `optimizer/real_gate.sh`, `optimizer/grade_reporter.py`, `optimizer/trial_validity.py`,
`optimizer/prompt-lab/` (judge_render, rft_harvest, trajectory_check). This is AVO's candidate
lineage/selection loop in miniature. It is **mothballed again (2026-08-21 — see
`optimizer/docs/MOTHBALLED_2026-08-21.md`)**: the instrument is validated and preserved; no rounds
run until its restart conditions are met.

**Graph-judgment:** this is the *right* place for a graph — it has genuine multi-candidate routing,
selection, and lineage. It is the wrong place to *add* graph structure to the main harness loop, where
there are no decision points to justify it.

---

## 9. "When NOT to build a graph" — the lazy judgment

The article's discipline is the deciding factor. A graph is justified only where there is real
decision/routing structure. Applying that:

**Keep as loops (do NOT graph):**
- The atom (main turn loop) — one decision, one back-edge.
- Edit-retry loop — hashline is all-or-nothing; a 2-node retry loop.
- The verify loop — a single gate, not a fan-out.
- The run-kernel — a *finite* state machine (bounded event types); model as an FSM, not an open graph.
- Did-you-mean / teaching hints — one-shot nudges on a single edge.

**Keep as gates (do NOT graph):**
- Every human gate, every validation gate — chokepoints, not routers.

**Graph is justified (do build / extend):**
- The optimizer evaluator-optimizer loop (real lineage/selection).
- Role-routing (a genuine K-way router).
- The supervisor (loop-breaker → recovery) *if* upgraded to a forward-progress guard (§5).

**The tell that a graph is pretending to be a loop:** if every "node" has exactly one successor and one
predecessor except at a binary verifier, it's a loop — simplify to a loop. The harness, read honestly,
is mostly loops and gates with *one* real graph (the optimizer) and *one* router (role-routing). That
is the correct shape.

---

## 10. The call graph, drawn (atom + supervisor + gates)

```
                         ┌────────────────────── atom (loop, not a graph) ──────────────────────┐
                         │                                                                        │
                         │   [model] ──tool call──▶ [verifier leg]                               │
                         │        ▲                    │                                          │
                         │        │                    ├─ hashline (edit lands or refuses)        │
                         │        │                    ├─ context/bash guard (oversized?)         │
                         │        │                    ├─ ketch validator (url/redirect?)         │
                         │        │                    └─ git-guard (destructive? → human)        │
                         │        │                                                         │     │
                         │        │                    [loop-breaker] ◀── observes stream       │     │
                         │        │                        │ yes                              │     │
                         │        │                        ▼                                  │     │
                         │        │              [steer] ──▶ [model]  (back-edge)             │     │
                         │        │                                                         │     │
                         │        │                    [verify-gate] ◀── latest mutation      │     │
                         │        │                        │ pass                     fail │     │
                         │        │                        ▼                              ▼     │
                         │        │                   [done] ◀────────── [model] (back-edge)   │
                         └────────────────────────────────────────────────────────────────────┘

        side-channels (read/write state as stream passes):
          telemetry · surface-receipt  · run-kernel (FSM)  · working-memory  · blackboard
          · plan-state  · failure-episodes  · compaction (→ recovery capsule)

        human boundary: verify-gate · plan review · git-guard · secret-scan · mirror:check · drift · governor

        separate graph (the ONLY real one):  optimizer: fixture → gate → grade → verdict → report → admit/reject
```

---

## 11. Recommended design moves (only the cheap ones)

1. **Supervisor → forward-progress guard (§5).** Change `loop-breaker`'s trigger from *repeat count*
   to *no forward progress across N turns* using an existing signal (`semantic_failure_overrun` or
   blackboard diff). One edge-condition change. Highest-impact, lowest-diff.
2. **Do not graph the atom or the gates.** Resist the article's temptation; the harness is already
   the correct shape (loops + gates + one optimizer graph).
3. **If a graph artifact is wanted, draw the optimizer lineage** — it's the only place the graph
   mental model earns its keep.

> **STATUS 2026-08-24:** recommendation 1 is implemented and live (the plateau enforce default);
> recommendation 2 is honored (no routing was added anywhere); recommendation 3 stays deferred with
> the mothballed optimizer. Additionally `RUN_CAPSULE=recovery` is now the default (the checkpoint →
> resume branch in §7 actively injects its brief), and a deterministic node was added on the
> provider edge (`provider-patience.ts`) — and then found INERT in Pi sessions on 2026-08-24. It
> has now been retired from the runtime surface. Pi installs npm-undici's fetch with its own
> dispatcher; the 300s wall was Pi's `httpIdleTimeoutMs` (default 300,000ms), now raised to
> 1,800,000 in the live settings. A lesson in this document's own Step-6 spirit: the deterministic
> fix was a SETTING, not a node.
