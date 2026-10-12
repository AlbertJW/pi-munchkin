# Planned research (graph, ledger, research rounds)

Read this only when `research_plan_start`, `research_round`, or `research_note` is available. It extends the workflow in `../SKILL.md`; everything there still applies.

## Starting a plan

- If the question is contested, comparative, multi-part, or needs delegation and `research_plan_start` is available: call `capability(action="enable", family="planning")`, then `research_plan_start`, before any `web_search` or `web_read`. Supply explicit `claim_obligations` whenever possible (stable IDs, required/optional status, what is missing, why it matters, the next useful action). Allocate at most three searches and five discovery reads across the branches.
- Copy each returned `plan_context` unchanged into its matching `research-planner` subagent call. Delegate to `research-planner` (not `researcher`) while a plan graph is active.

## Budgets

- In a plan graph the assigned branch budget is a hard wall; a refused overrun must become an evidence gap, not a retry.
- With `RESEARCH_LEDGER=on` the 3-search/5-distinct-read envelope is a hard wall outside a graph too. `RESEARCH_BUDGET=on` enforces only that wall, without citation tools.
- A cached URL avoids another network fetch but still consumes a source-read unit under a plan.
- With a plan graph, normalized queries and canonical result URLs are reserved in a run-scoped index shared by parent and children, so siblings cannot spend the same search twice.
- If a direct read fails and the Jina Reader fallback is available, allow one bounded fallback; cite the original URL, never the `r.jina.ai` formatter URL.

## Recording

- Call `research_round` with `action="record"` before/after each bounded retrieval round: selected gap IDs, query proposals, canonical source leads, read receipts (method, truncation, parent validation), evidence-card metadata, conflicts, proposed next action. These are typed data, not a place to paste page text or child quotes.
- If `research_note` is available, call it immediately after each `web_read`, once per material claim, with ONE short sentence copied exactly from the page. If it names a different source for a multi-page read, cite that source. If it says the quote is in no page you read, re-quote a short exact span once or mark the claim `[unverified]` — never retry the same quote a third time (repeated failures can trip the loop-breaker and abort the session).
- Delegated citations stay unverified until the PARENT rereads the URL with `web_read` and records the note from the parent's own result.

## Iteration and coverage

- Generate follow-up queries from unmet claim obligations, not from a generic wish for more research. Inspect `research_round` before deciding whether to search, read, validate, synthesize, or stop. Exhaustion is an explicit evidence gap, not permission to mint a fresh allowance.
- Answer readiness is separate from graph terminality: a blocked required branch cannot settle; an optional gap needs an explicit value/risk/rationale deferral.
- Planned branches carry a structured coverage receipt. Use direct/bounded coverage for ordinary web research; exhaustive coverage only when a retrieval tool exposes an exact total count. Truncation or budget-limited uncertainty is incomplete: defer it with value/risk/rationale instead of marking it done.

## Settling

- Evidence cards are compact metadata (original URL, content digest, claim mapping, truncation, parent-validation state); they never replace rereading.
- Mark all branches terminal, call `research_round` with `action="settle"` after every delegated source used in the answer has been reread and recorded by the parent, and only then call `plan_settle`.
- For the v1 deep-research contract pass the complete answer in `final_answer`; it may cite only URLs represented by parent-validated, non-truncated evidence cards. A child may settle its branch but never the head plan. Settlement delivers `final_answer` once and ends the research loop; do not request another research turn after it succeeds.
