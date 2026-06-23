# Local-LLM Harness Research & Findings

Research + reflection on the pi.dev local-agent harness (`~/.pi/agent`): what we built and learned, the
external state-of-the-art playbook, and a ponytail-filtered gap analysis. Date: 2026-06-19.

**Bottom line:** the harness already implements ~90% of the documented agent-harness playbook. Most of the
external research is enterprise over-build for a single-user local harness. The one pattern that looked like
a gap — no-progress *reasoning*-loop detection — turned out to be **already implemented** in `loop-breaker`
(streak + repeated-reasoning detectors); the shippable improvement was a per-model-class **threshold tune**
so those detectors fire sooner on local models. See §4.

---

## 1. What we built / learned (this session)

### Shipped
| Change | What | Key learning |
|---|---|---|
| `drift-scanner.ts` | post-commit advisory dead-code/drift review by the **live session model** (`turn_end` → `git show HEAD` → `completeSimple`) | `completeSimple` needs auth resolved via `ctx.modelRegistry.getApiKeyAndHeaders` (it returns `stopReason:"error"`, doesn't throw); `reasoning:"minimal"` routes Qwen's chain-of-thought to a thinking block so the answer channel stays clean; **provider-qualify** model ids (`openai-codex/gpt-5.5`, not bare `gpt-5.5` → resolves to unauthed `azure-openai-responses`) |
| `vendor/pi-subagent` (forked `@mjakl/pi-subagent`) | subagents **follow the live `/model`** (threads `ctx.model`) instead of launch-argv | subagents were silently running on the settings default, not the session model; vendored a local fork so the patch survives `pi update` |
| `verify-gate.ts` | arm only on **source mutations** (`isSourceMutation`), not ops/infra; **compose-aware** steer | ops churn (installs, `docker compose up/down`, `git commit`) was re-arming the gate after a genuine pass → repeated nags + a false post-teardown "Blocked" |
| `APPEND_SYSTEM.md` | "**Observe, don't guess**" governor block | instrument + read the result before concluding (the headless-screenshot-loop lesson, applied to logs) |
| `npm/` + `.typecheck` + `scripts/pi-health.sh` | runnable `tsc` gate (fixed `paths` so it resolves), read-only harness validator | the `.typecheck` config never actually resolved modules; `bin/` is gitignored so the health script lives in `scripts/` |
| skill-surface prune | `~/.claude/skills` 135→trim; `~/.agents/skills` 114→3 for pi | pi loads `~/.agents/skills` every session; gstack/gsd/matt-pocock were noise; `skills` settings entries must be **dirs, not globs**; symlink the gsd group to the canonical `~/.claude/skills/gsd-*` so `gsd update` auto-propagates |
| `process-circleback` | chunk **per meeting**, not per date | a 5-meeting day was one oversized unit → local model stalled; the meeting is the atom |

### Failure modes hit + fixed
- **Subagent model mismatch** — ran local while the session was cloud (fixed: model-following).
- **Bare model-id → wrong provider** (`gpt-5.5` → azure, unauthed) (fixed: provider-qualify).
- **Verify-gate over-firing** on ops churn (fixed: source-mutation arming).
- **Local thinking-stall on an oversized task unit** — ~18 min looping in `thinking`, no tool calls; the
  cause was **scope/span** (5 meetings in one unit), not thinking. Fixed by per-meeting chunking.
- **Skills wouldn't load** via glob (must be a directory); **stale skill copies** after `gsd update` (fixed
  with symlinks to the canonical install).

### Measured local-model preferences (don't relitigate)
- `qwen36-35b-iq3s` (byteshape IQ3_S) runs **better WITH thinking on**, and byteshape **beats APEX** — both
  measured. The "Local AI is not Opus" article's thinking-off / higher-quant advice is for a different model
  gen; doesn't apply here. When a local run loops, look at **task scope first**, not thinking.

---

## 2. External playbook & failure-mode taxonomy

