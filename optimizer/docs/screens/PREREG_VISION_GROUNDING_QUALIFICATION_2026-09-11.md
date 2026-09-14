# Preregistration: vision + SAM grounding qualification (2026-09-11)

> **STATUS: PREPARED. No stage of this study may be started without Albert's
> explicit, per-stage approval.** Committed before any data it governs.

## Why this study exists

The candidate register (`QWEN_EXPERIMENTAL_CANDIDATE_REGISTER_2026-09-10.md`)
names the exact gap: "A new diagnosis and matched screen must cover cache,
uncertainty, action, model switch, and a harness-checked SAM result before
vision can be considered for adoption." Every prior screen covered at most
one of those five, and every prior SAM attempt on a real capture produced an
invalid result (the Qwen 35B qualification's two attempts both failed to
produce a valid mask; the exploratory desktop row's box fell outside the
image and was retracted as non-authoritative). This study is the first
attempt at all five in one bound manifest, and the first to run against a
real, installed SAM 2.1 Tiny runner (`harness/scripts/install-sam2-runner.sh`,
checkpoint SHA `7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69`)
rather than a fixture double or an unqualified exploratory attempt.

`VISION` and `VISION_GROUNDING` remain dark. Nothing here authorizes a
default change, mirror, or rollout regardless of outcome.

## Subject and stratum

Two vision-capable models are currently registered:
`local-llamacpp/qwen36-35b-iq3s-vision` and `local-llamacpp/lfm25-vl-3b`.
Per the register, their results are model-specific and must not be pooled.

- **Cases 1–4** (cache, uncertainty, action, model-switch) run once each
  against **`lfm25-vl-3b`** as the primary subject — the only model with a
  clean prior receipt (V2, `176 ms`, `1/1`) to build on — then, if the human
  reviewing results wants Qwen coverage too, an identical replay against
  `qwen36-35b-iq3s-vision` as a **separate, non-pooled** run.
- **Case 5** (harness-checked SAM) is **model-independent** — SAM grounding
  consumes a captured image and a point/box hint, not a vision-LLM response,
  so it needs no served vision model and can run against either subject's
  captured frame, or none at all (see "No-inference note" below).

## Frozen fixture

Reuses `vision-real-ui-lfm25-vl-3b-v2.json`'s renderer: the fixed local
640×360 HTML confirmation dialog, independently-known `Confirm` button
geometry `{x:360,y:214,width:120,height:40}`. This geometry is the oracle
every case below checks against — it was authored independently of any
model or SAM output, so agreement is evidence, not circularity. A second,
visually-distinct dialog state (`Confirm` replaced with `Confirmed ✓` at the
same position, button disabled) is added for the action-invalidation case.

## Cases

1. **Cache — exact reuse then invalidated miss.** Two `visual_observe` calls
   on the identical unchanged dialog must be `exact_reuse` on the second.
   Immediately after, one call following an actual DOM click on the dialog
   (see case 3) must NOT report `exact_reuse` — it must report `fresh` (or
   `near_reuse` only if the pHash/region-digest pair genuinely permits it,
   which a full button-state change should not).
2. **Uncertainty.** The model is asked to locate a control that does not
   exist in the fixture (no button labelled "Cancel"). Acceptance: the
   turn's `visual_observe`/`visual_refine_target` sequence must produce an
   `uncertain` marker or an explicit refusal — never a fabricated geometry
   for a control that isn't there. This is the one LLM-judged case; the
   other four are harness-checked without a judge.
3. **Action invalidates cache.** After the dialog's `Confirm` button is
   clicked (real DOM interaction via the existing Chrome real-UI harness),
   a subsequent `visual_observe` on the same `source_id` must not reuse the
   pre-click cache entry — checked mechanically via
   `visual-observe/cache` telemetry (`decision` field), not by asking the
   model.
4. **Model switch forces a fresh capture.** The same `source_id` observed
   under `lfm25-vl-3b`, then again immediately after switching the active
   model to `qwen36-35b-iq3s-vision` (no visual change to the page), must
   report `fresh` on the second call — `VisualObservationCache` partitions
   by `modelFingerprint`, so this is a mechanical, judge-free check.
5. **Harness-checked SAM.** `visual_observe` captures the dialog; a point
   hint at `{x:420,y:234}` (inside the known Confirm box, 60px right and
   20px down from its top-left corner) is passed to `visual_refine_target`
   with the real installed adapter (`PI_SAM2_COMMAND` pointing at
   `~/LLM/sam2-tiny/run.sh`). Acceptance requires ALL of: (a) the harness's
   own `validateGroundingResult` accepts it (safe_point strictly interior,
   box in-bounds — already enforced unconditionally, not a new check); (b)
   the returned box's IoU against the independently-known oracle box
   `{x:360,y:214,width:120,height:40}` is ≥ 0.5; (c) `model_score` is
   recorded, not gated on (SAM's own confidence is diagnostic only, per
   `visual-grounding.ts`'s `click_safe: null` contract).

   **No-inference note:** case 5 alone requires no LLM completion — it is a
   deterministic subprocess call (image bytes in, JSON geometry out) against
   an already-installed local instrument, the same category as `search_spans`
   or `ketch`. If the human wants a cheap, low-cost first signal before
   committing to the full 4-case LLM study, case 5 can be run and reported
   on its own with no separate inference approval — it is not a model
   session. Cases 1–4 do need a served model and each is its own approval
   gate per the standing rule.

## Decision rule

This is a **mechanism qualification**, not an efficacy trial — matching
every other vision screen to date. A clean pass on all five cases upgrades
the register's disposition from "Unresolved" to "mechanism qualified,
efficacy still unmeasured" — it does **not** itself authorize
`VISION=on`/`VISION_GROUNDING=sam` as any default. A failure on any case is
recorded as a valid negative for that dimension specifically (matching
`QWEN_VISION_REAL_UI_2026-09-10.md`'s own precedent: "do not rerun this
screen" on failure — a fresh diagnosis and a new preregistration would be
required to retry that dimension, not a rerun of this one).

## Interpretation

Success here still would not authorize adoption, a default change, a
mirror, or a rollout. It closes exactly the five named gaps in the register
and nothing else — grounding accuracy on a UI shape other than this fixed
dialog, multi-turn action sequences, and real click execution all remain
untested and out of scope for this study.
