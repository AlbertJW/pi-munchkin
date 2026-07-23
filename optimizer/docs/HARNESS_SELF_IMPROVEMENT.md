# Harness Self-Improvement: Surfaces, Benchmarks, and the Loop

How to loop the pi.dev harness (`~/.pi/agent`) against benchmarks to iteratively improve it. Research on
AlphaEvolve / Karpathy autoresearch / Ralph, mapped onto what the harness already has. Date: 2026-06-19.

**Bottom line:** the *loop* already exists — `ralph.sh` (iterate→gate→poison-pill), `prompt-lab/promptlab.py`
(deterministic single-shot evaluator + Wilson-CI decision rule), `ab-symbolect.sh` (agentic A/B + session
metrics). The research playbook (AlphaEvolve, PromptBreeder, DSPy) is over-build for a solo harness; the
universal verdict is *"Ralph + a cheap auto-gradable eval = 80% of the value,"* and that 80% is built. What
was missing is **standard, hard-to-game benchmarks** plugged into the evaluator, and an **automatic judge**
for the surfaces execution can't grade. This doc adds the first deterministic benchmark (text-to-SQL) and a
frontier pairwise judge.

---

## 1. The rule that governs everything: the benchmark class decides the surface

The single precondition every source agrees on: **the evaluator must be cheap, automatic, and hard to game.**
Its corollary is the one that bit the original plan — *what you benchmark decides what you can improve, and
the classes don't overlap.*

| Surface (what you tune) | Knobs | Benchmark class that moves it | Score |
|---|---|---|---|
| **Prompt / governor** | `APPEND_SYSTEM.md`, reasoning budget, `agents/{explorer,executor,verifier}.md` | **single-shot** Q→answer (text-to-SQL, HumanEval, GSM8K) | deterministic execution (exec-accuracy) |
| **Harness machinery** | `loop-breaker.ts` `LB_*`, `verify-gate.ts` `VERIFY_GATE_*`, `plan-runner.ts`, subagent routing | **agentic, multi-turn, test-gated** task suite (the `ab-symbolect` pi-test fixture pattern) | gate-pass + turns / edits / tokens |
| **Soft dimensions** (any surface) | answer quality, "minimal vs over-engineered" diff, prose effects | either class, but the *quality* signal needs judgment | **frontier pairwise judge** (this doc) |

A single-shot SQL query **never exercises the harness machinery** — loop-breaker, verify-gate and plan-runner
sit idle, so their thresholds show pure noise. SQL tunes the *prompt*, not the *harness*. To tune the
machinery you need agentic tasks. Hence two distinct builds.

---

## 2. Existing infra = the loop (reuse, don't rebuild)

| Piece | File | Role in a self-improvement loop |
|---|---|---|
| Iterate→gate→poison-pill loop | `ralph.sh` (`~/LLM`) | fresh-context Ralph loop: `pi -p` per iteration, deterministic `--gate`, `--progress` stall halt. The loop body. |
| Single-shot evaluator | `prompt-lab/promptlab.py` | HTTP to llama-server `:8080`, n reps/cell, deterministic scorers, **Wilson-CI decision rule**. The prompt-surface evaluator. |
| Agentic A/B + metrics | `ab-symbolect.sh` (`~/LLM`) | headless `pi --approve` per arm, independent `node --test` gate, metrics parsed from session jsonl (turns/edits/tokens). The machinery-surface evaluator. |

The adopt/reject decision is already statistical (Wilson CIs, non-overlapping) — no human needed for
executable surfaces.

---

## 3. Rejected (ponytail) — over-build for a solo harness

| Pattern | Why skip |
|---|---|
| **AlphaEvolve** | production evolutionary search over a population w/ a fast hardware fitness; needs scale + a narrow continuous metric. Steal only the *structure*. |
| **PromptBreeder** | self-referential prompt evolution; needs 100s of labeled examples and sub-2s eval, overfits a held-out set. |
| **DSPy / MIPROv2** | credible but ~hundreds of lines for prompt-program optimization; only pays with a large labeled set + cheap eval. |
| **Auto mutate→select loop** | reward-hacking + benchmark-overfit risk; the research calls full auto-evolution overkill solo. Manual/statistical adoption is the pragmatic choice. |

Golden rule kept front-and-center: **cheap, automatic, hard-to-game eval; an LLM judge only where execution
can't grade.**

---

## 4. Built now (prompt surface)

### Deterministic text-to-SQL eval — `prompt-lab/sql_eval.py` (+ `sql/schema.sql`, `sql/questions.json`)
- **Execution is the judge.** Model emits SQL → run it against an in-memory copy of a small SQLite fixture →
  compare the result set (multiset) to the gold query's result set. No human, no LLM judge.
- A "variant" is a system-prompt arm: `A` = live `APPEND_SYSTEM` governor, `F` = none, `--prompt-file P=path`
  for arbitrary. The delta is purely the system prompt → answers *"does our always-on coding governor help or
  hurt text-to-SQL?"*. Reuses `promptlab.chat` / `wilson` / `GOV`.
- Self-contained fixture (4 tables, ~20 curated questions, gold result sets computed at runtime so they can't
  drift). `ponytail:` swap Spider-dev / Defog sql-eval behind `questions.json` for more coverage.
- Verify: `./sql_eval.py --selftest` (no server). Live: `./sql_eval.py sql0 --variants A,F`.

### Frontier pairwise judge — `prompt-lab/judge.py` (+ `soft/questions.json`)
- For **non-executable** dimensions only. Pairwise A-vs-B, **randomized order** to cancel position bias;
  malformed verdict → tie (conservative). Layer on top of deterministic scoring, never the sole signal —
  judges have position/verbosity/self-preference biases.
- Frontier endpoint via env (`FRONTIER_BASE_URL` / `FRONTIER_API_KEY` / `FRONTIER_MODEL`=gpt-5.5); no
  auth-store parsing. The harness already calls a frontier model the same way (`extensions/drift-scanner.ts`
  → `completeSimple(gpt-5.5)`).
- Immediate consumer: ~6 open-ended coding/explain prompts (`soft/questions.json`), governor `A` vs `F`,
  reports win-rate + Wilson CI.
- Verify: `./judge.py --selftest` (no network). Live: `FRONTIER_API_KEY=… ./judge.py judge0 --variants A,F`.

---

## 5. Built now (harness-machinery surface)

### Agentic env-arm sweep — `ab-machinery.sh` (+ `ab-machinery/metrics.py`, `ab-machinery/judge_diffs.py`)
Reuses `ab-symbolect`'s agentic pattern (headless `pi --approve` on the pi-test fixture, independent
`node --test` gate, session-jsonl metrics) but the arm axis is an **env-knob profile**, not a prompt header —
so the governor + extensions are held constant and *only* the machinery knobs differ. Because arms don't
mutate any global files, it drops ab-symbolect's agent-md swap, git-clean precondition, and restore trap.
- Arms: `ARM=baseline` (old cloud loop-breaker thresholds) vs `ARM=tight` (the new local defaults, commit
  `c980909`), forced explicitly via `LB_*` env so the comparison is independent of model-class detection
  (`thresh()` lets explicit env win). `ARM=custom` uses whatever `LB_*`/`VERIFY_GATE_*` you export.
- Score: gate-pass + `turns/edits/edit_err/reads/subag/in_tok/out_tok`, plus the machinery-specific
  **`lb_fires`/`vg_fires`** (loop-breaker / verify-gate steer counts, parsed from the session).
- `judge_diffs.py` reuses `judge.py`'s `judge_pair` for "solution quality beyond gate-pass": diff each arm's
  final `src/` vs the pristine fixture and judge which change is cleaner/more minimal (needs `FRONTIER_*`).
- First motivated use: **validate the `c980909` loop-breaker tune** on real tasks. **Caveat:** loops are
  stochastic and effect sizes are small with a local model + few tasks — this is a measurement/regression
  substrate, not a guarantee of strong signal. If t1–t4 show no fire signal, add loop-inducing tasks.
- Verify: `metrics.py --selftest`, `bash -n ab-machinery.sh` + `ARM=tight ./ab-machinery.sh --dry`,
  `judge_diffs.py --selftest` (all no-server/no-network). Live: `ARM=baseline ./ab-machinery.sh` then
  `ARM=tight ./ab-machinery.sh`, compare the two `results.tsv`.

---

## 6. Multi-model generality — tuning for the fleet, not one model

Goal: tune the harness for GENERAL use across a model fleet, not just the daily driver. A setting that helps
one model but hurts another is a model-specific hack; one that helps across the fleet is a real improvement.

**Fleet & the single-port reality.** Fleet = `qwen36-35b-iq3s` (daily driver / **hard gate**, large),
`mellum2-12b-thinking` (small), `qwopus35-9b-coder` + `gemma4-26b-apex` (mid). All `run-*.sh` share `:8080`, so a sweep is **sequential
model loads**, not parallel. `fleet-eval.sh` sequences it (launch `run-<alias>.sh` → wait `/health` → eval
auto-tags by the loaded alias → `stop-llama.sh` → next). It runs **two surfaces** per model: `sql_eval`
(deterministic capability probe → `results/<gen>-sql.jsonl`) and `promptlab` governor/role tasks — hashline
edit, ws-trap, brevity, explorer/verifier, the real governor signal → `results/<gen>-gov.jsonl` — restricted
to the `A,F` patterns (governor on vs off). `--dry` previews, `--no-launch` evals whatever's already up.

**Unblock (what made it model-aware).** `promptlab.server_model()` reads the loaded alias from `/v1/models`
(the body `model` field is cosmetic to llama-server, so the loaded alias is the real signal); both `sql_eval.py`
and `promptlab.py` tag every row with `model` + `split`, are resumable per `(task, variant, rep, model)`, and
take `--model`/`--patterns` so a fleet sweep stays cheap and distinguishable.

**The do-no-harm decision rule** (`fleet_report.py`, pure `decide()` + Wilson CIs):
- **REJECT** if the daily driver regresses at all (HARD GATE), or any model regresses > do-no-harm threshold
  (`FLEET_DONO`, default 3%), or win-rate < 60%, or validation→held-out uplift decay > 10% (overfit).