Synthesized from three research fan-outs (WebSearch + accessible papers/blogs; reddit bodies were
fetch-blocked, so r/LocalLLaMA items are snippet-level).

### Failure mode → mitigation
| Failure mode | Trigger | Mitigation | Detection / Prevention |
|---|---|---|---|
| Infinite / repetition loop | same tool+args 3+×; ambiguous tool feedback | debounce/loop-cap + nudge before hard stop; clear terminal tool states | both |
| **No-progress reasoning loop** | long `thinking`, no tool calls, no advancement | reasoning ceiling (force action after N reflection turns); progress/no-mutation check | detection |
| Context rot | 25+ steps, window fills; lost-in-the-middle; hallucinated filenames/APIs | compact at ~70% fill; recency pruning; goal externalization + re-anchor | prevention |
| Hallucinated/malformed tool calls | complex/ambiguous schemas; context exhaustion | strict JSON schema (`additionalProperties:false`); repair callback; tool registry check | both |
| Premature "done" / unverified handoff | shallow checks; optimism | outcome-based verify (run real tests); checklist vs goal; report output verbatim | both |
| Gives up / no clarification | ambiguity; low confidence | `ask_for_clarification` tool; retry budget; require N approaches before "impossible" | both |
| Destructive action w/o confirm | vague prose → `rm -rf`/`reset --hard`/force-push | allowlist + deobfuscate + diff preview + approval | prevention |
| Guardrail evasion | prompt injection; `--no-verify`; aliasing | semantic policy + LLM judge + audit; enforce hooks at harness level | both |
| Over-engineering / scope creep | open-ended task; no stop criteria | YAGNI in system prompt; scope checklist; velocity ceiling | both |
| Multi-step overflow (weak model) | 100+ steps; interdependent subtasks | hierarchical decomposition; per-step verify; route long-horizon → capable model | prevention |

### Architecture patterns
- **Plan-Execute-Verify (PEV) / reasoning sandwich** — capable model plans+verifies, cheaper/local executes.
- **Role-specialized subagents** (explore/plan/execute/verify), isolated contexts, per-role model tier;
  practical ceiling ~3–4 agents.
- **Context engineering** — progressive disclosure, compaction at threshold, goal externalization
  (`VISION.md`/`PLAN.json` re-read every N turns to fight drift).
- **Plan/TODO runner** — one task per iteration, fresh context, git as durability ("Ralph loop"); tune task
  granularity to model tier.
- **Compact governor + on-demand skills** — keep the always-injected prompt small; lazy-load skill files.
- **Model routing** — long-horizon/planning → cloud; bounded/review/explain → local; cascade local→cloud on
  low confidence.
- **Observe-before-concluding** — "done" = observable proof (tests green, logs/metrics in range), not exit 0.

### Selected sources
- Harness engineering: augmentcode.com/guides/harness-engineering-ai-coding-agents · arxiv 2605.25665
  (Meta-Engineering Harnesses) · medium @visrow "Harness Engineering for AI Agents in 2026"
- Verification loops: datadoghq.com/blog/ai/harness-first-agents · thenewstack.io "Loops are replacing
  prompts… verification" · github.blog "Validating Agentic Behavior"
- Context: redis.io/blog/context-rot · lethain.com/agents-context-compaction · arxiv 2606.10209
  (Less Context, Better Agents) · zylos.ai goal-persistence/drift
- Loops / no-progress: dev.to/aws "prevent reasoning loops" · arxiv 2603.10384 (TRACED, geometric progress)
  · arxiv 2512.13713 (LoopBench)
- Failure taxonomy: arxiv 2503.13657 (Why Multi-Agent LLM Systems Fail) · arxiv 2509.25370 (where agents
  fail) · marktechpost multi-agent failure modes
- Local-model specifics: blog.alexellis.io/local-ai-is-not-opus · medium @michael.hannecke "local agent
  knows when it needs a tool"
- Loop/Ralph engineering: explainx.ai loop-engineering · addyosmani.com/blog/self-improving-agents

---

## 3. Gap analysis — playbook vs our harness

