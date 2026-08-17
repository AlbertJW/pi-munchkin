"""Canonical evaluation-row schema identities and population guards.

V2 remains readable historical evidence. V3 binds authenticated failure episodes;
V4 additionally binds the exact-gate verification frontier.
Mixed schema generations are never a valid analysis population.
"""

ROW_V2 = "pi.eval-row/v2"
ROW_V3 = "pi.eval-row/v3"
ROW_V4 = "pi.eval-row/v4"
CONTEXT_V1 = "pi.context-telemetry/v1"
CONTEXT_V2 = "pi.context-telemetry/v2"
CONTEXT_V3 = "pi.context-telemetry/v3"
CONTEXT_V4 = "pi.context-telemetry/v4"
CANONICAL_ROWS = frozenset((ROW_V2, ROW_V3, ROW_V4))
CANONICAL_CONTEXTS = frozenset((CONTEXT_V1, CONTEXT_V2, CONTEXT_V3, CONTEXT_V4))
POWERED_ROWS = frozenset((ROW_V3, ROW_V4))


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
    return row.get("schema") in POWERED_ROWS


def failure_episode_complete(row):
    return is_powered_row(row) and (row.get("context") or {}).get("failure_episodes", {}).get("complete") is True


def validate_powered_row(row, *, require_context=True, require_complete=False):
    """Fail closed on authenticated evidence fields used by powered analyses."""
    if not isinstance(row, dict) or row.get("schema") not in POWERED_ROWS:
        raise ValueError("expected a powered pi.eval-row generation")
    row_schema = row["schema"]
    for field in ("task", "model", "arm", "run", "status"):
        if not isinstance(row.get(field), str) or not row[field]:
            raise ValueError(f"missing powered-row field: {field}")
    if row.get("score") not in (0, 1) or isinstance(row.get("score"), bool):
        raise ValueError("powered score must be binary")
    if not require_context:
        return row
    context = row.get("context")
    expected_context = CONTEXT_V4 if row_schema == ROW_V4 else CONTEXT_V3
    if not isinstance(context, dict) or context.get("schema") != expected_context or context.get("authenticated") is not True:
        raise ValueError("powered row lacks matching authenticated context telemetry")
    episodes = context.get("failure_episodes")
    if not isinstance(episodes, dict) or not isinstance(episodes.get("complete"), bool):
        raise ValueError("powered row lacks failure-episode settlement metadata")
    complete = episodes.get("settlement_summaries") == 1 and episodes.get("complete") is True
    if require_complete and not complete:
        raise ValueError("powered row lacks exactly one valid failure-episode settlement")
    for field in (
        "total_episodes", "total_failures", "longest_episode", "semantic_failure_overrun",
        "correlated_failure_overrun", "settled_without_recovery", "failures_after_second",
        "recovered_episodes", "recovery_calls_total", "recovery_calls_max",
    ):
        value = episodes.get(field)
        if complete and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
            raise ValueError(f"powered failure-episode field is invalid: {field}")
        if not complete and value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
            raise ValueError(f"powered incomplete failure-episode field is invalid: {field}")
    if row_schema == ROW_V4:
        frontier = context.get("verification_frontier")
        if not isinstance(frontier, dict) or not isinstance(frontier.get("complete"), bool):
            raise ValueError("v4 row lacks verification-frontier settlement metadata")
        frontier_complete = frontier.get("settlement_summaries") == 1 and frontier.get("complete") is True
        if require_complete and not frontier_complete:
            raise ValueError("v4 row lacks exactly one valid verification-frontier settlement")
        if frontier_complete:
            for field in ("recognized_gates", "plateau_streak", "successful_mutation_epochs_since_advance", "verification_plateau_overrun"):
                value = frontier.get(field)
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    raise ValueError(f"v4 verification-frontier field is invalid: {field}")
            if not isinstance(frontier.get("last_advanced"), bool) or frontier.get("protocol") not in ("node_tap", "unknown"):
                raise ValueError("v4 verification-frontier protocol or advance flag is invalid")
            count_fields = ("current_passed", "current_failed", "current_skipped", "current_total",
                            "best_passed", "best_failed", "best_skipped", "best_total")
            if frontier["protocol"] == "node_tap":
                if frontier["recognized_gates"] < 1 or any(
                        not isinstance(frontier.get(field), int) or isinstance(frontier.get(field), bool) or frontier[field] < 0
                        for field in count_fields):
                    raise ValueError("v4 recognized frontier lacks bounded counts")
            elif frontier["recognized_gates"] != 0 or any(frontier.get(field) is not None for field in count_fields):
                raise ValueError("v4 unknown frontier carries invented counts")
    return row
