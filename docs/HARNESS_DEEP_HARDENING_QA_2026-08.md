# Harness deep-hardening QA

This is the bounded, non-secret proof record for the 2026-08-17 inspection
repairs. It names defect classes, tests, and safe outcomes only. It contains no
credentials, matched secret text, provider endpoints, raw commands from model
sessions, compiler output, or absolute private paths.

## Reproductions and counterfactuals

| Finding | Broken behavior proved | Repair proof |
|---|---|---|
| F-01 measurement authority | A powered failure-episode row could be reported without a complete sidecar verdict; inline Node and Python writes did not mark the trial as tampered. | Trial validity is now a required one-to-one authority, duplicates fail closed, write-capable inline interpreters are detected, and both fleet and effort reports refuse incomplete populations. Optimizer selftests cover missing, duplicate, tampered, and complete verdict sets. |
| F-02 Linux verification | In a disposable Node 22 Debian container, the pre-fix suite failed the case-only did-you-mean assertion and the chmod-based rollback assertion. The optimizer dry smoke then failed because a no-execution dry run enforced the runtime-only hidden-grader sandbox rule. | The filesystem-sensitive assertion follows the host's actual case semantics; rollback uses deterministic injected EIO rather than permissions; dry mode admits hidden-task wiring while a real unsandboxed hidden run still exits before execution. All 600 harness tests and the complete optimizer verifier pass in Linux. Ubuntu is no longer `continue-on-error`. |
| F-03 project-local plan residue | With default forced planning, the pre-fix harness wrote plan JSON, Markdown, and traces below the project. | Forced and adaptive plans now share private per-run capsule storage by default. `/plan-export` is the only default-path project projection, and `/reflect` reads the active capsule rather than a stale export. Private-mode tests assert `0700` directories, `0600` files, atomic publication, unique concurrent runs, and no project artifact. |
| F-04 telemetry permissions | A fresh interactive telemetry file was observed with world-readable mode before repair. | The synchronous and asynchronous writers create owned directories and files privately, preserve a pre-existing parent's mode, and keep rotated files private. Permission and rotation regressions pass. |
| F-05 diff scanner symlinks | The pre-fix secret scanner followed an untracked directory symlink and terminated with an I/O exception. | The scanner uses `lstat`, no-follow open where supported, and descriptor metadata. A directory symlink is reported only as a non-regular path; its target is neither traversed nor echoed. |
| F-06 verification path aliases | Lexical cwd checks misclassified mutations passing through symlink aliases. | The verifier canonicalizes the session cwd and the nearest existing ancestor of each prospective target. An inside alias to an outside target does not arm this repository; an outside alias to an inside target does. Unresolved paths fail closed. |
| F-08 runtime status disclosure | The pre-fix status command rendered the configured endpoint value. | Status now reports only whether an endpoint is configured. The regression injects a dummy endpoint and proves it is absent from status text. |
| F-09 research-ledger race | Concurrent near-cap appends could each pass the size check before either write completed. | Appends serialize per ledger path across the capacity check and append. The concurrency regression proves the 256 KiB cap cannot be crossed and no record is split. |
| F-12 hostname canonicalization | The repaired preflight test was run against a temporary restoration of the old hostname check. It failed because `LOCALHOST.` reached the redirect fetch stub instead of being rejected locally. | Lowercase and trailing-dot canonicalization now precede localhost/subdomain checks and DNS lookup. The same focused test passes after restoration of the fix, and the assertion distinguishes a preflight refusal from an arbitrary fetch failure. |

## Deliberate residuals

Run-capsule retention remains manual. The live inventory at inspection time was
about 292 KiB, with no project hash above 21 run directories. Automatic pruning
would delete user audit state and therefore remains outside this source repair
without a separate deletion decision. Restore traversal is bounded and fails
closed; the documentation states the retention policy explicitly.

The live-only `chaos.ts` fault injector and the non-loadable
`pi-rtk-optimizer` configuration directory remain untouched. The former is an
explicitly documented local-only extension included in the loaded surface hash;
the latter has no Pi-loadable entry point. Neither belongs in the release
manifest, and live cleanup or mirroring remains a separate human gate.

The older primary checkout is not treated as authority for this series. The
reviewable changes live on the dedicated hardening branch; no destructive branch
switch, live mirror, gate round, or model call is part of this QA work.

## Acceptance record

- Focused regressions and TypeScript typechecking pass. The canonical local
  verifier passes all 600 dynamically discovered harness tests, typecheck,
  health, deterministic package smoke, and optimizer/Seatbelt verification.
- A disposable Linux Node 22 run passes the same five verification stages. The
  package smoke loads all 30 extension entry points and both skills.
- Offline peer boundaries reject the unsupported lower and upper edges and
  accept 0.80.6 plus the supported 0.84 line.
- Isolated packed consumers for Pi 0.80, 0.81, 0.82, 0.83, and 0.84 each
  typecheck and load all 30 extensions and both skills.
- A temporary agent-directory mirror writes and checks 110 first-party
  artifacts with zero drift; Pi's loader reports 30 extensions and zero errors.
  The live agent directory is not modified.
- Diff whitespace and the non-echoing secret scan pass; the scanner inspects
  the complete added-line set without reporting matched text. The changed-file set contains
  no `context-pressure*` path and the source worktree is clean.
- The authoritative package-source surface hash for this series is
  `c1c76ebb8ec3a9eb690927a0af6be8ee062b23d6f3c3655bef17326b6bcfd8a7`.
- `npm audit --omit=dev` reports zero production vulnerabilities. The full
  development tree reports four advisories below the pinned Pi 0.80.6 compile
  baseline; they are transitive to the compatibility fixture, absent from the
  shipped dependency tree, and cannot be removed by raising that baseline while
  0.80.6 remains a supported boundary.
