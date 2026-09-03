#!/usr/bin/env python3
"""No-inference preflight for the dark hierarchical planner screen.

The preflight binds the prepared fixture slate to the source checkout, the
loaded Pi mirror, the two planner configurations, and the exact subject model.
It never starts Pi, contacts the model server, fetches a source, or writes a
receipt. A successful result means that a human may review and explicitly run
the separate bounded launcher; it is not model or fixture-quality evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[1]
HEX64 = re.compile(r"^[0-9a-f]{64}$")
DEFAULT_SOURCE = "d333be721bc9eecb41d54ba732d96f65e5edc9eb286a367893be63f6152b1440"
DEFAULT_LOADED = "73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315"
DEFAULT_MODEL = "local-llamacpp/qwen36-35b-iq3s"
REQUIRED_KINDS = {"comparative", "contested", "multi_part"}
COMPLETION_FIXTURE_ID = "compare-json-yaml-config"
CONFIGS = {
    "candidate": {
        "path": REPO / "optimizer/prompt-lab/configs/pending/deep-research-planning.json",
        "sha256": "0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e",
        "thresholds": {"RESEARCH_LEDGER": "on", "PLAN_GRAPH": "on", "DEEP_RESEARCH_PLANNING": "on"},
    },
    "control": {
        "path": REPO / "optimizer/prompt-lab/configs/pending/deep-research-planning-control.json",
        "sha256": "a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7",
        "thresholds": {"RESEARCH_LEDGER": "on", "PLAN_GRAPH": "off", "DEEP_RESEARCH_PLANNING": "off"},
    },
}


class PreflightError(ValueError):
    pass


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _load_admission_module():
    path = ROOT / "admission.py"
    spec = importlib.util.spec_from_file_location("research_fixture_admission", path)
    if spec is None or spec.loader is None:
        raise PreflightError("cannot load fixture admission module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _surface_hash(agent_dir: pathlib.Path, *, node_bin: str) -> str:
    script = REPO / "harness/scripts/surface-hash.ts"
    try:
        completed = subprocess.run(
            [node_bin, "--experimental-strip-types", str(script), str(agent_dir)],
            cwd=str(REPO), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise PreflightError(f"loaded surface hash resolution failed: {exc}") from exc
    if completed.returncode:
        raise PreflightError("loaded surface hash resolution failed")
    value = completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else ""
    if not HEX64.fullmatch(value):
        raise PreflightError("loaded surface hash resolution returned an invalid digest")
    return value


def _source_hash(*, node_bin: str) -> str:
    script = REPO / "harness/scripts/source-surface-hash.mjs"
    try:
        completed = subprocess.run(
            [node_bin, str(script), str(REPO)],
            cwd=str(REPO), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise PreflightError(f"source surface hash resolution failed: {exc}") from exc
    if completed.returncode:
        raise PreflightError("source surface hash resolution failed")
    value = completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else ""
    if not HEX64.fullmatch(value):
        raise PreflightError("source surface hash resolution returned an invalid digest")
    return value


def _validate_config(label: str, expected: dict) -> dict[str, Any]:
    path = pathlib.Path(expected["path"])
    if not path.is_file() or path.is_symlink():
        raise PreflightError(f"{label} configuration is not a regular file")
    actual_sha = sha256_file(path)
    if actual_sha != expected["sha256"]:
        raise PreflightError(f"{label} configuration hash mismatch")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PreflightError(f"{label} configuration is not valid JSON") from exc
    if not isinstance(raw, dict) or raw.get("thresholds") != expected["thresholds"]:
        raise PreflightError(f"{label} planner thresholds do not match the preregistration")
    if raw.get("prompt_variant") != "A" or raw.get("format") != "md" or raw.get("scaffold") != "none":
        raise PreflightError(f"{label} configuration has an unapproved surface delta")
    return raw


def run_preflight(
    *, agent_dir: pathlib.Path, expected_source: str, expected_loaded: str,
    model: str, node_bin: str = "node",
) -> dict[str, Any]:
    if not agent_dir.is_dir() or agent_dir.is_symlink():
        raise PreflightError("--agent-dir must resolve to a real directory")
    if not HEX64.fullmatch(expected_source) or not HEX64.fullmatch(expected_loaded):
        raise PreflightError("expected source and loaded values must be lowercase SHA-256 digests")
    if model != DEFAULT_MODEL or any(char in model for char in "\r\n"):
        raise PreflightError(f"model must be the preregistered subject {DEFAULT_MODEL}")
    source = _source_hash(node_bin=node_bin)
    if source != expected_source:
        raise PreflightError("source surface hash does not match the preregistration")
    loaded = _surface_hash(agent_dir, node_bin=node_bin)
    if loaded != expected_loaded:
        raise PreflightError("loaded surface hash does not match the preregistration")
    configs = {label: _validate_config(label, expected) for label, expected in CONFIGS.items()}
    admission = _load_admission_module()
    records = admission.check_slate()
    return {
        "schema": "pi.planner-preflight/v1",
        "execution": False,
        "source_surface_sha256": source,
        "loaded_surface_sha256": loaded,
        "model": model,
        "config_sha256": {label: CONFIGS[label]["sha256"] for label in CONFIGS},
        "flags": {label: configs[label]["thresholds"] for label in configs},
        "fixture_count": len(records),
        "fixture_ids": [record["fixture_id"] for record in records],
        "fixture_kinds": sorted({record["kind"] for record in records}),
        "human_approval_required": True,
        "inference_started": False,
    }


def selftest() -> None:
    admission = _load_admission_module()
    records = admission.check_slate()
    assert len(records) >= 3
    assert REQUIRED_KINDS.issubset({record["kind"] for record in records})
    assert COMPLETION_FIXTURE_ID in {record["fixture_id"] for record in records}
    # Keep the no-argument dry command honest when the model-visible source
    # surface moves.  A stale frozen default must fail this selftest instead of
    # leaving the planner launcher apparently ready against the wrong surface.
    assert DEFAULT_SOURCE == _source_hash(node_bin="node")
    for label, expected in CONFIGS.items():
        config = _validate_config(label, expected)
        assert config["thresholds"] == expected["thresholds"]
    assert _digest({"a": 1, "b": 2}) == _digest({"b": 2, "a": 1})
    print("planner preflight selftest: OK (identity, config, fixture slate, no inference)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research-fixtures/preflight.py")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--dry", action="store_true")
    parser.add_argument("--agent-dir")
    parser.add_argument("--expected-source", default=DEFAULT_SOURCE)
    parser.add_argument("--expected-loaded", default=DEFAULT_LOADED)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--node-bin", default="node")
    args = parser.parse_args(argv)
    try:
        if args.selftest:
            selftest(); return 0
        if not args.dry:
            parser.error("choose --dry or --selftest")
        if not args.agent_dir:
            raise PreflightError("--dry requires --agent-dir")
        print(json.dumps(run_preflight(
            agent_dir=pathlib.Path(args.agent_dir).expanduser().resolve(),
            expected_source=args.expected_source, expected_loaded=args.expected_loaded,
            model=args.model, node_bin=args.node_bin,
        ), sort_keys=True))
        return 0
    except (OSError, PreflightError, subprocess.SubprocessError) as exc:
        print(f"planner-preflight: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
