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

## If it fails

A failed calibration is a result: the local 35B cannot substitute for Albert's
judgment on that dimension. Options, in order: label more sessions (power), try a
different local judge model, or leave the dimension PENDING forever. Moving the
thresholds is not an option — they were declared before any data.
