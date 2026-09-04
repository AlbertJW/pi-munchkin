# Operational reference

Day-to-day rules for working on this repository. Extracted from historical HANDOVER notes.
For full option/rollback documentation see [`README.md`](../README.md).

## Repositories and authority

| Location | Role | Rule |
|---|---|---|
| `~/pi_munchkin` | public source of truth | review, secret-scan, verify, then push |
| `~/.pi/agent` | live harness mirror | never push; mirror only after human rollout approval |
| `~/LLM` | model serving | at most one gate round per serving box |

The source and live harness are intentionally not auto-synchronized. Model-visible defaults,
adoption, deletion, live mirroring, and gate rounds are human-gated. Never touch files matching
`context-pressure*`.

## Release and rollout checklist

For every source PR:

```sh
git diff --check
npm run secret-scan:diff
npm run verify
```

Then inspect staged paths for unrelated user work. The diff scanner reports only file, line, and
pattern ID and must never be changed to echo matched content. The canonical suite discovers its
tests dynamically; command output, not a hard-coded count, is authoritative.

After separate human approval to roll out a PR:

1. Mirror the first-party `harness/`, examples, and skills surface into `~/.pi/agent`.
2. Run `npm run mirror:check -- ~/.pi/agent`; extra documented local-only files are ignored.
3. Load the live harness through the current supported Pi release and confirm every declared
   extension and skill; the compatibility matrix separately covers Pi 0.80.6 through 0.84.x.
4. Record the new loaded surface hash. Do not pool old and new measurements.
5. Never commit or push from `~/.pi/agent`.

No live mirror or gate round is implied by approval of source implementation. Ask explicitly at
the rollout checkpoint. One gate round per box; never start one automatically.

## Security and operational constraints

- Never echo credentials. Do not place credentials, private endpoints, or machine-specific
  settings in diffs, tests, telemetry, notifications, or documentation.
- The repository is public. Secret-scan every diff before pushing.
- Preserve unrelated user changes in dirty worktrees.
- Use counterfactual regression checks: temporarily remove/revert the fix and prove its targeted
  test fails before accepting a new audit regression.
- Editing a running gate script can corrupt its byte-offset execution; stop the run first.
- Configuration-mode exposure proves only that configuration was applied. It does not prove the
  mechanism fired.
- Commit trailer: `Co-Authored-By: <the working Claude model> <noreply@anthropic.com>`
  (e.g. `Claude Sonnet 4.6` or `Claude Opus 5`).
