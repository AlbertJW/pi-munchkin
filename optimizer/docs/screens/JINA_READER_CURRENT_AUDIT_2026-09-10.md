# Audit: current Jina Reader extraction screen (2026-09-10)

## Result

This is a clean, narrow retrieval mechanism/utility receipt. The private,
mode-0600 artifact has SHA-256
`e84a2a94292a27b5c55ba6304e2e53a5044e2891df42a5bf76db3bc5b82894b7`.
Run `b508a28c-c27f-4094-bae3-b86444c369a6` used approval
`05403a73dc797b7d5447813c06d56fd04e4b0b20bd184bdc0303982fc4580ed7`.

All four capped reads completed without timeout, abort, process truncation, or
row error, and every Reader-wrapped response unwrapped exactly to its original
source identity. With the 4,000-character cap, direct Ketch found 3 of 4
frozen required terms; Reader found 4 of 4. Aggregate elapsed time was 87 ms
for direct Ketch and 42 ms for Reader in this single local observation.

## Limits and decision

The GitHub README was one source snapshot, and the timing has one replicate;
the result is not a general latency promise. The frozen term markers proxy
extraction usefulness, not research-answer quality, citation behavior, context
cost in an agent session, or web availability. Reader's source identity and
the existing cancellation/output/citation bounds were not weakened.

`JINA_READER=on` remains dark and unresolved. A later fixed-corpus task-model
screen should compare supported answers and context cost before any scoped
adoption proposal. No default, mirror, deployment, or adoption decision
changed.
