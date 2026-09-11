# Candidate retirement register — 2026-09-10

Executed under `optimizer/docs/adr/0006-candidate-graduation-and-retirement-playbook.md`'s
retirement checklist (its second real execution, and first covering more than one
candidate in a single pass — see that ADR's "Executed" section). Moving a recipe
here does not rewrite its recorded result: `PLAN_UNCERTAINTY`'s and
`PLAN_ITEM_GUIDANCE_V2`'s `NEUTRAL` verdicts in `ROUND_LEDGER.md` stand exactly as
recorded, confounded pre-`plan_write`-fix caveats included.

## Runtime paths retired

| Path | Disposition | Reason |
|---|---|---|
| `PLAN_TOOL_GO` (c39) | `plan-runner.ts`'s gate and the `plan_go` tool it registered are deleted; `plan_go` removed from `capability-surface.ts`'s `PLAN_SURFACE_TOOLS`, `real_gate.sh`'s `GATE_BASE_TOOLS` and its two tool-grant guards, and `runner-env.js`'s config-key list; schema entry removed | Both consumers it existed for — `PLAN_SUBAGENT_ONLY` (c25) and `PLAN_DELEGATE_ALL` (c37) — were retired in the 2026-08-12 batch, leaving it "worthless standalone" per its own `ROUND_LEDGER.md` entry. The user-facing `/plan-go` command (a distinct code path) is unaffected. |
| `PLAN_UNCERTAINTY` (c31) | schema entry and `real_gate.sh` parsing/guard removed — the boolean checklist's paperwork, finishing a retirement the 2026-08-24 planning refactor (`dbf90f4`) already half-did by deleting the `uncertainties[]` mechanism itself | The mechanism never worked as measured (0/6 sessions called `plan_write` at all in the first live round; the model never populated `uncertainties`), and its only client code is gone. `trajectory_check.py`'s `check_sv_ambiguous_spec` grader is corrected to record that its primary signal path is now permanently unreachable; the function's text-fallback path is untouched and still live. |
| `PLAN_ITEM_GUIDANCE_V2` (c34) | schema entry and `real_gate.sh` parsing/guard removed | Same half-finished-by-`dbf90f4` situation as c31: the wording swap it gated was folded in unconditionally by the refactor; only the paperwork remained. |
| `LOOP_EPISODE_MODE=enforce` | schema field removed entirely (`shadow`/`off` were the only values with any live optimizer interest); `configs/pending/semantic-loop-enforce.json` moved to `configs/retired/`, bytes unchanged. **The `enforce` code path in `loop-breaker.ts` is deliberately NOT deleted** — first exercise of this ADR's new value/mode-field checklist | `QWEN_EXPERIMENTAL_CANDIDATE_REGISTER_2026-09-10.md`'s verdict, verbatim: "Retire the current enforcement hypothesis. Reopen only with a concrete repair, new hypothesis, and bounded preregistration." Repeated operational screens produced no bounded intervention/settlement; `shadow` (the default) stays live and unaffected. |

## Recipes removed from the active roster

`configs/retired/semantic-loop-enforce.json` (moved from `configs/pending/`, bytes
unchanged). `PLAN_TOOL_GO`, `PLAN_UNCERTAINTY`, and `PLAN_ITEM_GUIDANCE_V2` had no
static config to move — all three were already deleted from `configs/static/`
under the 2026-08-07 inert-config rule (`DARK_CANDIDATE_VERDICTS_2026-08-03.md`),
before their schema/`real_gate.sh` paperwork existed to finish.

## Explicitly retained

- `harness/extensions/loop-breaker.ts`'s `EPISODE_MODE === "enforce"` branches —
  reachable only by explicit `LOOP_EPISODE_MODE=enforce`, which no shipped config
  now sets. Reopen condition is stated above, not silence.
- `FORCE_PLAN_WRITE` and `VERIFICATION_PLATEAU=enforce` — separately ratified as
  judgment adoptions in kill-switch form, not touched by this retirement pass. See
  `optimizer/docs/DARK_CANDIDATE_VERDICTS_2026-09-10.md`.
- Every other item on `QWEN_EXPERIMENTAL_CANDIDATE_REGISTER_2026-09-10.md`
  (`VISION`, `RESEARCH_LEDGER`, `JINA_READER`, `CONTEXT_ADMISSION`,
  `BASH_OUTPUT_GUARD`, `GREP_FIND_TOOLS`, the hierarchical/parent-led research
  pair, `CONTEXT_DISCOVERY`, `WORKING_MEMORY`) remains **Unresolved** and is
  unchanged by this pass.

This is a landed change (verify green, red-then-green where applicable per
commit), not a prepared deletion PR — see `docs/HARNESS_AUDIT_2026-09-10.md` for
the full verification receipt.
