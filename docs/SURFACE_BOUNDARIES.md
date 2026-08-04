# Harness surface boundaries

Model-visible harness changes are one-way measurement boundaries. Never pool rows across a
boundary, even when both sides pass the same task gate. Each gate row must carry the loaded
`HARNESS_SURFACE_SHA256`; the source hashes below are review aids and are not substitutes for the
loaded live receipt.

Generate the current deterministic package-source code/role surface with:

```sh
npm run surface:hash:source
```

| Date | Sequential change | Commit | Package-source surface SHA-256 | Live status |
|---|---|---|---|---|
| 2026-08-04 | gate and repeat-loop correctness | `36b3f80` | `090f867525f79ed61fe25e7a047d7c6c7dbc7e8f84a1ddb9ff00db3f45746103` | included in approved batch rollout; not measured separately |
| 2026-08-04 | security, privacy, bounded I/O | `e3dfc0b` | `16b0e1495c5c708c991549c6b506d81d3993a7351a900be2d314609579ee06a0` | included in approved batch rollout; not measured separately |
| 2026-08-04 | dynamic surface implementation | `5c0d2bc` | `48a4f31e7455a31d3320dd43f4231dd1c9ba340b6f371a13ddcbd99cab498fc8` | included in approved batch rollout; not measured separately |
| 2026-08-04 | approved dynamic/state-lens defaults | `cbbc8fa` | `f678b84d7de71ea37daae836a70bb7e062d4f1cbf3a692eb4d2f3d25f7daf1e2` | rolled out; loaded live hash `440796cf2d555a4b09e9cfaaf8fb5f7ba451d0ce38efe2b7988bfd13c5e667ad` |

PR 4 changes package, CI, operational tooling, and narrative. Its new mirror/secret-scan libraries
are not imported by the runtime extension manifest, so it does not create a model-visible runtime
surface boundary. If that fact changes during review, add a row before merge.

At an approved rollout, append the exact loaded hash and rollout commit here only after
`npm run mirror:check -- <agent-dir>` reports zero first-party drift and the target Pi version
loads the full manifest. Do not infer a live hash from the source table.

The 2026-08-04 live hash includes the preserved local-only `extensions/chaos.ts`, which Pi 0.83
auto-discovers from an unpacked agent directory. It is excluded from the package manifest and is
inert unless explicitly armed. Measurements must bind the loaded hash above, not the package-source
hash.
