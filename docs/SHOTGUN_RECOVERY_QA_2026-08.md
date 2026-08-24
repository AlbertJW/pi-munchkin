# Shotgun recovery QA — 2026-08-24

This is a bounded, non-secret proof record for the planner, verification, tool-surface, and
reflection-retirement series. It contains no prompts, commands from evaluated sessions, tool
arguments, compiler output, endpoints, credentials, or private artifact paths.

## Counterfactual proofs

Each counterfactual was introduced locally, the named targeted test was observed red, and the
production fix was immediately restored before the acceptance suite.

| PR | Restored defect | Targeted regression | Counterfactual result |
|---|---|---|---|
| 1 | Ignore the typed pre-execution prevention event | `a first-party prevented mutation preserves earlier exact green evidence` | failed as intended |
| 2 | Raise the top-level plan limit enough to admit the 58-item expansion | `58-item rewrite is rejected before persistence and preserves the valid plan` | failed as intended |
| 3 | Treat Pi's ordinary inactive optional builtins as an explicit user allowlist | `Pi's ordinary optional builtin omissions are not an explicit allowlist` | failed as intended |
| 4 | Restore reflection's retired timeout option in child runtime propagation | `retired environment options have no loadable runtime reader` | failed as intended |

## Direct regression coverage

- The sanitized AlbertWork replay accepts 20 bounded items, rejects the 58-item expansion, keeps
  the last valid state byte-for-byte, and advances one item with one delta.
- Planning exposes only its read-only intersection. A blocked mutation emits one call-bound
  `tool/prevented` event. `/plan-go` restores execution tools and retains research activated during
  planning; `/plan-cancel` restores the pre-plan selection.
- `verify_project` runs only the detected exact gate. Wrapped Bash remains ineligible. Failed real
  mutation attempts still disarm earlier green evidence; proven pre-execution refusals do not.
- Active-only prompt tests prove inactive specialist definitions and ambient guidance contribute
  zero bytes. Capability activation is additive, phase-restricted, and one-shot; later manual
  disable remains authoritative. Deterministic package smoke measures the retained first-party
  definitions and requires the core profile to remove at least 70% of ambient schema bytes.
- The retired-surface structural test covers extension files, policy files, package entries, and
  child-environment propagation for `/reflect`.

## Acceptance state

Targeted shotgun tests are green after restoring all four fixes. `npm run verify` passes all six
stages: 550 tests, typecheck, health, a deterministic 151-file tarball that loads 30 extensions and
two skills, optimizer integrity/jails, and the non-echoing diff secret scan. Peer boundaries pass.
Isolated packed consumers for Pi 0.80, 0.81, 0.82, 0.83, and 0.84 each typecheck and load all 30
extensions plus both skills. A disposable agent directory mirrors 112/112 first-party files with
no unmanaged extension or orphan and loads through Pi 0.84 help without inference.

No `context-pressure*` file was used or modified. No live harness was changed. No calibration or
gate round was started.

## Approved adoption

The human checkpoint approved `MUNCHKIN_TOOL_PROFILE=core` and explicit-only planning as the
defaults. Focused regressions prove an unset environment selects the bounded core surface, inactive
specialists stay absent, ordinary mutations are not forced through planning, and `/plan` alone
activates `plan_write` while withholding mutation tools. Independent rollbacks are
`MUNCHKIN_TOOL_PROFILE=ambient` and `FORCE_PLAN_WRITE=on`.
