# Vision preregistration applicability audit — 2026-09-24

## Current implementation

The source already contains `visual_observe`, an epoch-aware visual cache,
freshness invalidation at action/compaction/model-change boundaries, validated
geometry, and a SAM adapter boundary. `VISION=off` and
`VISION_GROUNDING` unset remain the defaults. Cache matches are hints and do
not authorize actions; SAM output has `click_safe: null` and requires separate
fresh target validation. Existing code and tests cover the local capability
contracts. No feature or runner needs to be rebuilt for this closeout.

## Existing evidence and applicability

- Offline vision foundation and fake-fixture cache/SAM contracts are recorded
  in `docs/evidence/VISION_QUALIFICATION_2026-09-09.md`. These establish
  implementation behavior, not model benefit.
- Qwen 35B's 2026-09-09/10 real-UI results include a valid negative semantic
  case, near-cache missed-change observations, and SAM attempts that did not
  produce valid masks. Preserve those as model-specific negatives.
- LFM 2.5 VL 3B V2 returned the expected answer for one fixed UI image. That
  one-case result is transport/semantic evidence only and is not comparable
  with Qwen.
- The 2026-09-11 vision/SAM preregistration identifies five relevant
  dimensions: exact reuse, uncertainty, action invalidation, model switch,
  and harness-checked SAM geometry. Those dimensions remain relevant to the
  currently implemented behavior, but its source/runner/SAM installation
  identity must be re-derived before any future stage. Its historical hashes
  and permission wording are not execution authorization.

The audit source pin is runtime commit
`632409ddbc12085064f4953b1c1eaec73999ba91`, source-surface SHA-256
`121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`.
Documentation-only commits do not invalidate this pin while relevant source
hashes remain unchanged; any visual behavior change requires a new reviewed
protocol revision.

## Disposition

Keep the existing vision preregistration and receipts immutable. Use their
cases as an audit map; do not recreate the cache, observation, geometry, or SAM
adapter. Any future qualification must issue a new revision only if static
source comparison finds material behavioral or identity drift, keep model
arms separate, and obtain explicit approval for each stage. No inference,
desktop capture, SAM invocation, weights download, or screen was run for this
audit. Evidence/report destination for any later approved work:
`docs/evidence/` and `optimizer/docs/screens/`.

No current execution-ready vision manifest exists for all five dimensions.
The fixture, renderer, and runner hashes need a current binding; availability
and identity of the installed SAM command/checkpoint are not verified here;
model artifact and serving identity are unassigned; and no independent
adjudication arrangement is bound for uncertain semantic outcomes. These are
preflight gaps, not reasons to rebuild the already-present capabilities.
