# Truth-and-coherence adoption checkpoint

Status: prepared, not adopted. The source implementation is complete with the
deployed defaults still unchanged. No live mirror, calibration, or gate round is
authorized by this document.

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
correction is preserved intact at the end. Abort and shutdown winners carry no
lens and start no continuation. Shadow mode retains the existing two-producer
behavior.

This is a mechanism and coherence repair, not an efficacy result. Adoption,
live mirroring, live Pi 0.84 loading, calibration, and gate rounds each remain
separate human decisions. `RESEARCH_LEDGER` remains dark.
