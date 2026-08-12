# Retired optimizer recipes

This directory preserves historical candidate definitions without keeping them
in the active `configs/static/` roster. These files are audit data: recorded
verdicts and raw results remain unchanged, and pre-2026-07-27 neutral labels are
historical observations whose current decision status is **UNTESTED**.

Nothing here is selected by the default gate, fleet evaluator, or static-config
selftest. The old batch and span-screen manifests require an explicit
`--manifest` path if an investigator needs to reproduce their historical
machinery. They must not be treated as current candidates or pooled with a new
harness surface.

Serving endpoints are never stored in archived recipes. Historical runners
resolve them from the operator's runtime environment.
