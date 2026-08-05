# Dark-candidate verdicts — 2026-08-03

**What this is.** A judgment pass, not a measurement round. Albert asked for a no-testing
decision on which of the ~36 dark candidates have merit; two actions were put to him and
approved before execution: **adopt c48-view + c28 + c24 live**, and **execute the retirement of
c7, c14, c32, c37, c50**. Everything here is decided on mechanism reasoning plus the existing
corpus (1,839 rows), under the standing doctrine that the binary gate is a one-sided regression
detector (`CANDIDATE_STRATEGY_2026-07-31.md` §1) — which is precisely why a judgment call, made
honest about being one, beats waiting for an instrument that cannot show a win.

The doctrine's own escape hatch does the load-bearing work for adoption: **additive mechanisms
cannot produce the harm signature.** Every measured harm in this corpus came from a blocking or
steering candidate; the adopted three only ever append.

---

## ADOPTED — default-on in the live harness (Albert-approved)

> **Revision 2026-08-04 (explicit human gate):** the c48 default was changed from per-call
> `view` to event-driven **`steer`** — same adoption, lower cost point (no per-call KV-prefix
> break). `STATE_LENS=view|both` restores the per-call lens; `off` still kills. The table row
> below describes the 08-03 decision as made; the live default is `steer`. See
> `docs/SURFACE_BOUNDARIES.md` for the resulting surface boundary.

| c | mechanism | kill switch | grounds |
|---|---|---|---|
| **c48 state-lens (view)** | ground-truth session-state lens appended per LLM call at the `context` hook; non-accumulating; model never authors its own memory | `STATE_LENS=off` | Targets repeat spirals — the measured binding constraint (top 10% of sessions carry 43% of wasted calls). Mechanism proven firing: 265 injections over two rounds, 6/6 targeted. Purely additive. Accepted cost: per-call KV re-prefill (median session ~4.9k tokens; small, and the honest-cost comment stays at the append site). `prefix_stable_rate` cannot see it (§13) — treat that 1.0 as unmeasured. |
| **c28 teach-hints** | one deterministic teaching line appended to matching tool ERROR results; `isError` untouched; per-rule kill switches | `TEACH_HINTS=off` | Largest authoritative n in its group (36 sessions), no harm signal; the sole miss was a serving artifact. Error spirals are the constraint; a deterministic hint at the error site is the cheapest possible intervention against them. |
| **c24 did-you-mean** | deterministic "closest existing path" line appended to read/edit ENOENT error results | `DID_YOU_MEAN=off` | "Fires only on its purpose-built fixture" was a criticism of the measurement venues (saturated fixtures with no typo pressure), not of the mechanism. Live models invent paths they never read — the README's own words. Additive, ENOENT-only, cannot touch a healthy call. |

Their three configs are **deleted**, deliberately: with the flag default-on, each config's cand
arm became the base arm — exactly the Tier 0 "structurally inert config" trap the 2026-07-31
guard exists to catch. Measuring an adopted mechanism now requires a **suppression** arm
(`X=off` + `exposure.mode: suppression`), a new config, and `suppression_confirmed()`.

**Honesty box.** These adoptions are unmeasured by construction — the instrument cannot show
the win they would need, and no A/B ran on the new surface. What is claimed: the mechanism
class cannot regress correctness pathways, the mechanisms demonstrably fire, and they aim at
the measured constraint. What is NOT claimed: that they help. Live telemetry
(`state-lens/view-injected`, `teach-hints/hint`, `did-you-mean/hint`) is the running receipt of
the first claim, and any future round re-baselines on the new surface hash regardless.

## RETIRED — executed (Albert-approved)

