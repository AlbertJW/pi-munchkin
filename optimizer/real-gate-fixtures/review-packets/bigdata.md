# Fixture review: bigdata

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

data/events.jsonl holds ~4000 event records (one JSON object per line: id, user, amount, status, ts). Compute the 3 users with the highest total `amount` summed over their status:"ok" events only. Write the result to src/top3.json as a JSON array of exactly three objects [{"user": "...", "total": ...}, ...] sorted by total descending, totals rounded to 2 decimals. The file is large — query it rather than reading it whole. When `search_spans` is available, call it on data/events.jsonl so its exhaustive execution receipt proves full-corpus coverage; then use node or awk to aggregate. Run node --test and ensure the existing tests still pass.

## Hidden expectation sufficiency

- **src/top3.json holds the top-3 users by total ok-amount, descending** — data/events.jsonl holds ~4000 event records (one JSON object per line: id, user, amount, status, ts). Compute the 3 users with the highest total `amount` summed over their status:"ok" events only. Write the result to src/top3.json as a JSON array of exactly three objects [{"user": "...", "total": ...}, ...] sorted by total descending, totals rounded to 2 decimals. The file is large — query it rather than reading it whole. When `search_spans` is available, call it on data/events.jsonl so its exhaustive execution receipt proves full-corpus coverage; then use node or awk to aggregate. Run node --test and ensure the existing tests still pass.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

data/events.jsonl holds ~4000 event records (one JSON object per line: id, user, amount, status, ts). Compute the 3 users with the highest total `amount` summed over their status:"ok" events only. Write the result to src/top3.json as a JSON array of exactly three objects [{"user": "...", "total": ...}, ...] sorted by total descending, totals rounded to 2 decimals. The file is large — query it rather than reading it whole. When `search_spans` is available, call it on data/events.jsonl so its exhaustive execution receipt proves full-corpus coverage; then use node or awk to aggregate. Run node --test and ensure the existing tests still pass.

### equivalent-2

Repository change request:
data/events.jsonl holds ~4000 event records (one JSON object per line: id, user, amount, status, ts). Compute the 3 users with the highest total `amount` summed over their status:"ok" events only. Write the result to src/top3.json as a JSON array of exactly three objects [{"user": "...", "total": ...}, ...] sorted by total descending, totals rounded to 2 decimals. The file is large — query it rather than reading it whole. When `search_spans` is available, call it on data/events.jsonl so its exhaustive execution receipt proves full-corpus coverage; then use node or awk to aggregate. Run node --test and ensure the existing tests still pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

data/events.jsonl holds ~4000 event records (one JSON object per line: id, user, amount, status, ts). Compute the 3 users with the highest total `amount` summed over their status:"ok" events only. Write the result to src/top3.json as a JSON array of exactly three objects [{"user": "...", "total": ...}, ...] sorted by total descending, totals rounded to 2 decimals. The file is large — query it rather than reading it whole. When `search_spans` is available, call it on data/events.jsonl so its exhaustive execution receipt proves full-corpus coverage; then use node or awk to aggregate. Run node --test and ensure the existing tests still pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-14T18:51:25Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
