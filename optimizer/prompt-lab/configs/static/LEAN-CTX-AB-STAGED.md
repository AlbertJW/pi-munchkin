# pi-lean-ctx A/B — staged 2026-07-11, launch AFTER m7 completes

Everything verified offline; nothing installed into the live harness (m7 was in flight).
Source unpacked + read at scratchpad/leanctx/ (pi-lean-ctx **3.9.6**, peer-deps pi ≥0.74 ✓).

## What it is (verified in source, not the README)
- Routes read/bash/grep/find/ls through `ctx_*` tools; embedded MCP bridge keeps a persistent
  session cache — unchanged re-reads ~13 tokens.
- **additive mode (default)**: ctx_* tools ADDED alongside pi builtins → bigger tool menu — the
  opposite of the measured tool-shrink direction for small models. **A/B must use
  `LEAN_CTX_PI_MODE=replace` + `LEAN_CTX_PI_TOOL_PROFILE=lean`.**
- Conflicts with hashline (both provide a read surface) → candidate arm runs `HASHLINE=off`.
  NOTE: replace-mode disables pi builtin edit paths? NO — verified README: native `edit`/`write`
  stay available in every mode; hashline-off means the arm loses hash-anchored edits (accepted —
  that IS part of what's being measured).

## Prereqs (5 min, after m7)
1. `brew tap yvgude/lean-ctx && brew install lean-ctx`   (binary is NOT installed yet)
2. `pi install npm:pi-lean-ctx@3.9.6`   (pin; floating specs are banned since the audit)
3. Drift-scanner smoke rides here too (one trivial commit via pi — 5 min, queued item).

## Design (arms sequential on the box; global package toggle between arms is safe)
- Arm OFF:  `GEN=lc-off N=16 ./real_gate.sh --calibrate parens equil` (current harness, as m7)
- Arm ON:   `HASHLINE=off LEAN_CTX_PI_MODE=replace GEN=lc-on N=16 ./real_gate.sh --calibrate
  parens equil` (inherited env reaches the pi children through run_one)
- Uninstall/disable the package between arms — verify with a 1-session smoke + `/lean-ctx` — so
  the OFF arm is truly off.
- Compare with Fisher on pass-rate + out_tok medians (metrics zero-usage fallback now committed,
  so token costs are trustworthy). Telemetry enrichment: watch context-inlet-guard blocks and
  compaction counts per arm.

## Decision rule (adopt-vs-build — gates two queued items)
- lean-ctx WINS or DRAWS pass-rate with materially lower tokens → adopt (pin in settings.json),
  and CANCEL both queued build items (A1 result-pruner, map-reduce search_spans/read_span
  prototype) — don't build what a maintained Apache-2.0 extension already does.
- lean-ctx LOSES pass-rate → record, uninstall, and the map-reduce minimal prototype moves up.

## VERDICT (2026-07-12): REJECTED — architecturally incompatible
Replace mode removes all tools named read/bash/grep/find/ls including HASHLINE'S read; hashline's
edit needs that read's version tags → edit grounding destroyed → 4B reduced to byte-exact builtin
edits it cannot produce (31–48 consecutive edit failures/session, 0 passes, 2.2× tokens, 7×
wall-clock across 10 sessions in two configs). Uninstalled. Additive mode not pursued (schema
bloat small models ignore). Map-reduce minimal prototype moves up per the decision rule.
Corollary: strongest hashline validation to date — it is load-bearing for weak-model editing.
