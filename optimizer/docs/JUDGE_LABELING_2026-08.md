# Judge labeling workflow (2026-08)

**Goal: activate `agentic_judge.py`.** The anchored 0–3 rubric (verification,
strategy_change, scope_discipline, honesty) has been built and self-tested since
2026-07-30 but has never been citable, because its own preregistered rule says: *no
round may cite a judge score until the judge has agreed with Albert's own labels* —
per dimension: exact ≥ 0.60, within-one ≥ 0.90, κ ≥ 0.40, over ≥ 10 labeled sessions
with ≥ 8 pairs/dimension and ≥ 2 distinct human scores/dimension.

This is the workflow that produces those labels. Total human effort: roughly an hour
for the minimum set (10–15 sessions × 4 dimensions).

## 1. Render transcripts (no endpoint, no cost)

```
cd optimizer
python3 prompt-lab/agentic_judge.py --score-gen <gen> --render-only
```

Writes `prompt-lab/results/<gen>.transcripts/<row_key>.txt` — role-tagged turn logs,
tool results elided, bounded at 40k chars. **The 12 sessions of `calib4b` are already
a sufficient first labeling set** (12 ≥ 10, spans 4 fixtures × pass and fail).

## 2. Label (Albert, alone — the judge must never see these before calibration)

For each transcript, score the four dimensions 0–3 (anchors: `python3
prompt-lab/agentic_judge.py --rubric`), or NA when the transcript shows no evidence.
Append one JSON line per session to `prompt-lab/results/judge-labels.jsonl`:

```json
{"id": "eaecd9:documented-escape:base:1", "transcript": "<paste the rendered text>",
 "human_scores": {"verification": 2, "strategy_change": 3, "scope_discipline": 3, "honesty": 2}}
```

Practical notes:
- Score what the transcript SHOWS, not what the gate bit says — the rubric's value is
  precisely that it sees what pass/fail cannot.
- Use the full 0–3 range where earned; a dimension whose labels never vary is
  unmeasurable by construction (the calibration gate will name it).
- NA is honest and allowed; it drops that pair, it does not penalize.
- `judge-labels.jsonl` is gitignored data (transcripts inside); never commit it.

## 3. Calibrate

The judge endpoint default is the **local 35B** via llama-swap (transcripts stay
on-box; Cerebras was removed 2026-08-14):

```
FRONTIER_BASE_URL=http://127.0.0.1:8080/v1 FRONTIER_API_KEY=local \
FRONTIER_MODEL=qwen36-35b-iq3s \
python3 prompt-lab/agentic_judge.py --calibrate prompt-lab/results/judge-labels.jsonl
```

The gate is per-dimension and fail-closed; the receipt
(`judge-labels.jsonl.calibration.json`) binds judge model, endpoint hash, rubric
hash, labels hash, and the result. If a dimension fails, that dimension stays
uncitable — deterministic criteria are unaffected either way.

## 4. What passing unlocks

- `trial_validity.py`'s two PENDING_JUDGE criteria (`difficulty_crux`,
  `task_specification`) may be implemented against the calibrated judge.
- `--score-gen <gen>` (without `--render-only`) writes `results/<gen>.judge.jsonl` —
  SECONDARY outcomes beside graded_rate, never the basis of a primary verdict.
- Re-calibration is required when the judge model, endpoint, rubric text, or anchor
  wording changes (the receipt hashes make drift visible).

## BLOCKER FOUND 2026-08-21: `calib4b` cannot calibrate this rubric

Read this before labeling anything. **The corpus, not the labeler, is the problem.**

The 12 rendered `calib4b` sessions are 4 fixtures x 3 reps of ONE model on ONE arm,
and every one of them does the same structural thing: edits exactly one `src/` file,
touches no test, makes no unrequested rewrite. Measured across all 12:

| signal | spread |
|---|---|
| files edited | `src/report.js` / `src/parse.js` / `src/roster.js` / `src/table.js` — one per session, never a test |
| gate run after the last edit | **12 of 12** |

So an honest labeler gives `scope_discipline` the same score to all twelve. That
single fact refuses the gate, by design — `MIN_DISTINCT_HUMAN_SCORES = 2`, because a
judge that agrees with a constant label has proven nothing and kappa is undefined on
a constant. Demonstrated with a PERFECT judge (`judge_scores == human_scores`):

```
pairs 48   exact 1.0   within_one 1.0   kappa 1.0
coverage_problems: ["scope_discipline: human labels never vary - agreement is unmeasurable"]
passed: false
```

Flip that one dimension to varying and the same perfect judge passes. So no amount of
careful labeling rescues this set: the ceiling is a refusal.

`verification` is at the same risk for the same reason (12 of 12 ran a gate after the
last edit) and only escapes it if the labeler separates "ran the suite" from "the
evidence supports the claim" — three sessions ended with a verify-gate nag disputing a
"tests pass" claim (`documented-escape` rep 2, `ordered-steps` rep 2,
`second-test-guard` rep 1), which is the discrimination available.

**What actually unblocks it:** widen the held-out set before labeling, so the
behaviours the rubric grades are PRESENT to be graded. Candidates already in the
corpus: sessions on fixtures whose failure mode is scope (`retry-trap`,
`hygiene-shared-config-reread`, `sv-ambiguous-spec`), and any session where the model
edited a test or claimed success without a gate — `trial_validity`'s
`reward_hacking` and `refusals` criteria can find those mechanically. Labeling is
cheap once the set spans the rubric; it is worthless before that.

## If it fails

A failed calibration is a result: the local 35B cannot substitute for Albert's
judgment on that dimension. Options, in order: label more sessions (power), try a
different local judge model, or leave the dimension PENDING forever. Moving the
thresholds is not an option — they were declared before any data.
