# 0004-dark-candidate-protocol

- **Status:** active
- **Date:** 2026-07-23
- **Superseded by:** none

## Decision

Every model-visible behavior change ships dark: gated behind an env flag, and
its threshold(s)/values registered as a numbered field in
`optimizer/prompt-lab/configs/schema.json`. A candidate is never adopted or
removed automatically — adoption and deletion are always human-gated. Nobody
(including the agent building the candidate) deletes another candidate's
config or flag; at most, draft a removal recommendation for a human to act
on.

## Rationale

A flag with no schema entry can be set on a live run without the optimizer
ever being able to represent, sweep, or reproduce that state — it becomes
invisible to the search space it's supposed to be part of. Enforcing
registration at config-apply time (fail closed) rather than by convention
means a missing registration breaks the next gate run loudly, immediately,
at the candidate that introduced it — not silently, weeks later, as
unexplained variance.

## Evidence / incident that triggered it

`optimizer/prompt-lab/config.py`'s `config_env()` raises `ValueError` on any
threshold key not present in `schema.json`'s `thresholds.fields`, and its
`--selftest` walks every file in `configs/static/` through `config_env()` so
a missing registration fails the selftest, not just a live run. The comment
directly above that loop cites the incident: "Every checked-in static config
must survive config_env — a threshold key missing from the schema means
real_gate.sh exits 2 the moment that candidate is applied (bit c24/c25 on
2026-07-20: DID_YOU_MEAN and PLAN_SUBAGENT_ONLY were never registered here)."
Both flags were later registered under `dimensions.thresholds.fields` in
`schema.json`.

## Relevant paths / subsystems

`optimizer/prompt-lab/configs/schema.json` (`dimensions.thresholds.fields`,
`safe` flag for structural-vs-safe), `optimizer/prompt-lab/config.py`
(`config_env`, `--selftest`), `optimizer/prompt-lab/configs/static/*.json`
(checked-in candidate configs), `CHANGELOG.md` ("dark" candidate entries).

## Review / invalidation condition

Revisit if a class of model-visible change turns out not to be expressible
as an env-flag threshold (e.g. a change that requires a server relaunch or a
structural routing decision) — those already get `kind: "server"` or
`safe: false` treatment in the schema rather than an exemption from
registration. The registration requirement itself should not be relaxed
without a replacement enforcement mechanism.
