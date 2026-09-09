# Next goal — evidence-first deep-research orchestration

> Retired on 2026-09-08 at Albert's request. This is a historical proposal,
> not an active goal, follow-on queue, or authorization to run a screen.

Status: first implementation slice delivered 2026-09-07 as G04. The typed
research-round ledger, parent-only round tool, shared reservations, and
settlement gate are implemented but remain dark. Jina search, adaptive shaping,
and the Qwen 35B research-shaped evaluation remain follow-on work; this slice
does not replace the historical Qwen parent-synthesis diagnostic.

## Goal

Turn deep research into a resumable, evidence-first orchestrator that adapts
query generation, retrieval, reading, and synthesis to the active model's
context budget while preserving the parent-authoritative plan graph, bounded
budgets, and parent-verified citations. It should make the next useful research
move from named evidence gaps, not from an open-ended request for more text, and
it must stop only when the graph and evidence ledger prove that stopping is
safe.

## Why this is the next useful seam

OpenDeepResearcher demonstrates a simple loop worth borrowing: an LLM proposes
several search queries, searches run concurrently, pages are fetched and
filtered, the model proposes another round when the evidence is incomplete,
and a final report is generated from the accumulated context. The project
describes those behaviours in its [README](https://github.com/mshumer/OpenDeepResearcher),
and the notebook shows the concrete implementation in
[`open_deep_researcher.ipynb`](https://raw.githubusercontent.com/mshumer/OpenDeepResearcher/main/open_deep_researcher.ipynb).

That implementation is a useful foil rather than a drop-in dependency. It
parses model output with Python `eval`, lets the model's `<done>` token end the
loop, deduplicates links only within an iteration, joins every extracted page
into one growing context, and has no durable claim-to-source ledger or resume
protocol. Those choices are unsafe for this harness and directly overlap with
the failure mode now being diagnosed: a model can spend its turn narrating
synthesis without producing the authoritative parent evidence transition.

The harness already has the stronger primitives this project lacks: a global
3-search/5-read envelope, canonical URL and query reservations across child
processes, parent-validated evidence cards, typed branch reports, private
durable state, and model-aware context epochs. The next goal is to make those
primitives drive the research loop instead of leaving the loop mostly to the
model.

## First implementation slice

1. Add a typed research-round record and event sequence. Each round names the
   unmet claim obligations, proposed queries, selected source leads, triage
   decisions, consumed budget, and the next allowed action. Validate all model
   responses as JSON-schema-shaped data; never evaluate model text as code.

2. Add an optional Jina search backend beside Ketch. `s.jina.ai` can return
   search results with extracted page text, while `r.jina.ai` can turn a single
   public URL into model-friendly text. Keep both behind explicit dark flags,
   preserve the original URL for citations, and apply the existing public-URL,
   timeout, output-cap, reservation, and evidence rules. Jina documents the
   search/read split and bounded response controls such as `x-max-tokens`,
   `x-target-selector`, and `x-engine` in its [Reader documentation](https://github.com/jina-ai/reader/blob/main/README.md).

3. Make stopping a verifier decision. A model suggestion such as `<done>` is
   only a proposal. The parent may settle only when required claim obligations
   have parent-validated cards, no source is marked truncated or conflicting
   without an explicit gap, all graph nodes are terminal, and the remaining
   budget cannot buy a named improvement. Otherwise the loop records a bounded
   gap or asks for one specific next action.

4. Make context progressive and model-aware. Store page bodies in a private
   cache, expose bounded excerpts or claim-focused rereads, and size each read
   from the current context epoch. Prefer a short evidence-card index in the
   parent turn; retrieve more text only for a named claim or conflict. This
   prevents the `"\n".join(all_contexts)` growth pattern in the reference
   notebook from consuming the turn needed for settlement.

5. Add source-quality and conflict signals without pretending they are truth:
   primary-source preference, host diversity, publication-time cutoffs,
   duplicate canonical URLs, failed/truncated reads, and explicit competing
   claims. These signals guide the next query and appear as evidence gaps; they
   never silently upgrade a search result into a citation.

6. Complete the durable parent handoff. When late child results make a graph
   terminal, queue exactly one parent synthesis turn that rereads delegated
   URLs, records cards, and either settles or leaves a value/risk/rationale
   gap. The handoff must be idempotent across compaction, restart, and duplicate
   child-result arrival.

## Evaluation gate

Keep `PLAN_GRAPH`, `DEEP_RESEARCH_PLANNING`, and the new Jina-search flag off by
default. Build a deterministic fake backend and provider first, then run a
fresh, hash-bound research screen with comparative, contested, and multi-part
fixtures. Compare Ketch-only, Jina-read fallback, and hybrid search arms under
the same model, context epoch, source cutoff, and global budget. Require three
candidate runs with parent-validated settlement, zero timeout-induced open
branches, no unverified citations in the final answer, and no evidence or
context leakage across arms before considering any default change.

The first code change should therefore be a test-backed research-round/state
machine plus the late-merge parent follow-up from the active diagnostic. Jina
search, adaptive read shaping, and source-quality heuristics should follow as
separate dark, reversible boundaries so a formatter improvement cannot be
mistaken for a research-quality improvement.

## Explicit non-goals

Do not import the notebook runtime, SERPAPI dependency, OpenRouter dependency,
or its prompt-only stopping logic. Do not accept model-generated quotes as
parent evidence, pool results across surface or serving-epoch changes, mirror
the feature, or let an external search service become an evidence authority.
