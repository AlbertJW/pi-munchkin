# Changelog

All notable changes to pi-munchkin are documented here. Releases follow semantic versioning.

## Unreleased

### Added

- `bash-output-guard` extension (dark, `BASH_OUTPUT_GUARD=on`): withholds an
  oversized `bash` tool result and substitutes a bounded diagnostic, mirroring
  `context-inlet-guard`'s existing block-not-truncate discipline for reads.
- `bash-output-guard/withheld` surfaced into gate eval rows via
  `context_telemetry.py`, so a round can confirm the guard actually fired
  rather than merely having been armed.
- `SPAWN_DELEGATION` (dark): recommends `mode=spawn` + a self-contained task
  string everywhere the harness previously recommended `mode=fork`
  (delegation prompts, the gate-repair ladder, `PLAN_SUBAGENT_ONLY`'s block
  reason, and the `executor` role description, rewritten at injection time).
- `PLAN_DELEGATE_ALL` (dark): extends `PLAN_SUBAGENT_ONLY` from edits alone to
  every plan item — during execution, only `plan_write` and `subagent` remain
  directly callable; everything else is blocked and routed to a role-matched
  spawn-mode subagent. First candidate built specifically to test the
  many-small-contexts-over-one-long-session direction.
- Registered a new remote model (`qwopus35-9b-coder-q4-k-m`) in the local
  model roster.

### Removed

- The `plan-weaver` (v4) extension and its `plan-contract` lib. Its gate retry
  ladder, item dependencies, and crash-resume mechanics are ported into
  `plan-runner` (plan mode) instead.

## 0.3.0 - 2026-07-19

### Added

- Release-ready npm metadata, a reproducible lockfile, and Linux/macOS CI on Node 22.
- `plan-weaver` and `did-you-mean` to the default extension set.
- The bundled `pi-subagent` extension to the package manifest.
- Canonical `test`, `typecheck`, `health`, `pack:smoke`, and `verify` commands.
- Package-content and extension-load smoke coverage before release.

### Changed

- Type-checking now covers the complete harness from a normal root `npm ci`; it no longer relies on user-specific absolute symlinks.
- The health check is read-only and works in both a clean clone and an installed harness with local configuration.

### Security

- The fault-injection-only `chaos` extension and policy are excluded from the published artifact and default manifest.
- CI uses read-only repository permissions.

## 0.2.0

- Previous development release of the harness and measurement-gated optimizer.
