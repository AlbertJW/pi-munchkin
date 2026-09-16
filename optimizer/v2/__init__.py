"""Durable, benchmark-led optimizer V2 (dark; never adopts automatically)."""

CAMPAIGN_SCHEMA = "pi.optimizer-campaign/v2"
EVENT_SCHEMA = "pi.optimizer-event/v1"
CANDIDATE_SCHEMA = "pi.optimizer-candidate/v1"


# Explicit restoration is required before V2 can be imported or executed.
import sys as _mothball_sys
print("Optimizer mothballed by Albert on 2026-09-16. Execution is disabled; explicit restoration is required.", file=_mothball_sys.stderr)
raise SystemExit(78)