| c | grounds (each candidate's own criteria, not fresh judgment) | what was deleted |
|---|---|---|
| **c7 verify-gate-steer** | measured harm on two models: `qs-error-swallow` 6/6→3/6 (SAFETY_HOLD), remote gemma 67%→22% (−44pp); the steer engages (`verify-gate/steer` ×4) and the work gets worse | config (the mechanism was only a `PI_MSG_VG_STEER` text override; the generic messages channel stays) |
| **c14 slug-tags** | mechanism hypothesis independently refuted — jnoise AUC 0.614, CI straddles 0.5 | config; `HASHLINE_TAG` write path + slug acceptance in `hashline-core.ts`; `tag-words.ts`; slug tests (the hex zero-drift test survives, renamed) |
| **c32 sha-guard** | met its own declared retirement condition: zero fabricated-SHA events anywhere in the ledger, ever — all four SHAs models actually cited verified genuine | config; `PLAN_SHA_GUARD` branch in `plan-runner.ts`; `shaCandidates` in `plan-integrity.ts` + tests; `plan-runner/sha-guard` catalog entry |
| **c37 plan-delegate-all** | 0-for-2 with adverse effort (35B +70% turns, +200% tool_errors, 2× context; 4B 9/9→7/9; remote −33pp); the drafted retirement diff executed as specified | config + `c37-c38-c39-combo`; both `PLAN_DELEGATE_ALL` tool_call blocks, the delegationBlock branch and governor ternaries in `plan-runner.ts`; `delegate-all-{block,subagent}` catalog entries; 8 tests; schema field |
| **c50 spec-adherence** | motivating observation was a harness artifact (the gate never materialized `docs/`, so "12/12 guessed conventions" was measured against a spec not on disk); read-detection was dead code from the first commit | config; `spec-adherence.ts` + tests; both catalog entries; manifest + package-smoke rows; schema field |

Result rows are kept — rows are history; configs are the live roster. Roster: **36 → 27**
configs on disk (6 retired + 3 adopted removed).

## KEPT DARK — merit, needs measurement (no action)

Ordered by my judgment of merit:

1. **c46 prompt-lean** — the shape of the only thing that ever worked (governor subtraction,
   83%→89%→97%). Rationale still stands: 18/18 sessions stranded at `phase:"planned"`,
   delegation counters zero — the plan-workflow prose feeds a machine nobody drives. **Not
   adopted precisely because it edits the live governor**: the named risk (losing the
   `/plan-go` affordance suppresses `plan_write` entirely) is a correctness pathway, so it
   stays a measurement candidate. First in line if the optimizer ever restarts.
2. **c21 micro-gate, re-specified** — the steelman survives (a parse error surfaced at
   `turn_end` instead of five turns later); per-call it improves in 5 of 7 pairings, pooled
   −5.9%. Disqualified from adoption by the truncation confound and two large-n pass-rate
   drops. Re-run only with errors-per-call as the pre-registered primary.
3. **c26 read-dedup** — aims squarely at the constraint (repeat reads), append-safe by design,
   but it *transforms* context rather than adding to it — one class riskier than the adopted
   three — and its declared guardrail (`prefix_stable`) is blind (§13). Needs the lens-aware
   prefix metric first.
4. **c39 plan-tool-go + `c25-c38-c39-combo`** — enablers. c39's path is proven clean (zero
   `go-blocked` ever). Worthless standalone, necessary if c25 is ever measured. With c37 gone,
   c25 is the combo's only remaining client.
5. **c25 plan-subagent-only** — the one blocking candidate with a live positive signal
   (4B 5/9→7/9, all five metrics better), but that signal is post-hoc and its powered round
   was invalid. Blocking class = the only class that ever measurably hurt; never adopt on
   judgment.
6. **c13 span-tools** — sound bounded-tool engineering; the fixture class it targets was never
   built. Fine to arm live ad hoc when a large-file task shows up.
7. **c35 bash-output-guard** — trigger observed exactly once in the wild; withholding output is
   steering-class, so not adoptable on judgment, but the mechanism is reasonable protection.
8. **c30 context-brief** — additive, but "context is not the constraint" argues against paying
   tokens every session for discovery savings; evidence directionless on a void fixture.
9. **c29 micro-gate-slop** — plausible; never saw a venue that tempts a shortcut.
10. **c2 scaffold-cot** — the sweep's largest apparent effect (+44pp) failed replication at
    doubled n on a second model; both rounds below their own detection floors.

## RETIRE-LEANING — left to the 2026-09-03 win-or-retire clock (recorded only)

- **c27 redundancy-nudge** — asks the model to compact; the corpus says asking fails
  (2 completed compactions in 1,839 rows). Its own config names this as its rejection rule.
- **c31 plan-uncertainty** — in the one round where the model planned voluntarily (3/3
  sessions), it never once populated `uncertainties`. The steering text, not the hold, is the
  broken link — and rewording steers is c7's failure class.
- **c38 force-plan-write** — enabler only; induces fabricated completion claims on gemma
  (0/9 with "tests passed" over red gates). Never arm on that model family. Its remaining
  client is the c25 chain.
- **c4 / c6 / c10 / c18 / c18b / c19** — legacy remote-sweep arms, all below their own designs'
  detection floors; nothing to decide. (c10 gains mild interest only because c7 showed the
  verify-gate steer text can *harm* — a suppression round pricing the gate is legitimate
  future work.)

## Flagged for Albert — the one defect-shaped item deliberately left

