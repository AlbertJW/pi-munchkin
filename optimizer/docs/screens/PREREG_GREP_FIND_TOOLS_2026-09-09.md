# Pre-registration: grep/find tools activation screen (2026-09-09)

> **STATUS: PREPARED. No stage of this study may be started without Albert's explicit,
> per-stage approval.** This document is committed before any data it governs, as
> `PREREG_FIXTURE_ADMISSION_2026-08.md` requires. It declares the mechanism screen for
> the dark candidate `GREP_FIND_TOOLS=on`; a powered trial, if run, is governed by the
> staged pipeline exactly as committed.

## 1. Candidate

`optimizer/prompt-lab/configs/static/c51-grep-find-tools.json`, frozen at this commit.
Control is `configs/baseline.json`. The candidate's sole delta is `GREP_FIND_TOOLS=on`.

**What this is:** pi v0.80.6 ships builtin grep (ripgrep-backed, capped output, glob support)
and find (fd-backed, relative paths) tools, fully implemented but registered-and-inactive by
default at the session top level (only read/bash/edit/write are active). This candidate
activates them by adding "grep" and "find" to munchkin's harness/lib/tool-activation.ts
CORE_NAMES set, bringing them into the default active surface.

**Rationale:** Research (2026-09-09 zvec-grep/LSP analysis, verified 3 dimensions) established
that grep/find are structurally unavailable to small models via the default surface today,
despite existing in the pi core. The tools are proven (shipped in pi, used in subagent
delegation tier). Activation costs ~2KB schema tokens (negligible; builtin tools are excluded
from context when inactive anyway) and zero new dependencies. Efficiency baseline: bash can
still shell ripgrep/fd manually; the dedicated tools provide result capping and formatting
only. This is a rung-2 win: stdlib first, and these are stdlib-equivalent (pi core, not an
external lib).

## 2. Subject and stratum

**Model: qwopus35-4b** (local Mac stratum, same as c48/c49/c50 baseline). Chosen because:
- it drives the harness (473 tool calls, 12 calibration rows, zero reward-hacking)
- multi-file search patterns are observable at this tier (grep/find calls in bash histories)

Alternately: Ornith-1.5 9B, if the goal is to measure on a "default" small model (measures
well, different tool-call profile; compare to 4B for tier-specific variance).

## 3. Mechanism screen (small exploratory fixture)

**Fixture:** any existing search-heavy fixture (sweep-a, sweep-b, or ling-cross-file-contract
if search patterns are confirmed in its trajectory logs). OR:

Create a minimal, purpose-built mechanism fixture (~2–4 sessions) that:
- Requires finding a specific symbol/pattern across multiple files (grep/find are necessary)
- Has a clear pass/fail criterion (symbol found and cited correctly)
- Does not expose the answer via other tools (no LLM context, no unrelated tool calls)

**Measurement:** trajectory.search_spans + trajectory.bash_ripgrep counts (already collected
for every run). If activation changes the call patterns (bash-rg → grep tool, or find
call counts), the mechanism screen confirms the switch. If no change (small model never uses
grep despite it being available), the candidate stays dark (cost-only, no mechanism).

**Outcome:** mechanism screen is a go/no-go gate. If grep/find calls appear and task success
rate is non-negative (ties pass), advance to a powered trial. If success rate drops OR if
grep/find are never called (availability doesn't matter because the model doesn't search),
the candidate is retired.

## 4. Powered trial (if mechanism screen passes)

If the mechanism screen shows grep/find are actually called and task success doesn't drop:

- Fixture slate: search-specific subset of the fixture pool (fixture-band or ling cohort,
  whichever has the most multi-file search tasks)
- n: 12–18 per arm (target power ~60% for small effect sizes, given prior variance)
- Model: qwopus35-4b (primary); Ornith 9B as a secondary stratum if tier differences are
  worth measuring
- Outcome metric: pass-rate and token-efficiency (the candidate should not increase total
  token spend on grep-heavy tasks; savings in bash output processing count as a gain)

**Verdict labels:**
- ADOPT-universal: pass-rate +3pp or better, token-efficiency neutral or positive
- ADOPT-cohort: pass-rate +2pp on search-specific fixtures only; keep dark elsewhere
- NEUTRAL: pass-rate ties, efficiency ties
- REJECT: pass-rate -2pp or worse, OR search-heavy fixtures show no grep/find usage
  (candidate doesn't matter)

## 5. Decision rule

Mechanism screen (go/no-go): if grep/find are never called despite being available, RETIRE
the candidate and mark in CANDIDATE_STRATEGY.md as "availability doesn't drive small-model
usage; context overhead unjustified." Otherwise, advance to powered trial.

Powered trial (if run): require Fisher exact p<0.05 (one-sided, harm-detection mode) for ADOPT.
NEUTRAL or REJECT verdicts keep the candidate dark, per ADR-0006 adoption checklist. No
graduation without explicit passing verdict.

## 6. Reference

Related docs:
- `optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md` §15–18 (trial structure, verdict labels)
- `optimizer/docs/adr/0001-gate-tools-allowlist.md` (GATE_BASE_TOOLS, tool grants)
- `optimizer/docs/adr/0006-candidate-graduation-and-retirement-playbook.md` (adoption checklist)
- `harness/lib/tool-activation.ts` (CORE_NAMES set, mechanism for activation)
- `harness/extensions/span-tools.ts` (prior art: search tool, adopted by judgment)

**Pre-1.0 blockers:** tool-activation.ts CORE_NAMES must be wired correctly (verify against
grep/find schemas in pi-coding-agent dist/core/tools/). Telemetry for grep/find (trajectory
field names) must be confirmed present in run-*.sh reporters before trial starts.
