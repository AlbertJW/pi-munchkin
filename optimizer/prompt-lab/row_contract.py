"""Canonical evaluation-row schema identities and population guards.

V2 remains readable historical evidence. V3 is the only schema eligible for
failure-episode trials because it binds the authenticated settlement outcome.
Mixed schema generations are never a valid analysis population.
"""

ROW_V2 = "pi.eval-row/v2"
ROW_V3 = "pi.eval-row/v3"
CONTEXT_V1 = "pi.context-telemetry/v1"
CONTEXT_V2 = "pi.context-telemetry/v2"
CONTEXT_V3 = "pi.context-telemetry/v3"
CANONICAL_ROWS = frozenset((ROW_V2, ROW_V3))
CANONICAL_CONTEXTS = frozenset((CONTEXT_V1, CONTEXT_V2, CONTEXT_V3))


def canonical_generation(rows):
    """Return the one canonical schema in rows, None for all-historical rows.

    A canonical generation cannot be mixed with another canonical generation
    or with schema-less historical data. Callers surface the fixed error rather
    than silently interpreting new evidence as legacy.
    """
    schemas = {row.get("schema") for row in rows}
    canonical = schemas & CANONICAL_ROWS
    if not canonical:
        return None
    if len(canonical) != 1 or schemas != canonical:
        raise ValueError("historical or different canonical eval-row generations cannot be combined")
    return next(iter(canonical))


def is_powered_row(row):
    return row.get("schema") == ROW_V3


def failure_episode_complete(row):
    return is_powered_row(row) and (row.get("context") or {}).get("failure_episodes", {}).get("complete") is True


def validate_powered_row(row, *, require_context=True, require_complete=False):
    """Fail closed on the v3 evidence fields used by powered analyses."""
    if not isinstance(row, dict) or row.get("schema") != ROW_V3:
        raise ValueError("expected pi.eval-row/v3")
    for field in ("task", "model", "arm", "run", "status"):
        if not isinstance(row.get(field), str) or not row[field]:
            raise ValueError(f"missing v3 field: {field}")
    if row.get("score") not in (0, 1) or isinstance(row.get("score"), bool):
        raise ValueError("v3 score must be binary")
    if not require_context:
        return row
    context = row.get("context")
    if not isinstance(context, dict) or context.get("schema") != CONTEXT_V3 or context.get("authenticated") is not True:
        raise ValueError("v3 row lacks authenticated context telemetry")
    episodes = context.get("failure_episodes")
    if not isinstance(episodes, dict) or not isinstance(episodes.get("complete"), bool):
        raise ValueError("v3 row lacks failure-episode settlement metadata")
    complete = episodes.get("settlement_summaries") == 1 and episodes.get("complete") is True
    if require_complete and not complete:
        raise ValueError("v3 row lacks exactly one valid failure-episode settlement")
    for field in (
        "total_episodes", "total_failures", "longest_episode", "semantic_failure_overrun",
        "correlated_failure_overrun", "settled_without_recovery", "failures_after_second",
        "recovered_episodes", "recovery_calls_total", "recovery_calls_max",
    ):
        value = episodes.get(field)
        if complete and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
            raise ValueError(f"v3 failure-episode field is invalid: {field}")
        if not complete and value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
            raise ValueError(f"v3 incomplete failure-episode field is invalid: {field}")
    return row