The c51 observation is really a **live loop-breaker blind spot**: a REJECTED `plan_write`
still calls `resetEpisode()`, because `hasProgress` is computed from tool *names* on the
assistant message, never from results (`loop-breaker.ts` progress block). A model rewriting an
invalid plan ten times reads as ten turns of healthy progress — the same shape as the grinding
bug that became the project's one credited win. Left unfixed **on purpose**: it is
model-visible steering-timing behaviour, the phenomenon has never been observed in a
transcript, and the standing rule says such changes ship dark behind a flag — which would make
it a new candidate, which is what this document exists to stop doing casually.

## Bookkeeping

- Surface hash moves again with these flips (model-visible); the new value is recorded in
  `HANDOVER.md` and the ledger. Rows before/after do not pool.
- The three adopted mechanisms' telemetry events stay in the catalog — they are now live
  baseline events, like `loop-breaker/steer`.
- `README.md` flag table, `HANDOVER.md` roster counts, and `MOTHBALLED_2026-08-03.md` updated
  to point here.

---

## Appendix (2026-08-05): external ideas noted, not built — hermes-agent survey

Albert asked whether NousResearch's `hermes-agent` would supplement this harness. Verdict:
**no as a framework** — it owns its own agent loop (replacement, not extension), and its core
bet is *model-authored* memory/skills, the exact bet this corpus refuted for small models
(blind-invention AUC 0.95; c38's fabricated completions; 1 voluntary subagent call in 942 base
sessions). A small model curating its own skill library persists confabulation across sessions.
Its skill-injection mechanism is governor prose with a growth rate, and prose measured harmful
(83%→97% as it was removed).

**Two ideas worth keeping as future candidate seeds, recorded here so they are not re-derived:**

1. **Cross-session transcript search** (Hermes: FTS5 over past conversations + LLM summaries).
   As a pi tool it would be bounded, deterministic retrieval — mechanism-shaped, span-tools-like.
   Counterweight from our own corpus: it adds context to models that fail from turns and
   context, and the median session uses ~4.9k tokens, so cross-session recall is not the
   measured constraint. Shape: dark candidate, `SESSION_RECALL=on`, telemetry-mode exposure,
   fires only on an explicit tool call. Plausibly useful for the *interactive* daily driver
   before it is ever measurable on gate tasks.
2. **The agentskills.io skill file format as a container for HUMAN-authored, trigger-scoped
   snippets** — structurally teach-hints with a directory: deterministic trigger, fixed text,
   per-skill kill switch. The self-improvement half (agent-curated skills) is explicitly
   rejected; only the human-curated container shape is noted. Shape: an extension reading
   `skills/*.md` with declarative trigger rules, dark until someone wants it.

Neither is built. Neither should be built casually — both add model-visible context, so both
would ship dark behind flags with numbered configs, and the measured constraint (repeat
spirals) argues neither is the next thing that matters.

## Appendix (2026-08-05): anneal survey — the opposite prescription, same diagnosis

`tinytownsoftware/anneal` — an external Python orchestrator over the SAME substrate (pi as a
headless worker, local Qwen 30–35B-class models): decompose a goal into small tasks, spawn a
fresh lean `pi -p` per task with `--no-extensions`, verify per task with bounded retries
(default up to 100), controller owns git (model commits blocked by hook), state threads forward
through git history instead of a context window. ~9 commits, no telemetry, no measurement.

**Verdict: complementary layer, not a competitor — and not adoptable on current evidence.**
It is "mechanism beats persuasion" applied at the *process* level: where c37/c25 asked the
model to orchestrate (and measured 0-for-2 adverse), anneal never asks — deterministic code
orchestrates. It is c18 fresh-retry promoted to the default, and our own gate is anneal-shaped.

Against it, from this corpus: (a) **per-attempt amnesia** — 100 fresh retries with no
cross-attempt repeat detection is the grinding failure class externalized, with no
loop-breaker; (b) `--no-extensions` strips the evidence-backed layer (hashline, the adopted
hints); (c) the v4 weave precedent — engine-owned dispatch was built here once, measured
nothing, and was deleted 2026-07-20 (distinction: weave dispatched in-session and needed model
cooperation; anneal is fully external and needs none — a reason it *might* work, not evidence);
(d) zero rows.

**The decisive observation:** anneal's claimed benefit lives exactly in this fixture set's
blind spot. The corpus median is 11 turns / ~4.9k tokens — decomposition has nothing to buy
there. The long-horizon venue where it should win is what `audit-sweep` was built for, and
`audit-sweep` has 0 rows. **Best-shaped experiment available on restart:** anneal-orchestrated
vs single-session on `audit-sweep`, graded; hybrid arm = anneal orchestration with workers
pointed at `~/.pi/agent` (keeping hashline/hints/loop-breaker) instead of `--no-extensions`.
Box-gated; recorded, not built.
