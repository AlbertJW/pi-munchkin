#!/usr/bin/env python3
"""Pure treatment-exposure contracts for real-gate result rows."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CATALOG = Path(__file__).resolve().parents[2] / "harness" / "lib" / "telemetry-event-catalog.json"
MODES = {"configuration", "telemetry"}
STATUSES = {"control", "targeted", "engaged_only", "unexposed"}


def catalog_events() -> set[str]:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    events = data.get("events")
    if not isinstance(events, list) or any(not isinstance(x, str) for x in events):
        raise ValueError("telemetry-event-catalog.json must contain string events")
    return set(events)


def validate_spec(spec: Any) -> dict[str, Any]:
    if spec is None:
        return {"mode": "configuration", "target": [], "diagnostic": []}
    if not isinstance(spec, dict) or set(spec) != {"mode", "target", "diagnostic"}:
        raise ValueError("exposure must contain exactly mode, target, and diagnostic")
    mode = spec["mode"]
    if mode not in MODES:
        raise ValueError(f"unsupported exposure mode: {mode!r}")
    target, diagnostic = spec["target"], spec["diagnostic"]
    if not all(isinstance(v, list) and all(isinstance(x, str) and x for x in v)
               for v in (target, diagnostic)):
        raise ValueError("exposure target and diagnostic must be string arrays")
    if set(target) & set(diagnostic):
        raise ValueError("exposure target and diagnostic must be disjoint")
    declared = set(target) | set(diagnostic)
    if mode == "configuration" and declared:
        raise ValueError("configuration exposure cannot declare telemetry events")
    if mode == "telemetry" and not target:
        raise ValueError("telemetry exposure requires at least one target event")
    unknown = declared - catalog_events()
    if unknown:
        raise ValueError(f"unknown exposure event(s): {', '.join(sorted(unknown))}")
    return {"mode": mode, "target": list(target), "diagnostic": list(diagnostic)}


def status_for(spec: dict[str, Any], arm: str, counts: dict[str, int], *, configured: bool = False) -> str:
    if arm == "base":
        return "control"
    if spec["mode"] == "configuration":
        return "targeted" if configured else "unexposed"
    target_count = sum(counts.get(event, 0) for event in spec["target"])
    diagnostic_count = sum(counts.get(event, 0) for event in spec["diagnostic"])
    if target_count:
        return "targeted"
    if diagnostic_count:
        return "engaged_only"
    return "unexposed"


def row_exposure(spec: dict[str, Any], arm: str, counts: dict[str, int], *, configured: bool = False) -> dict[str, Any]:
    normalized = {event: int(counts.get(event, 0)) for event in spec["target"] + spec["diagnostic"]}
    return {
        "mode": spec["mode"],
        "status": status_for(spec, arm, normalized, configured=configured),
        "target_count": sum(normalized.get(event, 0) for event in spec["target"]),
        "counts": normalized,
    }


def selftest() -> None:
    telemetry = validate_spec({"mode": "telemetry", "target": ["did-you-mean/hint"], "diagnostic": []})
    assert row_exposure(telemetry, "base", {"did-you-mean/hint": 2})["status"] == "control"
    assert row_exposure(telemetry, "cand", {"did-you-mean/hint": 1})["status"] == "targeted"
    assert row_exposure(telemetry, "cand", {})["status"] == "unexposed"
    config = validate_spec({"mode": "configuration", "target": [], "diagnostic": []})
    assert row_exposure(config, "cand", {}, configured=True)["status"] == "targeted"
    try:
        validate_spec({"mode": "telemetry", "target": ["fake/event"], "diagnostic": []})
    except ValueError:
        pass
    else:
        raise AssertionError("fake telemetry event accepted")
    print("exposure selftest: OK")


if __name__ == "__main__":
    selftest()