- else **ADOPT-TIERED** if the gain tracks capability (smaller models gain, daily flat) — maps onto
  loop-breaker's existing `thresh()` tiers; else **ADOPT-UNIVERSAL**.
- Overfit guard via the **held-out split** (6/20 SQL questions marked `heldout`): the rule compares
  candidate-vs-baseline uplift across splits: `(cand−base)_val − (cand−base)_heldout`. Raw validation
  vs held-out accuracy is not comparable when the splits contain different tasks.

**Universal vs capability-tiered surfaces** (what may vary by model):
- **UNIVERSAL** (one setting, validated across the fleet): the governor (`APPEND_SYSTEM.md`), role prompts
  (`agents/*.md`), verify-gate logic, command-policy, hashline, drift-scanner — these state contracts/format.
- **TIERED** (per capability class): loop-breaker thresholds (`LB_*`, already split local/cloud via
  `thresh()`), plan-gate timeout, reasoning budget — small models need more scaffolding/slack than large.

**Proposing changes (`propose.py`) — borrowed, not DSPy.** The "what to try next" step combines Karpathy
autoresearch's 6 mutation operators (add-constraint · add-negative-example · restructure · tighten ·
remove-bloat · add-counterexample) with GEPA's reflective mutation: feed failing traces + the current prompt
to a frontier model (reusing `judge.py`'s endpoint), get 1–3 minimal operator-tagged tweaks as candidate
prompt files, then A/B them across the fleet (`sql_eval --prompt-file` → `fleet_report`). **Adoption stays
manual + statistical.** DSPy was deliberately **borrowed, not adopted**: its optimizers compile *per-model*,
which fights the universal-prompt goal, and it's a framework dependency we don't need for manual control. A
one-off GEPA-via-DSPy pass is the named escalation if `propose.py` underperforms.

**Loop:** `fleet-eval.sh` → `fleet_report.py` (verdict) → if more headroom, `propose.py` → A/B candidates →
`fleet_report.py` → adopt by the rule. Verify (no server/network): `fleet_report.py --selftest`,
`propose.py --selftest`, `sql_eval.py --selftest`, `bash -n fleet-eval.sh` + `--dry`.

---

## 7. Principle — emoji/glyph prompting: register tint, not encoding

From the emoji-glyph guide, reconciled with our own measurement:
- **Decision rule:** *would I be unhappy to get a different interpretation on a re-run?* If **yes → use words**
  (the glyph can ride along for tone, but words must carry the load); if **no — just nudging register → a glyph
  is a cheap, repeatable dial.* A glyph reliably tints the *register* (caution / exploratory / skeptical /
  upbeat) via broad, cross-lingual affective associations; it does **not** reliably encode a recoverable
  proposition ("decode this glyph chain" is generation, not decoding — it fails the "same result twice" test).
- **Already settled for the encoding form:** the dense glyph-identity-line style (`explorer ≡ ⟨🔍📖⟩ …`) is
  exactly that overreach, and `AB_SYMBOLECT.md` **measured it and rejected it** (equal correctness, more edit
  errors, +32% bytes). The governor's core job (edit format, verification, scope) is all "unhappy-on-re-run =
  yes" → **words, not glyphs.**
- **What's testable, not assumed:** the guide's narrow reliable use — a single glyph alongside a register
  *word* on an otherwise-unchanged role prompt — is wired as candidate **pattern `R`** in `promptlab.py`
  (role tasks only; `explorer`+🔍, `verifier`+⚠️), distinct from the rejected symbolect encoding. A/B it across
  the fleet: `./fleet-eval.sh --rt` → `fleet_report.py <gen>-rt --baseline A --candidate R`. **Adopt only if it
  wins under the do-no-harm rule.** Prior (symbolect) is negative, so the bar is real.

## 7b. Failure-class instruments (gauntlet + canaries, 2026-07-14)

The reviewer-roadmap pivot: optimize less for "another useful instruction," more for
which deterministic control transition follows each observable failure class. Two
permanent instruments (both selftested; chaos.ts dormant without CHAOS=):

- **canary.py** — 9-case tool-protocol battery, failures attributed to a
  SUSPECTED layer (model/parser/serialization/template — triage hints, not proof;
  audit-2 wording). Scores below are from the STRICT judges (audit-2: value
  verification — wrong cities, missing requested prose, repeated-malformed args
  and Paris-twice all now fail; the 07-13 numbers were permissive):
  **4B 8/9** — the 07-13 "multi-turn tool-history 502s (template)" receipt DID NOT
  REPRODUCE post-power-trip: it was transient server state, not a stable template
  defect (the audit's attribution caution proven with data; per-combo artifacts
  now keyed canary-<model>@<host-port>). Only nested-JSON fails.
  **2B 5/9** — apologizes instead of retrying after tool errors (×2), omits the
  requested prose in text-then-call, mangles nested JSON.
  **gemma-4-e2b qat-q4 6/9** — apologizes after errors (×2), nested-JSON artifact.
  ALL THREE mangle the nested-JSON roundtrip, each differently — the one stable
  cross-model serialization receipt (c17's target list).
- **gauntlet.sh + gauntlet_report.py** — one deterministic fault per known-solvable
  session (5 chaos faults via ~/.pi/agent/extensions/chaos.ts + lying/ghost
  deception fixtures); reports recovery, turns-to-recovery, injection integrity
  (rows whose fault never fired are INVALID, not data), false aborts. N>1 reps
  aggregate (audit-2) and telemetry is per-row EXACT-sk since audit-3 (a gen-run
  prefix pooled reps: one rep's injection could validate an uninjected sibling).
  Methodology lesson from gt1 (caught by the INVALID flags): the chaos task must be
  edit-rich AND in-band — on t1 the 4B renamed via bash/sed and never called edit.

**gt2 baseline (equil, N=1 — directional; both control rows drew fails, so read
TOOL-level recovery + the deception rows, not task pass):**

| fault | 4B | 2B | gemma-4-e2b (qat-q4-mtp) |
|---|---|---|---|
| control | fail (n=1 wobble) | fail (40% task) | **pass** |
| stale-tag | tool back in 8 turns, passed | tool NEVER recovered | passed via TOOL-SWITCH (edit abandoned) |
| edit-noop | tool back in 9 turns, passed | tool NEVER recovered | tool never recovered, failed |
| perm-denied | tool back in 6 turns, failed | tool NEVER recovered | never recovered |
| missing-file | (INVALID gt2; 2-turn rec in gt1) | tool back in 2 turns | INVALID (routed via bash, never read) |
| disconnect | retry in 1 turn | retry in 1 turn | retry in 2 turns |
| lying (deception) | **DETECTED** (twice incl. gt1) | **DETECTED** | **FOOLED** (trusts exit 0; 20k tok) |
| ghost (phantom file) | failed both rounds | **PASSED** | failed |

Findings: (1) recoveries are EXPENSIVE — 6-9 turns and 10-20k tokens even when they
succeed; (2) the 2B's recovery ceiling is protocol-simple faults only (retry-shaped);
anything needing a re-read-then-different-approach protocol (stale-tag, edit-noop,
perm-denied) never comes back; (3) genuine cross-model INVERSIONS everywhere: the 2B
(opus-reasoning distill) beat the 4B on reality-reconciliation (ghost) while losing
protocol recovery; the e2b — best CANARY protocol scores — is the only model FOOLED
by the lying test, so protocol fidelity and epistemic vigilance are separate axes;
(4) metric nuance: the e2b "recovered" stale-tag by ABANDONING the edit tool for
bash — turns_to_rec only counts same-tool recovery, so read recovered-vs-turns
together. Candidate implications queued in §8: c18b targets the perm-denied/ghost
class; c21's cheap post-edit check directly attacks the 9-turn edit-noop flail;
anti-deception steers matter for the gemma tier specifically, not the Qwens.

## 8. Queued candidates (untested — awaiting an in-band task set)

Ideas that survived research triage but are **not adopted** — each is one munchkin/A-B candidate,
blocked only on a (model, task) pairing in the discriminating band (see calibrate.py; as of
2026-07 the sole known in-band pairing is qwopus35-9b-coder × h1).

- **From the external audit (2026-07-13)** — measurement-critical items fixed same day
  (gate env scoping, sibling-safe cleanup, run ids, INCOMPLETE/MIXED-SIGNS/TASK-REGRESSION
  verdict gates, honest in/out cost, jnoise file-matched labels + session inference); these
  four were the deferred remainder (all harness support is now built; experimental runs remain where noted):
  1. *Randomized dd1 confirmation* — re-run the governor gradient with arm order
     randomized/interleaved and a contemporaneous baseline; until then "prose harmful on
     capable models" stays a working hypothesis (§dd1 verdicts, scoped 2026-07-13).
     **Harness support LANDED (2026-07-14)**: real_gate's two-arm mode now interleaves +
     counterbalances per (task, rep) cell by default (INTERLEAVE=off for legacy blocks) —
     the confirmation round just needs scheduling. Also landed: munchkin MANIFEST=path
     auto-declares each gen's candidates for fleet_verdict --manifest.
  2. *Real held-out task set* — **BUILT (2026-07-14)**: `HELDOUT="rle saddle"` runs those
     never-selected-on tasks after the main sweep with split="heldout" (refuses tasks that
     appear in TASKS); fleet_report shows held-out uplift decay (difference-in-differences) and
     reactivates the overfit gate ONLY for a complete base+candidate held-out grid. Arms are
     interleaved/counterbalanced just like validation. Opt-in per round (adds |HELDOUT|×N
     sessions/arm). rle+saddle chosen because their fixtures+hidden graders already exist
     and no fleet candidate was ever selected on them.
  3. *Plan-runner integration tests* — **BUILT (2026-07-14, fe80488)**: fake-ExtensionAPI
     harness with REAL exec (genuine ExecResult shape), 7 end-to-end tests covering /plan
     mutation-block arming, plan_write persistence + /plan-go, real-shell gates incl.
     GATE_MAX escalation + mutating-gate rejection, done-omission reattach, agent_end
     abort trace, and micro-gate firing. Writing it caught micro-gate reading r.exitCode
     where ExecResult carries r.code — a would-be silent no-op candidate (c18 class),
     fixed before it cost a measurement round. Suite 119/119.
  4. *Hashline multi-file transactionality* — **DONE (2026-07-14, 799997c; I/O honesty hardened
     2026-07-14)**: apply is now
     two-phase (validate+compute all sections in memory, then commit) so a stale tag / bad
     hunk in a later section leaves earlier files UNTOUCHED. All-or-nothing chosen over a
     partial-apply report (a half-written workdir confuses small models more than it helps).
     Same-file chaining preserved via an in-memory buffer. Integration tests prove atomicity
     (both cases fail on the old sequential-write loop); suite 123/123.
- **From the reviewer roadmap (2026-07-14, instruments shipped — see §7b):**
  1. *c18b locality fallback* — **BUILT (dormant), awaiting measurement**: RETRY_MODE=
     locality in real_gate gives the fresh session task + actual failing `node --test`
     output + an exact localize→one-patch→verify protocol; spec c18b-locality-retry.json
     predicts it beats c18's open-ended note on the re-read-then-different-approach class.
  2. *c21 post-edit micro-gate* — **BUILT (dormant), awaiting measurement**: MICRO_GATE=on
     pi extension (micro-gate.ts + tested policy lib) parse-checks JUST the changed files
     at turn end (node --check / side-effect-free `ast.parse` / JSON.parse, ≤3 files, first actionable error
     as followUp, never the suite). It covers edit/write and statically identifiable shell writes,
     and emits passed/skipped/checker-error telemetry so a candidate cannot be a silent no-op;
     spec c21-micro-gate.json targets the 9-turn edit-noop
     flail. Both measurable in round 5 alongside the still-unmeasured c13/c14/c18 —
     interleaved arms + MANIFEST now standard (see below).
  2b. *c23 trajectory-gate* — **BUILT (dormant), grader-integrity calibration (NOT an A/B)**:
     TRAJECTORY=on ANDs prompt-lab/trajectory_check.py into the gate (bigdata: assert a real
     full-file scan, not a head-peek). Missing session evidence fails closed; executable-name
     heuristics, `readline()`, and `head | wc` do not count as scans. Run base with TRAJECTORY off vs on on the SAME
     bigdata sessions — the pass-rate DROP is the lucky-pass rate. If material, adopt as the
     default grader (do NOT feed through fleet do-no-harm; a stricter honest grader lowering
     the number is the point). One cheap calibration block, not a fleet round. See the
     Pydantic-Evals disposition below.
  3. *Cache observability* — **phase-0 probe DONE (2026-07-14, box router receipts):**
     llama-swap passes `timings` through, incl. `cache_n`. Findings: (a) byte-identical
     back-to-back requests reuse ZERO prefix tokens unless the request sets
     `cache_prompt: true` (then 9/25 reused); (b) `grep cache_prompt` over pi's installed
     code: ABSENT — pi never sets it, so every session on this box build re-evaluates the
     full prompt every turn; (c) even with the flag, conversation-EXTENSION requests stall
     at the 9-token system head (cache_n 9 / prompt_n 27) — reuse does not follow the
     conversation, suspect slot config on the box launcher (flags live on the box).
     c22 INVESTIGATION DONE (2026-07-14): pi-ai has an `onPayload` request hook but
     pi-coding-agent never wires it — NO pi-side path to inject cache_prompt exists.
     POST-UPGRADE PROBES (box now b10002-a7312ae94, 1 slot): the new build reuses
     EXCELLENTLY when asked — identical request with cache_prompt:true reuses 21/25
     tokens (prompt_n 25→4; old build managed 9) — but STILL zero without the flag,
     and llama-swap provably doesn't rewrite bodies (explicit flag passed through).
     Granite caveat: hybrid-SSM models can't rewind recurrent state — zero reuse there
     is architectural, don't use them as cache probes.
     RESOLVED (2026-07-14, user set the box launcher default): pi now gets prefix
     reuse with NO client flag. Conversation-extension probe (the real agent shape):
     old build stuck at cache_n 9; now 32/36 (prefill 27→4). Growing-conversation
     steady state: reuse climbs 39%→51%→65% across turns as the shared prefix grows —
     i.e. every turn after the first stops re-evaluating history. c22 CLOSED as a win;
     no pi-side wiring or shim needed. (First request after a model swap is still cold
     — cache_n 0 — expected.)
  3b. *Read-only memoization* — **REJECTED BY MEASUREMENT (2026-07-14)**: of 4,888
     archived read/search calls, 1,193 (24%) are exact duplicates BUT only 162 (3.3%)
     have no intervening mutation — the rest are hashline-legitimate re-reads after
     edits. An extension + invalidation machinery to save 3% of read calls fails
     cost/benefit. (The reviewer's measure-first rule, applied to the reviewer's item.)
  4. *Palette-fidelity arm* — minimal vs live vs phase-scoped tool palettes; build dynamic
     routing only if the full-palette arm measurably hurts.
  5. *Read-only memoization* — only after telemetry shows duplicate read/search cost.
  6. *Incident → reviewed regression fixture* pipeline — every new production failure
     becomes a minimized, human-approved gauntlet member (the loop learns by expanding
     falsifiable evaluations, not accumulating model-written advice).
  7. *2B gauntlet wing* — gt2 re-run for qwen35-2b-opus-reasoning when the box returns
     (all 8 rows aborted on "no server"; command: MODELS=qwen35-2b-opus-reasoning
     GEN_PREFIX=gt2 GTASK=equil ./gauntlet.sh).

- **Evidence-first claim rule** (from nuclear-grade-context-engineering; operator
  `add-constraint`). Governor line: *"State a result only with the command output that proves
  it; otherwise name the gap."* Hypothesis: cuts small-model done-hallucination.
- **`add-rationale` operator** (from Google Labs design.md's dual-layer format). Append a
  one-line *why* to each governor constraint; hypothesis: rationale improves a small model's
  judgment in applying the rule. Candidate addition to `propose.py` OPERATORS.
- **c24 did-you-mean** (built dark 2026-07-17, DID_YOU_MEAN=on): deterministic
  "closest existing path" appended to read/edit file-not-found errors via the tool_result
  hook. Lens: r/AI_Agents 1uysfe3 "target agents, not humans" — the thread otherwise
  CONFIRMS existing doctrine (deterministic wrenches over prose skills). Targets the
  measured #1 failure trigger (missing-file → wander, b1/r6 traces); the cwd anchor
  treated the wandering (prose), this removes the trigger (mechanical). Must win a round.
- **pi-tasks (@tintinweb, 2026-07-17): pocketed, one candidate extracted.** Not adopted as
  planner substrate — mature task UX + DAG cascade but ZERO verification layer (cascade
  trusts completion claims; plan-runner's engine-run item gates are the point). Pocketed
  candidate: Claude-Code-parity tool names/specs (TaskCreate et al.) — familiar tool shapes
  from training data may raise small-model compliance vs bespoke schemas. A/B-able.
- **evalt (Bryley, 2026-07-17): rejected** for munchkin runs — v0.1.0/2 commits, no
  statistics (no Fisher/A-B/do-no-harm), no fixture admission/provenance, cage sandbox
  self-describes as not-a-security-sandbox (vs kernel Seatbelt + grader read-deny); its
  two-tier model (asserts + LLM reviewer) = real_gate + judge.py already. Watch for its
  multi-harness adapters someday.
- **Plan-block placement/pressure** (anti-signal from r/LocalLLaMA 1unobl4, 2026-07: a Gemma-4
  26B *avoided* its planning tools when a persistent plan block was pinned at the tail of
  context). Evidence-gated: if telemetry shows plan-runner steer non-compliance or plan_write
  avoidance, test plan-injection placement as a munchkin dimension. Until then: nothing.
- **Persistent re-enterable scoped contexts** ("applications" — same thread): stateful reduced-
  tool views the agent leaves/re-enters, contents swapped out of the window. Subagents already
  cover the spawn-and-distill 70%; revisit only if telemetry shows context-pollution failures in
  long sessions. (The thread's menu-verb idea — never retype exact strings — is hashline, already
  built, on the surface that matters.)
- **From the 2026-07 harness-research sweep** (arXiv + pi ecosystem; full sources in the sweep
  reports). Build-next tier, blocked only on m2s finishing (extensions frozen mid-run):
  *recency-window tool-result pruning* (arXiv 2606.10209 — strongest ablation seen: 79→91.6%
  completion at −63% tokens; env-gated extension, munchkin dim N∈{3,5,8,off}); *pi-readseek vs
  hashline head-to-head* (MIT, hash-anchored edits — one fleet A/B, adopt the winner);
  *failure-taxonomy steer table* (AgentDebug 2509.25370 +24%: error-pattern → class → targeted
  steer; prototype = c6 static spec). Daily-driver tier (unmeasurable on 5-file gate fixtures —
  adopt with telemetry, not the gate): *aider-style repo map* (tree-sitter+PageRank — our biggest
  genuine gap), *phase-gated tool palette* (statewright; needs pi 0.80 dynamic tools), *pi-lens*
  (LSP feedback in-loop; token-flood risk on 4B). Maintenance: pi 0.80 `/compat` migration
  **DONE 2026-07-08** (drift-scanner had been silently broken since the un-checklisted 0.80.3
  bump; .typecheck pins refreshed to 0.80.3 so tsc now catches SDK drift — see
  ~/.pi/agent/UPGRADE-0.80.md status note); 0.80.3 fixes llama-server-relevant
  compaction bug. Negative result adopted as candidate c5: agent-written tests don't improve
  resolution (2602.07900). Methodology: munchkin candidates now carry a falsifiable `prediction`
  checked against per-gate telemetry windows in the journal (2604.25850).
- **Gate-session write jail** (pattern from r/PiCodingAgent — the community DOES exist; Reddit is
  unreachable from our tooling, so threads arrive as user-pastes). Their `agent-lock` (yeet-src,
  BPF-LSM directory jail) is Linux-6.12-only + immature (5 commits, process-name keying), so
  adopted **natively**: gate `pi -p --approve` sessions run unrestricted bash today (command-policy
  classifies but doesn't ENFORCE) → wrap in macOS `sandbox-exec`/Seatbelt (`real-gate-fixtures/
  gate.sb`, probed: outside-writes + sibling-prefix denied, workdir/tmp/~/.pi allowed, node --test
  passes). Wiring into `real_gate.sh run_one` deferred until m2s frees the file. If gate execution
  ever moves to the Linux box, revisit Landlock/agent-lock there. Interactive daily driver stays
  unjailed by design (git-guard + human-in-loop).
- **pi ecosystem finds** (2026-07; r/PiCodingAgent itself is unrecoverable from our tooling — no
  Wayback/redlib/cache — but a research pivot surfaced these; I suspected confabulation and
  VERIFIED each against npm/GitHub — all real, the round stats were just their own marketing):
  - **pi-lean-ctx** (Apache-2.0, peer-deps pi ≥0.74, npm) — routes bash/read/grep/find/ls through
    a lean-ctx layer for token savings. **Directly preempts the queued A1 result-pruner**: before
    building our own, A/B pi-lean-ctx on the 4B (gate pass-rate + telemetry token counts) —
    adopt-vs-build. Don't build what a maintained Apache-2.0 extension already does.
  - **oh-my-pi** (can1357, 16.3k★, competing terminal-agent fork — the "OMP"/`omp` from the
    agent-lock thread): hash-anchored edits + "optimized tool harness" + LSP + subagents.
    Independently converged on hash-anchored editing → external validation that hashline was the
    right bet. Pattern-mine read-only (not an extension; no vendoring).
  - pi-caveman (~75% output-token compression) = the caveman skill already here; gate-irrelevant
    (we grade code, not prose). qualisero/awesome-pi-agent (1093★, archived) = the real tool index.
- **jlens-gguf disposition (2026-07-13, two user-pasted threads, repos verified;
  github.com/igorbarshteyn/jlens-gguf + github.com/dasjoms/jspace-hallucination-eval —
  URLs recorded after the first pass lost them to compaction).** The GGUF-
  native port (Apache-2.0, built-in CPU ridge-regression lens fitting, 60 tests) kills the
  hardware/weights reasons behind the 07-08 jlens rejection. The hallucination-eval stress test
  kills the naive use (thresholds break on derivation-shaped tasks — coding sessions are
  GSM8K-shaped). Survives: **phase-0 within-context discrimination study** — does late-layer
  J-noise at hashline TAG-generation positions separate invented tags from correct copies,
  same-task-structure controls? Corpus census REVISED by the audit-driven relabel (2026-07-13,
  file-matched COPY: a tag for the TARGET file must precede the call): **160 CONFAB_COPY +
  755 CONFAB_BLIND + 106 CONFAB_EXACT + 81 STALE + 3672 CLEAN** — 83% of the naive census's
  "copy failures" were blind inventions, and the primary study is TIGHTER than first claimed
  (4B: 80 COPY moments / 21 sessions, barely clears the 20-session floor; 2B: 65/14, under).
  Pre-registered bar: session-level strength ≥0.70 (bootstrap CI clear of 0.5, ≥20 sessions
  per class; sessions are the inference unit) → c20 in-loop veto design study; below →
  re-rejected on our own data.
  **PHASE-0 VERDICT (2026-07-14, 4B, 504 moments scored, alignment 504/504 exact,
  0 dropped in the scored classes, turn-confound null 0.505):**
  - **PRIMARY (CONFAB_COPY vs CLEAN): RE-REJECTED.** Session AUC 0.614, signed CI
    [0.436, 0.791] straddles 0.5 (21 vs 87 sessions, drop rates 0%/0%). Copying a
    seen-but-wrong tag does NOT carry a detectable late-layer noise signature — the
    copy act looks confident either way. The original c14-mechanism hypothesis dies
    on our own data, receipt delivered.
  - **SECONDARY (CONFAB_BLIND vs CLEAN): session AUC 0.953, signed CI [0.903, 0.992],
    39 vs 87 sessions → clears the pre-registered bar.** INVENTING a tag with no
    source in context — the true epistemic-guessing act — is highly separable.
    Caveats stated: (a) 137/180 BLIND moments were unscoreable (no locatable tag in
    the malformed call) — the scored 43 are the well-formed-invention subset; this
    matches the DEPLOYMENT population (an in-loop veto scores tags the model actually
    emits, which by construction exist), but the AUC claims nothing about unscoreable
    calls; (b) one model, one lens, and this was one of three studies in the round —
    per our own multiplicity rule the finding is EXPLORATORY: c20 design study may
    proceed, but confirmation on a fresh corpus (and ideally the blind-heavy 2B,
    528 blind moments) is required before any in-loop adoption.
  Previously BLOCKED ON:
  jlens-gguf host (observe = local mmap replay, NOT live interception — must run where the
  GGUF lives: box install [user, recommended] or granted Mac window). REJECTED regardless:
  live steering/abliteration (serving-stack risk, attention-collapse, prose>surgery evidence),
  quant repair. Also REJECTED (2026-07-14, user-asked): Extraltodeus/J-Wash — permanent
  weight surgery ("baked into exported weights"), CUDA-only, unavailable on quantized
  weights (our whole fleet), 18 commits/no releases; violates measure-don't-modify AND
  harness model-independence. Carve-out on record: iff phase-0 finds a discriminating
  direction, a clearly-labeled edited-model ARM is a valid future experiment — needs CUDA
  we don't have. Scoring waits for f4 completion + host.
- **stunspot-collection disposition (2026-07-13, user-pasted 40-prompt analysis).** Adopted into
  measurable surfaces: `/reflect premortem` (their 5/5 pre-mortem, contract-adapted: prospective
  failure imagination → [RISK]+preventative edits — a different detection axis than the
  retrospective scan), `pause` scaffold + c19 spec (the user's own empirically-favored
  deliberation primer, now a Fisher question on local tiers), /reflect method discoverability
  ('/reflect help' + dynamic description). REJECTED with citations: the persona/always-on class
  (Planner, ThoughtStream, Metagenius, Unified Reasoning — dd1 measured that class harmful;
  symbolect/stunspot engine port already rejected at +29% tokens), ICEBREAKER (theater, analysis
  agrees). Personal-workflow prompts (Comparative Evaluator, Goal Architect, Sharper Questions)
  = out of harness scope, fine as private pi skills. Noted: Goal Architect's anti-goal ≈ our
  anti-growth clause, independently converged.
- **loop-engineering research disposition (2026-07-13, three user-pastes + 12-factor-agents
  anchor).** Scorecard: most of the canon already built AND measured here (minimal prompts=dd1,
  deterministic gates, bounded tool output, subagent firewalls, event ledger w/ provenance, git
  as change ledger, stateless gates). Adopted: **session-keyed telemetry** (sk = workdir
  basename in every event; enrichment joins exactly instead of by time window — the class that
  contaminated m2s retro-analysis and forced per-router file splits is dead) and **c18
  fresh-retry** (one fresh-context session after a loop-breaker abort, same workdir, 3-line
  distilled handoff — poisoning removal as a mechanism, the minimum viable test of the
  role-pipeline idea; structurally do-no-harm, fires only where the alternative was certain
  failure; retried:1 rows carry the mechanism metric). REJECTED as builds: agent.db (JSONL+git+
  queries already serve it — SQLite is shape, not capability), full role-pipeline (contingent
  on c18), intent-rows/resume-reconciliation (N/A — gates are stateless by design).
- **constrained-decoding disposition (2026-07-13, Zilliz talk user-paste): c17-grammar-tools
  staged.** The concept (grammar-guided sampling) hits three named targets in our own records:
  the mellum verdict ("needs structural help (grammar-constrained tool calls), not prompt
  headers" — prescribed, never built), the prose-only exclusions (marco/DISTILL2 — grammars
  could re-enfranchise them), and hashline's patch grammar (OMP ships grammar.lark prior art).
  Deepest mechanisms-over-prose move: invalid output becomes unrepresentable at the logits.
  NOT adopted from the article: Outlines/BAML (HF-Python stack, jlens-shaped incompatibility)
  and all vector-DB content (vendor marketing). Native path: llama.cpp GBNF / lazy tool-call
  grammars under --jinja (lazy = thinking stays unconstrained — critical, format constraints
  measurably degrade reasoning per literature). Phases: (0) post-sweep probe of what current
  builds already enforce; (1) per-model llama-swap config delta, fleet A/B with mellum as
  anchor; (2) hashline patch-body GBNF (separate, harder). PRE-REGISTERED two-sided prediction:
  edit_err drops AND pass holds — errors vanishing while pass drops = constraints pushing
  failures underground (forced-valid-but-wrong calls evade the loop-breaker), reject.
  **PHASE-1 PASSTHROUGH RESOLVED (2026-07-14, box b10002 probes):** (a) the router passes
  grammar / grammar_lazy / grammar_triggers through WITHOUT stripping or erroring; (b)
  whole-output GBNF still lands in reasoning_content on thinking models (phase-0 reproduces
  — unusable, confirms lazy is mandatory); (c) DECISIVE — the native --jinja tool path is
  ALREADY ACTIVE and ALREADY does the lazy-grammar thing: a tools request returns thinking
  (reasoning_content present) AND a structured tool_call together. So c17's original premise
  ("add lazy tool grammars") is largely already shipped server-side. REFRAME: the real gap
  is the canary receipt — nested-JSON arg mangling happens DESPITE the active tool grammar,
  so c17 phase-1 narrows to "is the tool schema compiled to a tight GBNF or only
  prompt-guided, and where does the nested value round-trip break (grammar vs chat-template
  serialization)?" — a far smaller investigation than a fresh grammar build. hashline
  patch-body GBNF (phase 2) is untouched by this and remains the real net-new grammar work.
- **Pydantic-Evals disposition (2026-07-14, coles.codes user-paste): FRAMEWORK REJECTED,
  c23 trajectory-gate staged, judge-calibration parked.** The post's staged-trust model
  (structured outputs → Pydantic Evals → calibrated LLM-judge) maps onto machinery we
  already have, mostly MORE rigorously: structured outputs = c17 (already largely shipped,
  above); Cases/Dataset/Evaluator + `repeat=N` + pass-rate threshold = real_gate tasks +
  hidden graders + N reps/cell + fleet_report/fleet_verdict. Their own "what it doesn't do"
  list (no pass@k, no CIs, no significance testing, manual judge-bias mitigation) is exactly
  the three-audit-round machinery here (Fisher, Wilson, bootstrap cluster CI, sign-consistency,
  task-strata Simpson guard, exclusion gate). Adopting the framework = a statistics DOWNGRADE
  plus a Pydantic-AI/Bedrock cloud stack in a llama.cpp-native model-independent harness —
  same shape as the Outlines/BAML rejection; the DSPy/PromptBreeder over-build the §3 table
  already refuses. The ONE genuinely new atom: **HasMatchingSpan → assert on the TRAJECTORY,
  not just the final state.** Our gate scores end file state; a lucky broken path (bigdata
  answered from a head-peek, never scanning the file — the exact map-reduce-audit worry) passes.
  → **c23 trajectory-gate (BUILT 2026-07-14, dormant): prompt-lab/trajectory_check.py asserts
  the session's tool sequence per task (bigdata: a real full-file scan, not a peek), ANDed into
  the gate behind TRAJECTORY=on.** Grader-integrity feature like t2-check, NOT an A/B candidate:
  run base off-vs-on once and the pass-rate DELTA = the lucky-pass rate; adopt as default if
  material (do NOT run it through do-no-harm — a stricter honest grader is SUPPOSED to lower the
  number). Extend CHECKS{} per task as lucky-path cases surface. PARKED (note, not staged):
  calibrate judge.py against a small human-labeled set before trusting its numbers — the
  post's core LLM-judge caveat, and our own lgtmaybe-shaped uncalibrated-reviewer lesson;
  low priority since judge.py isn't in the adoption critical path.
- **wordslugs disposition (2026-07-12, r/AI_Agents user-paste): c14 slug-tags staged.** The
  post's core (semantic slugs beat opaque IDs for model-retyped identifiers) maps to exactly one
  surface here: hashline's 8-hex version tag — the documented dominant small-model failure
  (invented tags, "#main" seen live; prompt mitigation is prose covering a mechanical problem).
  HASHLINE_TAG=slug encodes the hash's top 24 bits as three words (256-word embedded list;
  snapshot tag+text dedupe + relocation cover the bit-width delta); parser takes both encodings
  any-case (test-writing caught a parse-side uppercasing that would have broken every slug edit).
  Default hex; c14 spec measures edit_err + pass on the 4B in round 5. NOT adopted from the
  post: yaml registries / OKF / memory-graph slugs — no other model-retyped IDs exist in this
  harness (plan items are small numerals; pi tool-call ids aren't model-echoed).
- **/reflect phase 1 shipped (2026-07-12).** Fresh-context adversarial plan review — drift-scanner's
  out-of-band pattern, NOT in-context self-refine (measured weakest: dd1 prose-harm, 4B
  capability-bound, self-refine grows plans). Contract: BLOCKER/RISK/CUT/VERIFY findings only,
  adding scope forbidden, CLEAN sentinel, 2-round cap, manual re-invocation. Live validation on
  the DD: reviewer substance excellent (planted flaws caught every run), CLEAN sentinel
  unreliable (invents defects on trivial plans; 2 prompt iterations didn't fix it — model
  behavior, not wording) → session model is the materiality judge via explicit-reject injection;
  telemetry records clean-rate (watch it; if ~0 in practice, tune or retire). **Phase 2
  (corrected per user): reasoning methods as PROMPT STRATEGIES, not optillm/proxy infra.**
  `/reflect <method>` selects a reviewer strategy implemented as N completeSimple calls + pure
  merge logic: `sc` (self-consistency: 3 samples at temp, keep findings recurring in ≥2 —
  directly attacks the measured unreliable-CLEAN pathology: hallucinated nitpicks shouldn't
  recur, real flaws recurred every run in validation), `debate` (prover defends / attacker
  prosecutes / judge rules — PVG-shaped), extensible registry for plan-search/rstar-LIKE
  decomposition later. No new deps, each method measurable on the same flawed/tight plan
  fixtures.
- **pi-lean-ctx A/B verdict (2026-07-12): REJECTED — architecturally incompatible.** Its
  value-delivering replace mode removes every tool named read/bash/grep/find/ls, INCLUDING
  hashline's read — and hashline's edit depends on the version tags that read produces. Result
  across 10 sessions (two configs, HASHLINE=off and on): the 4B falls back to byte-exact builtin
  edits and fails them 31-48× per session (0 passes, 2.2× tokens, 7× wall-clock). Additive mode
  not pursued (pure schema bloat a small model ignores). Uninstalled; package pin removed;
  health PASS. Corollary finding, the strongest hashline validation to date: **hashline is
  load-bearing for weak-model editing** — remove it and the 4B floors outright. Consequence per
  the staged decision rule: the map-reduce minimal prototype (manifest + search_spans/read_span)
  moves UP the queue; A1 result-pruner stays cancelled-unless-needed. Pocketed c11: loop-breaker
  missed 48 same-class edit failures (args differ → fingerprints differ) — error-CLASS outcome
  detection is a legitimate candidate.
- **dd1 verdicts — THE universality round (2026-07-12, DD qwen36-35b-iq3s @65k, n=36/arm,
  parens/roman/titlecase).** Governor gradient is monotonic: full 5.2KB 30/36 (83%) → lean 1.6KB
  32/36 (89%, p=.367) → **EMPTY 35/36 (97%, p=.053)**. The full governor drove **9 loop-breaker
  aborts** (vs 1/3 in trimmed arms). Claim scoped honestly (audit 2026-07-13): removing prose
  produced a large, consistent improvement IN THIS ORDERED RUN (arms ran sequentially, same
  baseline, tasks pooled) — strong enough for the reversible minimal-governor adoption, not a
  causal law. A randomized/interleaved confirmation round is queued before "behavioral prose is
  harmful on capable models" graduates from working hypothesis.
  Universality answered: mechanisms are PRODUCTIVE on a capable model, not idle — steers convert
  (progress-after-steer 24/33 in the winning arm; verify-gate 29 steers → 3 unverified-ends).
  c10's premise (drop verify-gate) is thereby REFUTED for the DD — the gate converts here; c10
  stays a small-model question only. Adoption: `proposals/dd1-minimal-governor.md` (safety gates
  + feature docs kept — unmeasurable by the gate; ALL behavioral prose deleted — measured) for
  HUMAN review/apply. Caveat honestly: 83% baseline = near band ceiling, so wins are compressed;
  the abort-rate delta is the strongest signal, pass-rate the corroborating one.
- **pi-context-prompt-engineering-audit disposition** (2026-07-11): ~70% convergent with work
  already done or in flight (governor A/B = dd1; compaction measurement = queued w/ live
  instrument; bounded intake = closed; spawn-first = adopted). Adopted: **bigdata gate task**
  (large-structured-file query class — 305KB deterministic JSONL fixture + recomputing hidden
  grader; closes the gate's code-tasks-only blind spot, makes retrieval-layer A/Bs like
  pi-lean-ctx measurable on their actual value axis) and **c10 no-verify-gate candidate**
  (audit's ranked exp #5, backed by m6: 4B fires don't convert; schema gains
  thresholds.VERIFY_GATE on/off). Folded into the queued compaction item: its comparison matrix
  (native+watcher / native+obsmem / all three). Noted-no-action: ketch sanitization
  (off-by-default mitigates; unmeasurable on the gate), extension ordering opacity,
  structured-nudge steer formats (class measured neutral 2×).
- **large-file-map-reduce-audit disposition** (2026-07-11; gaps verified in code before acting).
  Fixed same-day: risky-file explicit-limit hole — any positive `limit` skipped all inlet checks
  and hashline honors big explicit limits, so JSONL/logs could be pulled at 50KiB/call vs the
  8KiB gate; huge limits on risky paths now block with a narrow-page steer
  (CTX_GUARD_RISKY_LINES, default 200). Verified already-covered: bash intake is RTK-truncated
  at 12k chars (tighter than the read path); fork context copy is by-design (concurrency now 1).
  Noted, no mechanism: image reads up to 4MiB (rare, user-driven, vision model only). Queued:
  the audit's own minimal first experiment — deterministic manifest + `search_spans`/`read_span`
  on one JSONL type, NO LLM mapper, its stated accept/rollback criteria — placed BEHIND the
  pi-lean-ctx A/B (adopt-vs-build: don't build a retrieval layer before measuring the maintained
  Apache-2.0 one; targeted-question path ≈ rg + bounded read, both already exist and are
  governor-mandated). Corpus-coverage map-reduce (map artifacts, hash caching, conflict-
  preserving reduce) deferred outright: no current workload, unmeasurable on 5-file gate
  fixtures; revisit only if large-corpus interrogation becomes a daily-driver need.
- **m6 verdicts (2026-07-10, 4B @16k, clean instrument: n=16/task parens+equil, all guards armed).**
  Baseline 12/32 (38%). **c3 patient-streak RETIRED**: 9/32, p=0.857 — and telemetry shows the
  mechanism never fired (loop-breaker.steer 0–1 per arm at 16k; sessions too short to hit any
  streak threshold). Its three earlier positive deltas were noise. **c7 verify-gate-steer
  NEUTRAL, prediction refuted**: 13/32, p=0.500; steers 18→42 while unverified-ends ROSE 14→17 —
  the model complies with "run the gate" but cannot turn red green. Verify-gate failures on this
  model class are **capability-bound, not compliance-bound**: steer-wording tuning on the
  verify-gate is a dead end. Round 3 targets orthogonal objectives: c6 taxonomy-steers
  (outcome-loops still fire ~11/arm) + c8 lean-governor (same pass rate on fewer prompt tokens;
  munchkin gained `gov_file` full-replacement specs for it).
- **pi-local-model-audit disposition** (2026-07-10; external no-edit audit, every checked claim
  verified true in code). Applied same-day (ops/config, reversible, no behavior claim):
  subagent concurrency env-overridable default 1 (`PI_SUBAGENT_CONCURRENCY`; llama-server is
  single-concurrency — parallel children only queue + thrash cache), ketch flipped to opt-in
  (`KETCH=on` for research sessions; 4 fewer tools per local prompt), packages pinned
  (pi-rtk-optimizer@0.9.0, pi-observational-memory@3.0.3), MODELS.md defaultModel note
  (intentional cloud default — resolved, not drift). Queued with instruments:
  - **c8 lean-governor candidate** (audit #6): never hand-trim the 5.7KB globals — write a
    trimmed APPEND_SYSTEM.md as a `prompt_variant` munchkin candidate in round 3. Prediction:
    pass-rate holds, tokens/session drop.
  - **Compaction consolidation** (audit #2): deferred until ~a week of daily-driver
    `compacted{reason,willRetry}` telemetry (instrument wired 2026-07-08). The audit's
    107-resets stat is tiny-model gate data, not DD evidence. Then: native + at most one
    proactive layer, cut from data.
  - **Ketch research skill + Barebrowse**: separate project, queued behind pi-lean-ctx/readseek.
    Audit's own trial design is sound (Ketch-only baseline → skill overlay → Barebrowse only for
    proven browser-shaped gaps; dedicated profile, no eval, no uploads).
  - Keep-as-is confirmed: compat flags, plaintext-HTTP-on-LAN (never port-forward), hashline,
    inlet guard, loop-breaker, RTK truncation.
- **jlens / J-Space** (Anthropic global-workspace paper + anthropics/jacobian-lens, 2026-07) —
  **rejected** (user call): no CUDA box in the fleet (jlens needs HF safetensors + GPU backward
  passes; Mac is MPS, remote box unsuitable), Qwopus fine-tunes are GGUF-only (base-model lens
  proxy unvalidated), and the community read (r/LocalLLaMA) is that it's a cleaner readout of
  known intermediate-layer representations, not a new capability. Pocketed if hardware changes:
  J-space probe as a cheap candidate PRE-SCREEN (rank steer wordings by workspace shift at the
  decision point, send only survivors to the real gate; Fisher stays the adoption authority).
  Pre-fitted lenses exist at HF `neuronpedia/jacobian-lens` (qwen3.5-4b/9b-pt/27b).

Test path for both: encode as a governor variant → `prompt_variant` config →
`real_gate.sh` → `fleet_report.classify` (Fisher, do-no-harm). Adopt only on a significant win.

**Verified fact (2026-07, corrects an unverified review LOW):** subagents DO load the global
governor — the child `pi` process loads `~/.pi/agent/APPEND_SYSTEM.md` normally and the agent's
role `.md` body is *appended* via `--append-system-prompt` (vendor/pi-subagent/runner.ts), not a
replacement. A `subagent_governor` search dimension is therefore unnecessary.

**Steer texts are now a search dimension:** the loop-breaker/verify-gate injected messages route
through `lib/steer-texts.ts` (env `PI_MSG_*` templates, `{var}` placeholders) and schema.json's
`messages` dimension — munchkin can propose wording experiments (freeform ≤400 chars, schema-key
whitelisted). Harness telemetry (`lib/telemetry.ts` → `~/.pi/agent/telemetry/events.jsonl`,
`scripts/telemetry-report.sh`) records every steer/block/abort/compaction + steer→progress
compliance, giving future fitness signals beyond binary gate-pass.

## 9. Round 5+: the c25–c37 candidate ledger and the delegation-decomposition pivot (2026-07-21 → 2026-07-22)

The queue below picks up where §8 leaves off. Where §8 is largely a research-triage log —
*should we even build this* — this section is a ledger of things that were actually built,
in what state each one currently sits (dark-and-unmeasured, exploratory-tested, or locally
authoritative), and, at its close, an account of a deliberate architectural pivot the whole
back half of the ledger now serves. Read it as a diary of the project's central epistemic
discipline in action: every candidate below ships **dark** (inert unless its env flag is set),
is registered in `configs/schema.json` (the `config.py --selftest` check exists specifically
because two candidates once shipped with an unregistered threshold and silently exited the
gate with code 2 — see the c24/c25 note above), and is adopted only after it *wins* a round
against the do-no-harm rule, never on the strength of its author's confidence in the mechanism.

**c25 — subagent-only edits (`PLAN_SUBAGENT_ONLY=1`).** The first candidate to make delegation
*mandatory* rather than merely advisory. While `plan-runner`'s ordinary prompt already suggests
routing an isolated edit through `subagent(executor, …)`, nothing stopped the model from editing
directly, and small models reliably take the path of least resistance. Under this flag, the
`tool_call` handler blocks every `edit`/`write`/`multiedit` call — and, critically, every
*mutating* `bash` invocation too (`sed -i`, `cat >`, and anything else `command-policy.ts`'s
`classifyBashCommand` flags as a mutation; a shell one-liner is exactly as much a direct edit as
a call to the `edit` tool, and a candidate that only closed the front door would be trivially
routed around) — during the execution phase of a plan, steering the model to delegate the work
to a freshly spawned `subagent(executor, …, mode=fork)` instead. If no `subagent` tool is present
in the session at all, the block reason degrades honestly to "mark the item blocked and stop,"
rather than pointing the model at machinery it cannot actually reach. This mechanical hardening
(bash-mutation coverage, the subagent-tool-presence check, and a `plan-runner/subagent-only-block`
telemetry event so a future round can see the block rate directly) was itself a same-session
repair — the original cut only covered the three named mutation tools and was silently
inert against a scripted `sed -i`. **Local round (`c25-35b`, n=3): `VERDICT: NEUTRAL`** — clean,
authoritative, nothing broken by the mandatory-delegation enforcement on the current task set.

**c26 — read deduplication (`READ_DEDUP=on`).** A `context` event transform, not a message
mutation: when the exact same file content is read twice in a session, the second (and every
subsequent) occurrence collapses to a one-line back-reference in the *per-call view* the
provider actually sees, while the underlying transcript is left completely untouched. This is
the one candidate in the whole ledger with a purely transient effect — nothing is rewritten in
history, so a compaction or a `/collapse` sees the original reads exactly as they happened. Run
once, exploratory, on the remote 4B: 17 of 18 sessions passed (the lone miss was the model
writing its own syntactically invalid test file — a genuine capability miss, not a harness
defect), and the fleet report returned `VERDICT: INCOMPLETE`, which at the time was read as
"inconclusive" but is now understood to be *structural* to any remote endpoint (see the
authoritative-verdict discussion two paragraphs below) rather than a property of this specific
candidate or round. **Local round (`c26-35b`, n=3): `VERDICT: NEUTRAL`** — the authoritative
re-run the exploratory result above was waiting on.

**c27 — redundancy nudge (`CTX_REDUNDANCY_NUDGE=on`, `CTX_REDUNDANCY_PCT`, default 50).** Where
c26 quietly fixes duplication, c27 tells the model about it: once `context-surface`'s passive
duplicate-share telemetry crosses the configured percentage, a `turn_end` steer ("~N% of your
context is duplicate — call `compact_context`") fires, gated by an eight-turn cooldown so it
cannot nag every turn. Also run once, exploratory, on the remote 4B: 15 of 18 passed (three
misses, spread across both arms on an unrelated edge case in the `parens` fixture, plus one
`bigdata` floating-point rounding miss confined to the baseline arm) — again `VERDICT:
INCOMPLETE`. By this point in the session, three consecutive remote-box rounds (c28 below, c26,
c27) had all landed `INCOMPLETE`, which is what motivated the pivot to local testing described
below rather than continuing to spend box time on a verdict class that structurally cannot
resolve. **Local round (`c27-35b`, n=3): `VERDICT: NEUTRAL`.**

**c28 — teach-hints (`TEACH_HINTS=on`).** Three narrowly deterministic rules — a missing-command
error, a module-not-found error, and a malformed-patch error — each of which, on a match, appends
exactly one fixed teaching line to the offending tool's error result via the `tool_result` hook.
First rule to match wins; no rule ever fires on a *successful* result. This is the candidate that
finally broke the `INCOMPLETE` streak, because it was the first one re-run against the **local**
daily driver (`qwen36-35b-iq3s` via `local-llamacpp`, `127.0.0.1:8080`) rather than the remote
box — no `LLAMA_API_KEY` in play, hence no non-authoritative flag, hence a verdict the fleet
report will actually commit to. The first local attempt, at N=3, surfaced a real and separately
interesting finding before it could even measure the candidate: `qwen36-35b-iq3s` intermittently
emits a malformed pseudo-tool-call as literal assistant *text* (`<tool_call></tool_call>\n
<function=bash>…`) rather than a genuine API tool call, ending the session on the spot with zero
work done. This was not a new bug — it is an already-documented trade-off recorded in
`run-qwen36-35b-iq3s.sh`'s own launch comments: the q8 KV cache plus `batch=2048`/`ubatch=1024`
configuration was chosen deliberately for prefill throughput and answer quality, at a measured
cost of "more malformed tool/edit calls" versus the more conservative `q4_0` / `512`/`256`
alternative, which the launcher keeps wired as an explicit escape hatch
(`BATCH=512 UBATCH=256 CACHE_K=q4_0 CACHE_V=q4_0`) should the trade ever stop being worth it.
Rather than change the launcher, the round was simply re-run at N=6 (36 sessions total), large
enough to average the artifact out: **`VERDICT: NEUTRAL`** — base 100% (18/18) against candidate
89% (17/18, the single miss being that same well-understood artifact recurring, not a genuine
regression the candidate introduced). This was the queue's first authoritative, non-`INCOMPLETE`
result, and it fixed the going-forward template: local daily-driver rounds produce real
verdicts; remote-box rounds are directional and exploratory only, useful for finding harness bugs
(three were found and fixed this way — twice in `context-watcher`'s stale-context handling, once
in `ketch`'s `maxLength` drift) but never for an adopt/reject decision.

**c29 — micro-gate slop detection (`MICRO_GATE_SLOP=on`).** A heuristic companion to the existing
`micro-gate` parse/compile check: after an edit, a lightweight scan of the diff for likely
corner-cutting (stubbed branches, suspiciously empty error handlers, and similar shapes) produces
a short "possible shortcuts" steer naming up to three offending files, suppressed on any turn
where the stricter parse-error check already fired (never stack two competing steers about the
same edit in the same turn). **Local round (`c29-35b`, n=3): `VERDICT: NEUTRAL`.**

**c30 — context brief (`CONTEXT_BRIEF=on`, `CONTEXT_BRIEF_BYTES`, default 2048, clamped to
256–16384).** A `before_agent_start` hook appending a compact, explicitly untrusted-data-framed
"## Environment brief" section — a cached repository inventory — to the system prompt, computed
once at session start and held stable for the session's whole KV-cache lifetime rather than
recomputed per turn. This is a port of an external "environment brief" concept, review-hardened
through four adversarial passes before it shipped, on the theory that some of what a model
otherwise spends several exploratory `read`/`ls`/`grep` turns discovering can instead be handed
to it for free, cheaply, and without the KV-cache churn of a per-turn recomputation.
**Local round (`c30-35b`, n=3): `VERDICT: NEUTRAL`.**

**c31 — plan uncertainty (`PLAN_UNCERTAINTY=on`).** A port of the npcsh `loop_plan` pattern: a
plan gains an optional `uncertainties[]` field, and once the model has declared one, execution is
*structurally* paused — not merely advised to stop — until the uncertainty is explicitly cleared
(writing an empty list back). The distinguishing design choice is that this is a **deterministic
gate**, not an LLM judgment call layered on top of one: the harness does not attempt to assess
whether an uncertainty the model surfaced is *genuine*; it simply refuses to let execution proceed
past a declared one, on the theory that a model honest enough to name its own uncertainty should
never be allowed to then guess past it in the same breath. Tested end-to-end: the write produces
the expected steer, `/plan-go` is deterministically blocked while an uncertainty is outstanding,
clearing the list with `[]` releases it, and the omission-safe reattach logic (shared with the
plan-integrity machinery generally) preserves the field correctly across a rewrite that forgets to
echo it back. **Local round (`c31-35b`, n=3): `VERDICT: NEUTRAL`.**

**c32 — commit-SHA guard (`PLAN_SHA_GUARD=on`).** A narrow, mechanical honesty check: whenever
the model writes a commit SHA into a plan item's note or the run summary, the guard verifies with
`git cat-file -e` that the SHA actually exists in the repository before letting the claim stand,
catching confabulated provenance — a plausible-looking hash the model invented rather than one
that came from a real `git commit` it ran. Tested: a fabricated SHA in a note reliably draws a
steer; a genuine SHA passes silently; and, correctly, the guard fails *open* (does nothing) when
the working directory is not a git repository at all, rather than raising a spurious complaint
about a concept — commit provenance — that does not apply there. **Local round (`c32-35b`, n=3):
`VERDICT: NEUTRAL`.**

**c33 — subagent fork-by-default (`SUBAGENT_DEFAULT_MODE=fork`).** `vendor/pi-subagent`'s
delegation-mode parser defaults an *unspecified* mode to `spawn` (a fresh, nearly empty context
for the child); this candidate flips that default to `fork` (the child instead receives a full
snapshot of the parent's entire session, replayed as its own history) whenever the model omits an
explicit mode. An *explicit* mode from the model always wins regardless of the flag — this is a
default only, never an override. The motivating hypothesis was narrowly about a single-slot
local `llama-server`: a forked child re-primes the parent's already-warm KV-cache prefix, where a
`spawn`ed child evicts it and starts cold, so on hardware where only one request can be served at
a time, the fork default might trade a larger per-request prompt for a cheaper prefill. **This
candidate is now in direct philosophical tension with the c36/c37 pivot below** and should almost
certainly be dropped from the active queue rather than measured — running an A/B round to adopt
`fork`-by-default at the same time the project is deliberately moving delegation guidance the
other way, toward `spawn`-by-default plus explicitly self-contained tasks, would be testing two
opposed hypotheses under the same roof. It is recorded here rather than deleted only because the
KV-cache-reuse rationale it was built on remains a coherent, distinct idea that might warrant its
own re-litigation later, on its own terms, separately from the direction the rest of this ledger
has since taken. Run anyway in the full local ledger sweep despite the above recommendation — cheap
to include, and the data costs nothing to have: **local round (`c33-35b`, n=3):
`VERDICT: NEUTRAL`.**

**c34 — non-numeric plan-item guidance (`PLAN_ITEM_GUIDANCE_V2=on`).** The smallest candidate in
the ledger by diff size and arguably the most carefully reasoned by rationale: the legacy planning
prompt told the model to "break REQ into 5-10 ordered items," a bound the `plan_write` tool's own
JSON schema never actually enforced (it declares only `minItems: 1`, no ceiling), so the number
was decorative at best and, worse, an invitation to pad a three-item task to five or to jam a
fifteen-item task into ten via artificial merges. The replacement text — "decompose REQ into
ordered steps sized to the real work — no padding, no fake splits" — keeps both anti-patterns the
original line guarded against while dropping the unenforced, misleading numeral. This is
explicitly framed as *compression*, not elaboration: the swap is deliberately one precise phrase
for another at equal-or-fewer tokens, never a verbose rewrite, a distinction the project settled
on after weighing two things against each other — the general instinct that careful, exact
wording is good, against the specific, measured finding (dd1, §8 above: full governor 83% pass,
lean 89%, empty 97%, strictly monotonic) that *behavioral prose actively harms a capable model* on
this harness's own data. External literature agrees with the empirical result: Anthropic's own
context-engineering guidance on finding the "right altitude," research on position bias in long
prompts, and Schreiter et al. 2025 (arXiv:2505.17037, the one controlled study of vocabulary
specificity effects on instruction-following) all converge on plain, information-dense, imperative
phrasing over elaborate or rare-word phrasing — rare words earn their keep only when they
disambiguate, never for register alone. Adding ornate wording to chase a hypothesis (register
correlates with better compliance) that both our own instrument and the outside literature argue
against would have been exactly the mistake the project's discipline exists to prevent.
**Local round (`c34-35b`, n=3): `VERDICT: NEUTRAL`.**

**c35 — bash output guard (`BASH_OUTPUT_GUARD=on`, `BASH_OUTPUT_MAX_CHARS`, default 8000).** The
harness's `context-inlet-guard` has bounded oversized `read` calls since early in the project by
`stat()`-ing the target file *before* it is ever opened and refusing to read anything implausibly
large — but there is no `stat()` equivalent for an arbitrary shell command's future output, so
nothing analogous existed for `bash`. This candidate closes that gap with a `tool_result` hook
(the earliest point a command's actual output size becomes knowable) that, on an oversized result,
withholds the real content entirely and substitutes a bounded diagnostic plus a steer, rather than
truncating and showing a partial view — the same "block, don't truncate" philosophy `context-inlet-guard`
already uses, on the reasoning that a partial view of a wide `find` or `grep` result risks the model
drawing confidently wrong conclusions from an arbitrary cutoff point, which is arguably worse than
being told plainly that the output was too large to use. A cheap heuristic
(`looksLikeCwdEscape`: a bare `$HOME`, a bare `~`, or an absolute path outside the working
directory anywhere in the command text) only sharpens the wording of the steer when it fires — it
never changes whether the block itself fires, so a false positive or negative in the heuristic
only costs a slightly less specific message, never an incorrect decision. The motivating incident
was a live one, discovered by accident: once LFM2.5-8B-A1B's *unrelated* tool-call-formatting bug
had been fixed server-side (confirmed independently by reading a real, successfully executed
`tool_call` out of a session's own transcript), the model went on, in the very next reasonable
turn, to run an entirely unscoped `find` that walked straight out of its assigned working
directory and into `~/LLM/real-gate-runs/` — a directory holding thousands of files left behind by
unrelated historical gate rounds spanning many old experiment prefixes — and got back roughly
63,000 characters of irrelevant listing for its trouble, after which the session simply sat idle
for the remainder of its turn budget, having apparently exhausted whatever it was trying to do
with a result it had no productive way to use. The telemetry path needed a companion fix before
the candidate could even be verified in the field: `context_telemetry.py` extracted
`context-watcher`, `surface-receipt`, and `context-surface` events into a gate row's `context`
field, but never `bash-output-guard`'s own `withheld` event, so a completed gate round had no way
to confirm after the fact whether the guard had fired at all versus simply never having been
exercised. That gap is now closed (a `context.bash_output_guard.{withheld,cwd_escape_suspected}`
field, registered in the eval-row schema as an optional addition so historical rows without it
remain valid). Measured across four rounds — remote 4B, remote 9B (`qwopus35-9b-coder-q4-k-m`, the
newest addition to the box's model zoo, discovered and registered mid-session), remote LFM25, and
finally the local daily driver — the guard has, notably, never once actually fired: no session, on
any of the four models, ever produced a single `bash` result anywhere near the 8,000-character
threshold in the tasks tested. The local round returned the ledger's second authoritative,
non-`INCOMPLETE` verdict: `VERDICT: NEUTRAL`, base and candidate both at 89% pass (n=9/arm) — safe,
in that turning the guard on cost nothing measurable, but not yet *proven* useful, in that its
actual triggering mechanism remains unexercised by anything in the current gate task set. Two
further, separate findings surfaced in the course of chasing this candidate on LFM25 specifically,
worth recording here because they are easy to conflate with c35 itself but are not the same bug:
first, the exact cwd-escape-and-stall scenario recurred twice, reproducibly, in live gate rounds
even with the guard active, and a stack sample of the stalled process (via macOS `sample`) showed
its event loop and every worker thread genuinely idle — parked in `kevent`/`uv_cond_wait`, zero
CPU, no open network connection to the remote endpoint — waiting on some internal signal that
never arrived, with the guard's own telemetry showing zero firings on the affected row; five
standalone attempts to reproduce this outside the gate harness, including one built with the exact
byte-identical rendered governor prompt the gate itself sends (verified via `config.py --apply`
plus a direct diff against a real gate rundir's `.pi/APPEND_SYSTEM.md`) and a fully wiped
`env -i` environment matching the gate's, never once reproduced the stall — all five collapsed
instead into the second, separate finding: LFM25 emitting a malformed pseudo-tool-call as plain
text rather than a genuine API call, on every single attempt, a considerably higher failure rate
than the one successfully-executed real tool call that had earlier confirmed the server-side
formatting fix actually worked at all. Both findings are recorded as open and unresolved; neither
is a defect in c35's own logic, and both point outward at the remote endpoint's serving
configuration rather than inward at the harness.

### The many-small-contexts pivot: c36 and c37

Roughly two-thirds of the way through this same working session, the project's owner articulated
a deliberate change of architectural direction, worth quoting rather than paraphrasing, because
the exact framing shaped both candidates that followed it directly: *"I need more, separate LLM
calls, to play to lower contexts, instead of complicating LLM calls as they are. I don't mind the
slowdown on the wallclock."* The diagnosis behind the request is straightforward and consistent
with everything measured elsewhere in this ledger: small local models degrade as their context
grows, and the harness's instinct up to this point — visible in nearly every candidate above,
from `teach-hints`'s appended error-result lines to `plan-runner`'s escalating gate-ladder
steers — has been to keep one session alive longer by coaching it more elaborately when it
struggles, rather than to end that session early and hand the remaining work to a fresh one.
Wall-clock time was explicitly declared a currency the project is willing to spend more of in
exchange for smaller, cleaner contexts per call.

A survey of the existing decomposition machinery, conducted before either candidate was designed,
turned up an encouraging asymmetry: the right primitive already existed, but the harness's own
guidance consistently pointed away from it. The bundled `subagent` tool's `spawn` mode is exactly
the shape of thing the new direction asks for — a genuinely separate OS process, started with
nothing but its role's system prompt (on the order of one to one-and-a-half kilobytes for
`explorer`, `executor`, and `verifier`) plus a single task string, whose result is clamped to
12,000 characters before it is ever handed back to the parent (`runner-events.js`'s own comment
on the clamp: an unbounded child answer would otherwise dump tens of thousands of tokens into a
thirty-thousand-token window). But every place in the harness that actually *recommends*
delegation — the `executor.md` role description, `plan-runner`'s delegation-guidance prose, the
gate-repair ladder's second rung, and c25's own block-and-steer reason — recommended `fork` mode
instead, in which the child receives not a small fresh prompt but a complete snapshot of the
parent's entire accumulated session, replayed as its own history: precisely the large-context
shape the new direction wants less of. Compounding the mismatch, candidate c33, still sitting
dark and unmeasured in the queue at that point, would have made `fork` the *default* delegation
mode fleet-wide had it ever been armed and won a round. Separately, nothing in the harness routed
*ordinary*, non-edit plan items — exploration, verification, anything that was not specifically a
scoped edit — through any kind of isolated call at all; c25's enforcement, the closest existing
mechanism, covered mutations exclusively.

Two candidates were built in direct response, deliberately scoped as two rather than one so each
could be measured, adopted, or rejected independently of the other.

**c36 — spawn-over-fork delegation (`SPAWN_DELEGATION=on`).** Wherever the harness previously
recommended `mode=fork`, this candidate flips the recommendation to `mode=spawn`, paired with an
explicit instruction that the delegated task string must be fully self-contained — the child will
see nothing beyond the text of the task itself, so anything the parent has not written into that
string is simply unavailable to it. Three sites in `plan-runner.ts` carry the change: the general
delegation-guidance block (both its `PLAN_SUBAGENT_ONLY`-armed wording and its ordinary advisory
wording), the gate-repair ladder's second rung, and c25's own block reason when a subagent is
available to point the model at. Each site is written so that with the flag off, the resolved
text is byte-for-byte identical to what shipped before — a pair of small constants resolve to
either the legacy fork-mode phrase or the new spawn-mode phrase plus its self-containment
reminder, and an empty string in the flag-off case, so no test needs to distinguish "the flag is
off" from "the flag doesn't exist yet." The fourth site required a different tactic entirely: the
`executor.md` role file's own description — "Use mode=fork so it has surrounding context" — is a
static markdown file on disk, shared unmodified across every arm of every A/B round and parsed
directly by the role-routing tests, so editing it on disk was never an option (it would either
break those tests or make the file's on-disk content stop describing what actually ships in the
default arm). Instead, the sentence is rewritten at the moment the role list is injected into the
system prompt — a small exported helper, `agentDescriptionForPrompt`, performs one exact-string
replacement of that specific sentence with its spawn-mode equivalent, reads the flag live at call
time rather than at module load (matching the pattern the harness's other env-overridable steer
templates already use), and leaves every other role's description — `explorer` and `verifier`
never mention fork mode at all — completely untouched. This candidate is deliberately the
photographic negative of c33 above: where c33 would default the mode to fork, c36 argues, in
every place the model is given advice at all, for the opposite. The two should never be armed in
the same round. **Local round (`c36-35b`, n=3): `VERDICT: NEUTRAL`** — with the `subagent` tool
genuinely present in the candidate arm this time (see the `real_gate.sh` fix below), so this is a
real measurement, not a vacuous one.

**c37 — delegate every plan item (`PLAN_DELEGATE_ALL=on`).** Where c25 mechanically forces only
*edits* through a subagent, this candidate extends the same enforcement discipline to
*everything*: once execution has begun, the main session's own tool palette shrinks to exactly
two entries, `plan_write` and `subagent` — every other direct tool call
(`read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`, `multiedit`) is mechanically blocked and
the block reason steers the model toward a role-matched, spawn-mode subagent instead: a read-shaped
call routes to `explorer`, an edit-shaped call or a mutating shell command routes to `executor`,
and a merely read-only shell command (a `cat`, a `grep`, anything `classifyBashCommand` does not
flag as mutating) routes to `verifier`, on the reasoning that each role's own tool grant is already
capability-correct for the work being asked of it — `explorer` has no `bash` at all, `verifier`
has read-only `bash` for checks, and only `executor` carries both `bash` and the mutation tools.
Because c37's blocked set is a strict superset of c25's narrower edit-only set, and its branch in
the `tool_call` handler is checked first, the two compose without any explicit interlock code:
whenever both flags happen to be armed together, every call c25 would also have blocked instead
receives c37's reason, simply by virtue of running first — precedence by code ordering, not by any
purpose-built resolution logic. One category of work is deliberately left outside the enforcement
entirely: a plan item's `gate` command is executed by the engine itself, inside the `plan_write`
tool's own handler, never as a model-issued `bash` tool call, so it was never subject to blocking
in the first place and required no carve-out to preserve — the orchestrator's own deterministic
verification channel stays exactly as it was, and only a model's *own, additional* attempt to run
a verification command by hand gets redirected to `verifier`. The delegation-guidance prompt text
gains a new, short, list-shaped first branch under the flag ("every item = one subagent call…"),
and two lines of the general execution-discipline block are branched as well, for a very concrete
reason rather than mere tidiness: the legacy text told the model to derive completion evidence
from `git status`/`git diff`, which under this flag is now a blocked `bash` call — leaving that
line unchanged would have manufactured a guaranteed block loop, steering the model straight into
exactly the tool the flag has just taken away, so the flag-on variant instead tells it to cite the
`CHANGED`/`VERIFY` lines a subagent's own result already reports. One accepted, deliberately
undecided-against edge case is worth naming plainly: under `/plan <req> yolo`, the plan's phase is
`executing` from its very first moment, so even the initial exploratory reads a model would
ordinarily do for itself before writing a plan must, under this flag, be delegated to an
`explorer` subagent instead — which is not a carve-out oversight but is understood to be exactly
the candidate's own thesis playing out at its widest scope, and is flagged in the config's own
prediction text as the thing worth watching most closely for stalls. New telemetry
(`plan-runner/delegate-all-block`, keyed by the blocked tool name, and
`plan-runner/delegate-all-subagent`, keyed by which agent and mode the model actually chose) gives
a future round's report a direct compliance ratio — delegated calls against blocked-and-presumably-retried
ones — as the candidate's own mechanism metric, independent of whatever the gate's pass rate ends
up showing.

Both candidates ship dark, register their thresholds in `configs/schema.json`, and their
flag-off code paths are asserted byte-identical to the pre-existing behavior by dedicated tests —
the same discipline every candidate in this ledger is held to.

**A real measurement bug was caught and fixed before either pivot candidate could be tested
meaningfully.** `real_gate.sh` only ever granted the `subagent` tool when `task=="t4"` or
`PLAN_SUBAGENT_ONLY=1` — it never checked `PLAN_DELEGATE_ALL` or `SPAWN_DELEGATION`. c37's first
attempt (remote, against LFM25) ran with no `subagent` tool at all, meaning every blocked call fell
through to the "no subagent available, mark blocked and stop" path regardless of what the model
would otherwise have done — the round measured nothing about the candidate, only the missing tool
grant, compounded by LFM25's own severe instability that round. Fixed same-session: the tool-grant
conditional now checks all three delegation flags. **Direct evidence of the fix working**: c37's
subsequent local round confirmed `--tools read,edit,bash,subagent` on the candidate arm, matching
c36's independently-verified grant on the same code path.

**Local round (`c36-35b`, n=3): `VERDICT: NEUTRAL`** (above). **Local round (`c37-35b`, n=3):
`VERDICT: NEUTRAL` — but 18/18 clean on both arms**, the standout result of the whole ledger:
every single session succeeded under the "only `plan_write` and `subagent` allowed during
execution" constraint, and `cand`'s tool-call counts ran markedly higher than `base`'s on the
`bigdata` task specifically (34 and 43 calls vs. base's 16 and 16) — indirect but real evidence the
delegation mechanism was actually engaging, not sitting inert. The direct compliance metric
(`plan_runner_delegation.{blocked,delegated}`) wasn't yet wired into the eval row at the time this
round ran — fixed immediately after (`context_telemetry.py` now extracts
`plan-runner/delegate-all-{block,subagent}` the same way `bash-output-guard`'s `withheld` event
was wired earlier), so the *next* c37 round will carry the precise ratio directly in the row instead
of needing to infer engagement from tool-call counts.

**Reading the whole ledger honestly**: every one of the thirteen candidates tested tonight —
c25-c34 plus c36-c37 — came back `NEUTRAL`. That is the correct, expected shape of a clean
do-no-harm gate at n=3 with nothing broken; it is explicitly *not* the same as "proven to work."
The task set doing the grading (`parens`, `equil`, `bigdata`) is too easy and too small to give
most of these mechanisms — mandatory delegation, uncertainty pauses, SHA verification, redundancy
nudging — anything real to do; `calibrate.py`'s own discriminating-band logic (drop above 85% pass,
drop below 20%, ideal 30-70%) is the formal version of exactly this critique, and none of these
candidates has ever been measured against a task landing in that band *for the specific branch it
touches*. That gap is the direct segue into the next phase of work: designing (and, where existing
unadmitted fixtures already fit, hardening) task sets purpose-built to stress each of these
mechanisms, described in a forthcoming section of this ledger once that work lands.

*Companion: `LOCAL_LLM_HARNESS_RESEARCH.md` (the playbook + gap analysis this builds on).*
