# Goal context contract repair — 2026-09-05

## Correction to the earlier audit

The earlier claim that Pi context callbacks return a bare array was wrong.
The installed pi-coding-agent 0.80.6 declaration is
`ContextEventResult { messages?: AgentMessage[] }`.
`ExtensionRunner.emitContext` consumes that object from each callback and
returns the final array to its caller. These are two different interfaces.
The typings were correct; the compatibility cast suppressed a real defect.
The permissive change to the integration double hid that defect.

## Reproduction and repair

A regression now invokes the installed `ExtensionRunner.prototype.emitContext`
with the actual registered plan-runner callbacks. Only runner construction
dependencies (extension list, session context, error sink) are supplied by the
fixture; dispatch and callback combination execute Pi's implementation.
Before repair, a paused goal's queued continuation survived (two messages
instead of one). Returning `{ messages: filtered }` fixes it without a cast.
The double again accepts only the object shape Pi accepts.

A differential test checks both implementations against undefined, an invalid
bare array, and a valid object. A second regression exercises active, paused,
blocked, cancelled, complete, 80/20-settled, and replaced goals using private
fixture state. It exposed a further failure: an old continuation survived when
a replacement goal was active. Continuations now require the current goal's
identity hash. User messages are preserved, including text resembling an
internal marker.

## Evidence boundary and remaining work

These are offline runtime-dispatch and extension-lifecycle checks, not live
model evidence or a complete AgentSession queue/compaction simulation.
Context filtering prevents obsolete instructions from entering provider
context. It does not cancel an already queued turn or prove zero additional
provider calls after pause. Do not describe it as that stronger guarantee.

The previously reported 721 passing tests did not prove this callback worked.
The narrow continuation goal was marked complete prematurely. The full release
goal still requires reviewing the combined outstanding changes, the release
ceremony, and a pinned-model lifecycle smoke with a loaded-surface receipt.
Existing planner experiments and their pending changes remain separate work.

## Verification receipt

Offline aggregate verification: 723/723 tests passed; typecheck, health, package
smoke, and secret scan passed. Optimizer verification stopped at
`research-fixtures/preflight.py:selftest` because its frozen DEFAULT_SOURCE
does not match the modified source. The preregistration was not rebound.
`git diff --check` passed. Read-only mirror check reports 13/124 differing
first-party files; no mirror was applied. No model inference was performed.
