# 0003-hashline-anchored-edits

- **Status:** superseded by the Hashline Edit 2.0 implementation candidate in `docs/evidence/HASHLINE_EDIT_2_0_PLAN_2026-09-24.md`; candidate is not promoted
- **Date:** 2026-07-23
- **Superseded by:** none

## Decision

Edits against files the model has read should be anchored by line-numbered,
file-version-tagged patches (hashline), not by exact-text matching. The
`hashline` extension replaces the built-in `read`/`edit` tools with
same-name tools (`read` returns a
`[path#TAG]`-tagged, line-numbered body; `edit` takes line-range patches
against that tag). The custom read schema is close to Pi's native read schema;
the custom `edit({input})` schema is deliberately different from Pi's native
`edit({path, edits:[{oldText,newText}]})`. Downstream observers use stable
tool names/mutation classification; this is not parameter-schema parity.

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
`packages/hashline`). Those upstream benchmark figures are historical external
claims, not evidence for this harness. The initial local port used an
in-memory snapshot store and stale-tag relocation. The current v2 candidate
uses exact-byte SHA-256 tags, strict stale rejection, and no relocation; see
the linked plan for the precise candidate contract and remaining review risks.

## Relevant paths / subsystems

`harness/extensions/hashline.ts`, `harness/lib/hashline-core.ts`
(format/grammar/exact-byte validation), `HASHLINE` env flag, and observers of
`read`/`edit` calls. The v2 change keeps tool names and declared schemas; it
changes the textual tag contract and stale behavior.

## Review / invalidation condition

Re-review if implementation tests show a correctness regression, if a Pi core
upgrade changes same-named extension override behavior, or before any model
performance claim. A correctness implementation does not establish model
benefit.
