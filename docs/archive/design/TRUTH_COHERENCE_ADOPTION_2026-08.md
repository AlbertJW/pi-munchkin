# Truth-and-coherence adoption checkpoint

Status: **ADOPTED 2026-08-15** (human decision, Albert, as Phase 1 of the
measurement reboot — `optimizer/docs/UNMOTHBALL_2026-08.md`). The two-line diff
below is the deployed default; the rollback table stays valid verbatim
(`ACTIVE_TOOL_PROMPTS=ambient` / `CONTROL_ARBITER=shadow` restore the historical
behavior independently). This adoption moved the model-visible surface hash —
see the 2026-08-15 row in `docs/SURFACE_BOUNDARIES.md`; nothing pools across it.
It also satisfies `failure_episode_trial.preflight()`'s deployed-defaults guard.

## Exact adoption diff

The future model-visible adoption is deliberately reduced to these two lines:

```diff
-export const ACTIVE_TOOL_PROMPTS_DEFAULT: "ambient" | "derived" = "ambient";
+export const ACTIVE_TOOL_PROMPTS_DEFAULT: "ambient" | "derived" = "derived";
-export const CONTROL_ARBITER_DEFAULT: ControlArbiterMode = "shadow";
+export const CONTROL_ARBITER_DEFAULT: ControlArbiterMode = "enforce";
```

`derived` means active-only prompt behavior whenever
`MUNCHKIN_TOOL_ACTIVATION` is not `ambient`. An explicit
`ACTIVE_TOOL_PROMPTS=ambient` always restores the ambient prompt. An explicit
`CONTROL_ARBITER=shadow` always restores legacy producer delivery while keeping
the observational decision row.

## Rollback table

| Adopted behavior | Immediate rollback | What rollback restores |
|---|---|---|
| Prompts follow the dynamic tool surface | `ACTIVE_TOOL_PROMPTS=ambient` | Historical ambient plan, delegation, and compaction guidance |
| One arbiter-owned corrective delivery | `CONTROL_ARBITER=shadow` | Legacy direct producer messages; arbiter remains observational |

These switches are independent. Either can be rolled back without changing the
other, the session bootstrap, failure taxonomy, run kernel, semantic episodes,
or persistence formats. Any adoption creates a new model-visible surface hash;
measurements must not pool across it.

## Proven scope

The active-only path removes the governor's ambient tool block and the vendored
subagent manual, including its JSON examples, whenever the corresponding tool
is absent. Active tools retain Pi's definition-owned schema, snippets, and
guidelines. Ambient mode remains byte-compatible.

The enforced arbiter sends at most one same-boundary message. When a state lens
and a correction collide, the bounded `[harness summary]` comes first and the
correction is preserved intact at the end. When repeated-failure recovery also
collides with exact verification, recovery owns the correction and the exact
verification requirement remains intact as its final suffix. Abort and shutdown
winners carry neither supplement and start no continuation. Shadow mode retains
separate direct delivery by the legacy producers; the timing-global removal is
an independent coherence fix, not part of the default flip.

This is a mechanism and coherence repair, not an efficacy result. Adoption,
live mirroring, live Pi 0.84 loading, calibration, and gate rounds each remain
separate human decisions. `RESEARCH_LEDGER` remains dark.
