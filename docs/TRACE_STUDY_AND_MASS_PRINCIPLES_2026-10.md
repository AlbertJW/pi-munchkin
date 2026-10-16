# Trace study and MASS principles — October 2026

Applies the principles of [MASS: Recursive Self-Improvement through Multi-Agent
Self-Supervision](https://pub.sakana.ai/mass/) (Sakana AI, 2026) to Munchkin, driven by the
recorded Pi session traces rather than by guesses. Model-agnostic and offline: no model was run;
every change is deterministic and has tests that fail on the previous code.

## What MASS says that transfers to a harness

MASS itself trains models. The parts that transfer to a harness:

1. **Contracts over roles.** A workflow has four parts — role, instruction, *contract* ("the
   information and artifacts it must return, including any required checks") and *hop* (call
   order). Optimized workflows moved task information out of role and instruction prose and into
   contracts and hops.
2. **Efficiency is measured per output token**, not only by success.
3. **Shared blind spots.** When the same model is both worker and judge, a flawed result can be
   accepted as an improvement. Prefer checks the model cannot talk its way past.
4. **Workflow search is noisy**: strong iterations are followed by sharp regressions, so changes
   need stability mechanisms.

## What the traces show

120 Pi session traces from 2026-09-01 to 2026-10-12: 61 interactive, 59 harness runs. Aggregates
only; no content was read.

| Signal | Value |
|---|---|
| Interactive tool calls / errors / exact repeats | 3,483 / 5.1 % / 8.9 % |
| Largest context consumer | `read` results, 5.2 M chars (p90 9 KB) |
| `verify_project` re-runs with no file change since an identical run | 51 |
| Next edit fails again after a hashline patch-format error | 22 of 49 (45 %) |
| Fresh `plan_write` rejected with "unknown item_id … Valid ids: (none)" | 8 |
| `search_spans` invalid-regex failures | 3 |
| Missing-file reads that got a `did-you-mean` hint | 78 of 97 (already works) |
| Model changed approach after a loop-breaker steer | 66–78 % (works) |
| `subagent` calls | 2 in 120 sessions |

### Follow-up: 14–15 October traces

Four newer sessions add 145 tool calls over 488 records. They are a small diagnostic sample, not
an efficacy measurement. Aggregate inspection found 5 edit errors, 5 shell errors, 2 guarded-read
errors, no exact consecutive tool-call repeats, and one provider error. The read errors correctly
refused 75–78 KB whole-file requests; the shell errors were mostly expected test failures; and the
verification and loop-breaker interventions were accepted or stopped the run as designed. Those
guards should not be weakened merely to lower the raw error count.

The actionable cluster was one coding session in which all five `edit` calls failed. Two requests
used an exact `[path#TAG]` but expressed the change as a unified `@@` hunk, a common model-native
shape that the parser rejected even though it contained enough information for a deterministic,
version-bound edit. The model then fell back to repeated whole-file `write` calls. This is a
contract impedance mismatch, not evidence that anchoring should be removed.

## Changes

| Change | Principle | Trace basis |
|---|---|---|
| `verify_project` reuses its result only when provably nothing changed (same user turn, no possibly-mutating tool since, identical git working-tree fingerprint; recorded only if the gate left the tree unchanged; `force: true` re-runs) | Efficiency per output token; deterministic evaluator | 51 redundant gate runs |
| Hashline: mechanical repairs (double-escaped one-line patch, stray trailing backslash) before parsing; errors that need a guess stay errors but show the exact expected patch shape | Contract: make the required artifact explicit | 45 % repeat-failure after patch errors |
| Hashline: accept unified `@@` hunks only below an exact `[path#TAG]`; validate every old/context row at its declared location and never relocate content; untagged `*** Update File` remains rejected | Contract/hop compatibility without weakening authority | 5/5 edit failures in the newest problematic coding trace; two were safely recoverable tagged diffs |
| `plan_write` adopts a model-chosen id for a new item | Contract matches how models name work | 8 rejected fresh plans |
| `search_spans` falls back to a literal search for an invalid regex and says so | Fail toward a useful result | 3 hard failures |
| Delegated reports are checked against their role's `Return ONLY:` contract; missing fields tell the parent to treat claims as unverified | Contracts over roles; no shared blind spot | Only planned research was validated |
| Test double reports spawn failures instead of a silent "exit 1" | Stability: a flaky run must explain itself | One intermittent full-suite failure |

Earlier in this branch's history (see `HARNESS_MODERNIZATION_2026-10.md`): goal 80/20 settlement
became a user decision and settlements record verification state (shared blind spot), and
`npm run qualify:pi` gates every change (stability).

## Checked and left alone

- **Read sizes.** Only 4 reads directly followed an edit of the same file; large reads are
  legitimate. Pi already caps a read at 2,000 lines / 50 KB and the inlet guard refuses unbounded
  large files.
- **Verify-gate steers.** The steer already names the exact gate and the `verify_project` tool;
  59 % of interactive models ran verification on the next turn.
- **`[rtk] No hook installed…` lines in 37 bash results.** They come from the external `rtk`
  binary, not the harness; silencing needs `rtk init -g`, which installs a hook into another
  tool's global config, so it is the user's call.

## Reproducing the numbers

The aggregation scripts read `~/.pi/agent/sessions/**/*.jsonl` and print counts and sizes only.
They are not committed because the traces are private; rerun the same aggregates locally if needed.
For the follow-up, the five failing edit argument shapes were additionally classified locally to
distinguish recoverable tagged diffs from ambiguous patches; no user prose or source content is
included here.
