#!/usr/bin/env python3
"""Bounded, deterministic oracle for the G03 baseline protocol.

The oracle consumes only a redacted result summary. It checks that a trial
reported its required local signals (artifact persistence, verification,
evidence/source binding, and stop/telemetry classification) and emits counts.
It never reads prompts, transcripts, source contents, or model output.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    value = json.load(sys.stdin)
    if not isinstance(value, dict):
        return 2
    required = {"case_id", "kind", "arm", "outcome", "artifact_persisted", "verification_passed", "source_identity_bound", "stop_class", "child_telemetry"}
    if set(value) != required:
        return 2
    if any(not isinstance(value[key], str) or not value[key] for key in ("case_id", "kind", "arm", "outcome", "stop_class", "child_telemetry")):
        return 2
    if value["arm"] not in {"baseline", "candidate"} or value["outcome"] not in {"success", "failure", "invalid", "timeout"}:
        return 1
    if any(type(value[key]) is not bool for key in ("artifact_persisted", "verification_passed", "source_identity_bound")):
        return 2
    if value["child_telemetry"] not in {"available", "unavailable-contained", "not-applicable"}:
        return 2
    checks = {
        "artifact_persisted": value["artifact_persisted"],
        "verification_passed": value["verification_passed"],
        "source_identity_bound": value["source_identity_bound"],
        "outcome_valid": value["outcome"] != "invalid",
    }
    print(json.dumps({"schema": "pi.baseline-oracle/v1", "checks": checks, "passed": all(checks.values())}, sort_keys=True, separators=(",", ":")))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
