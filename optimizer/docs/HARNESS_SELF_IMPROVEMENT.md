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
  (`FLEET_DONO`, default 3%), or win-rate < 60%, or val→held-out gap > 10% (overfit).
- else **ADOPT-TIERED** if the gain tracks capability (smaller models gain, daily flat) — maps onto
  loop-breaker's existing `thresh()` tiers; else **ADOPT-UNIVERSAL**.
- Overfit guard via the **held-out split** (6/20 SQL questions marked `heldout`): the rule compares the
  candidate's val vs held-out accuracy.

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

*Companion: `LOCAL_LLM_HARNESS_RESEARCH.md` (the playbook + gap analysis this builds on).*
