# Optimizer mothballed — 2026-09-16

Albert explicitly requested that the optimizer be completely mothballed and switched off because it has not produced useful results for his workflow. This is an operational stop, not a new scientific verdict about historical candidates.

## Effective now

- The executable Python optimizer CLIs listed in `optimizer/MOTHBALLED.json` and all five top-level shell launchers refuse execution with exit 78 before setup, imports, model access or child dispatch. This includes legacy rounds, calibration, proposal/judge tooling, baseline runners and research campaigns.
- Optimizer V2 also refuses package imports, preventing its engine being restarted through the normal Python import path.
- There is no environment-variable override. Restart requires Albert's explicit instruction and a reviewed source change. Finding a different model, a green test suite, or an old restart charter is not authorization.
- `npm run verify` no longer runs the archived optimizer battery. Its sixth-stage structure is retained: the former optimizer lane now checks shutdown barriers plus the retained offline config validator. This is reported as `optimizer:mothball-check`, not optimizer qualification.
- `npm run verify:optimizer` is retained as a compatibility command for that shutdown check only. The prior battery is preserved as non-executable text in `optimizer/archive/verify-optimizer-before-2026-09-16.sh.txt`.

## Preserved material and shared dependencies

All historical results, ledgers, screens, preregistrations, configs, fixtures and implementation bodies are retained. Historical evidence is not rewritten. Only CLI barriers were added to archived executable utilities; their existing hashes therefore change, and old preregistrations must not be represented as matching this checkout.

`optimizer/prompt-lab/config.py` remains callable for offline schema validation and configuration rendering. It does not run a campaign. The harness still depends on the schema and retirement checks: Phase 3B may register `RESEARCH_WORKFLOW` and validate it without reviving optimizer execution. Runtime harness extensions, their flags, and feature implementations are not removed by this decision.

Standalone harness qualification tools outside `optimizer/` are not optimizer launchers and are unchanged. None is authorized to run by this change. Future feature acceptance must be explicitly scoped and approved by Albert; the existing broad optimizer programme is stopped.

## Planning disposition

Optimizer durability, campaign/baseline execution, optimization rounds and optimizer improvement work are mothballed, no longer required deliverables for the active harness completion effort. Existing plans and studies remain historical documents; references to running or improving the optimizer are superseded by this decision. Harness transaction safety, offline regression tests and normal verification remain active. Do not turn feature qualification into an automatic optimizer restart.

## Host inspection

The 2026-09-16 inspection found no optimizer-specific cron entry, matching user LaunchAgent, matching Codex automation, or identified running optimizer process. No unrelated Pi session, model server or scheduled job was stopped. The live harness mirror was not modified. This record describes the current source worktree, not every historical checkout or copied script on disk.