### Already covered ✓
| Playbook pattern | Our implementation |
|---|---|
| Verify gate / red-green / observe-before-done | `extensions/verify-gate.ts` + governor "Observe, don't guess" |
| Tool-repeat loop detection | `extensions/loop-breaker.ts` (escalating tiers) |
| Context compaction / big-read guard | `extensions/context-watcher.ts`, `compact-tool.ts`, `context-inlet-guard.ts` |
| Role subagents + model routing | `vendor/pi-subagent` (model-following), `agents/{explorer,executor,verifier}.md` |
| Destructive-action confirm | `extensions/git-guard.ts` + `lib/command-policy.ts` (destructive classifier) |
| Compact governor + on-demand skills | `APPEND_SYSTEM.md` + `skills/` (ponytail etc.) |
| Plan/TODO runner + chunking | `extensions/plan-runner.ts`; process-circleback per-meeting |
| Independent review | `extensions/drift-scanner.ts` |
| Pre-flight health / typecheck | `scripts/pi-health.sh`, `.typecheck` |
| Anchor files / contracts | `AGENTS.md`, per-project `CLAUDE.md`/`AGENTS.md` |

### Deliberately NOT adopting (over-build for a solo local harness — ponytail rung 1)
| Pattern | Why skip |
|---|---|
| Vector-DB / RAG external memory | the wiki + git already are the durable store; no scale that needs it |
| OTel / Langfuse observability platform | `plan-runner` traces + `pi-health` are enough for one user |
| Geometric-curvature / latent-trace loop monitors | research-grade; a turn-counter heuristic catches the real case |
| Hidden-state "needs a tool" probes | not accessible via the OpenAI-compat endpoint; deterministic tools already own counts |
| Multi-layer guardrail stacks / red-team suite | single-user, local; git-guard + command-policy suffice |
| Auto model-router / capability classifier | `/model` is chosen deliberately; subagents already follow it |
| JSON-schema tool-call repair | pi already types tool calls (typebox); not our failure surface |

### No-progress reasoning loops — already covered (re-checked)
Closer reading of `loop-breaker.ts` shows this class is **not** a gap. It already has: a non-progress streak
detector (`STREAK_SOFT` → T1 nudge, `STREAK_HARD` → T3 hard-stop), a repeated-reasoning detector (hashes the
`thinking` block, fires at `REPEAT_T1`), repeated-tool-call detection, and an outcome-loop detector. A model
that loops in `thinking`/varied reads with no mutation does accumulate the streak and gets nudged/walled.

The one residual case — the `process-circleback` ~18-min stall on a single giant `thinking` block — was
**intra-turn** runaway, which a `turn_end` detector structurally cannot see (the turn never completes). That
is a server/generation knob, not a harness one; per-meeting chunking removed the trigger. The real, shippable
improvement was that loop-breaker's thresholds were calibrated for cloud and fired too late on local.

---

## 4. What shipped (the build)

**Per-model-class threshold tune in `extensions/loop-breaker.ts`.** The six tier thresholds were
one-size-fits-all (cloud-calibrated). Added a `thresh(name, cloudDef, localDef, isLocal)` helper and compute
the tiers per turn from `msg.provider`: local models get tighter defaults (REPEAT `2/3/5` vs `3/5/8`, STREAK
`8/20` vs `12/30`, OUTCOME `2` vs `3`) so the existing detectors fire sooner; cloud is unchanged; explicit
`LB_*` env vars still override both tiers. ~20 lines, no new machinery, one unit test
(`tests/loop-breaker.test.ts`).

Explicitly **not** built: a separate no-progress detector (loop-breaker already covers it, see §3) or an
intra-turn thinking guard (not observable at `turn_end`; local thinking stays ON by measurement —
[[local-model-thinking-and-quant]]). Everything else in the research is already in the harness or
intentionally out of scope.

---

*Companion memory: `local-model-thinking-and-quant`, `pi-extension-call-session-model`,
`pi-prompt-techniques-and-symbolect-ab`.*
