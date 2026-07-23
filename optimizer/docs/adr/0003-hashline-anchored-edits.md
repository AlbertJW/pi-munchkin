# 0003-hashline-anchored-edits

- **Status:** active
- **Date:** 2026-07-23
- **Superseded by:** none

## Decision

Edits against files the model has read should be anchored by line-numbered,
file-version-tagged patches (hashline), not by exact-text matching. The
`hashline` extension replaces the built-in `read`/`edit` tools with
same-name, same-param-signature equivalents (`read` returns a
`[path#TAG]`-tagged, line-numbered body; `edit` takes line-range patches
against that tag) so downstream consumers (verify-gate, loop-breaker,
plan-runner, context-inlet-guard) keep working unmodified.

## Rationale

Exact-text edit matching is the single largest failure mode for small local
models — a single whitespace or context-line mismatch fails the whole edit.
Line-anchored patches remove that failure class structurally rather than by
prompting harder. Being an in-place replacement of `read`/`edit` (not a new
tool pair) means every existing extension that inspects edit calls keeps
working without a rewrite, and `HASHLINE=off` fully reverts to the untouched
builtins with no residual state.

## Evidence / incident that triggered it

Port of oh-my-pi's hashline format (`github.com/can1357/oh-my-pi`,
`packages/hashline`), whose own benchmarks (cited in
`harness/extensions/hashline.ts`'s header comment) show ~50-61% fewer edit
tokens and a weak-model edit pass rate of 6.7% -> 68.3%. This repo's port is
"lite": full patch grammar except tree-sitter block ops, an in-memory
snapshot store (4 versions/path, 50 paths, 2MB/file cap) for stale-tag
relocation, falling back to "read again" when relocation isn't possible.

## Relevant paths / subsystems

`harness/extensions/hashline.ts`, `harness/lib/hashline-core.ts`
(format/grammar/relocation logic), `HASHLINE` env flag, any extension that
parses `edit` tool calls or results (verify-gate, loop-breaker, plan-runner,
context-inlet-guard) — these depend on hashline's param-name compatibility
holding.

## Review / invalidation condition

Revisit if a real_gate round shows hashline's relocation-on-stale-tag
degrading edit success rate versus builtin `edit` on the models this harness
targets, or if a pi core upgrade changes how same-named extension tools
override builtins (the whole mechanism depends on "extension tools merge
after built-ins, same name wins").
