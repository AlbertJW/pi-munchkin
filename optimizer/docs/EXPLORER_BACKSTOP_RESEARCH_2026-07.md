# Backstopping the explorer subagent with a repo map (+ ISONGraph): research

Question asked: could a repo map, encoded with something like
[ISONGraph](https://github.com/isongraph/isongraph), backstop the `explorer` subagent?

Short answer: **the idea is sound and the prerequisites are missing.** Three blockers, each
measurable today, in the order they'd have to be cleared.

## Blocker 1 — the explorer has never been measured. Not once.

| | |
|---|---|
| rows scanned | **1,466** |
| subagent delegations recorded | **0** |
| `plan_runner_delegation.delegated` across the catalogue | **0** |

The cause is mechanical, not behavioural: the gate's base tool list is
`read,edit,bash,plan_write` (`real_gate.sh:63,577`). **`subagent` is appended only when a
delegation flag is on** (`real_gate.sh:588` — c25/c36/c37, or c45's `PLAN_STEP_CONTEXT=spawn`).
So in every baseline session ever run the explorer was not callable, and in the candidate arms
that did grant it, the delegation blocks never activated (the `phase:"planned"` dead end).

We therefore have **no data on how the explorer fails**, how often it would be used, or what it
costs. Backstopping it now would be optimizing a component we have never observed — the exact
mistake the rest of this ledger is a record of.

## Blocker 2 — the fixtures cannot exercise a repo map

A repo map answers *"where is X in a codebase I can't hold in context."* Our fixtures have no
such problem:

| | files |
|---|---|
| pi_munchkin (real repo) | **506** |
| largest fixture (`hygiene-shared-config-reread`) | 7 |
| typical fixture (`parens`, `equil`, `path-near-miss`) | **3** |

Measured read behaviour across 1,466 sessions confirms it:

- **median 2 reads/session, median 1 _unique_ read**
- **19%** of sessions read zero files
- only **1%** read more than 10

At a median of one unique read there is nothing to navigate. A repo map would *add* context
(the map itself) to solve a problem that does not occur, and the effect would be
indistinguishable from noise — before even reaching the power limits documented in
`CANDIDATE_PRUNING_2026-07.md`.

**This is a fixture gap, not a feature verdict.** In a 506-file repo the explorer plausibly does
face the navigation problem. We simply have no fixture that represents one.

## Blocker 3 — ISONGraph is the right shape at the wrong stage

ISONGraph compresses **property-graph payloads** for LLM context (~70% vs JSON, MIT, multi-language).
A repo map *is* graph-shaped — files → symbols → references — so the fit is real in principle.

But today there is no graph payload in our context at all. Context is consumed by:

| | share of context |
|---|---|
| largest single tool result | 49.7% |
| stale tool results | 37.5% |
| repeated 5-token shingles | 12.5% |

That is file contents, `node --test` output and bash output. Compressing graphs we never send
saves nothing. And the encoding of a repo map is the *last* problem to solve, not the first —
aider's proven design (tree-sitter + PageRank) emits plain text and works. Maturity also argues
for waiting: **3 stars, 14 commits**, planned features unreleased.

## What would actually have to happen, in order

1. **Make the explorer reachable and measure it.** Grant `subagent` in the base gate tool list
   (or add a dedicated flag) so baseline sessions can delegate at all, then collect real usage:
   how often, on what, at what token cost, with what answer quality. Cheap, local, no new code
   beyond the tool grant.
2. **Build a fixture with a real codebase.** Dozens of files, non-obvious structure, a task whose
   answer requires locating something. Without this, no navigation aid — repo map, span-tools, or
   otherwise — can produce a measurable signal. Note `span-tools` (c13) already exists for
   *within-file* navigation and is itself still unmeasured for the same reason.
3. **Only then** consider a repo map, and only then consider its encoding. If the map turns out to
   be large enough in context that its serialization matters, revisit ISONGraph — by which point
   it may also be more mature.

## Verdict

Not useful yet, and the reason is worth more than the answer: **we cannot evaluate an explorer
backstop because we have never evaluated the explorer.** Step 1 is a one-line tool grant plus a
measurement round, and it unblocks span-tools, the delegation cluster (c25/c36/c37) and any future
repo map at the same time.
