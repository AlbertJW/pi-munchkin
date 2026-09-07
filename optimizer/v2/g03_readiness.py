from __future__ import annotations

"""No-inference readiness probe for the G03 representative baseline.

The real baseline has two independent gates: the source/loaded surface and the
serving instrument.  This module checks both, plus the immutable case-task
binding, without sending a chat request.  llama-swap is lazy, so a healthy
router with an ``unloaded`` target is deliberately *not* ready.
"""

import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

try:
    from .baseline import BaselinePreregistration
    from .benchmark import BenchmarkPack
    from .real_baseline import _case_tasks_digest, _validate_case_tasks, load_case_tasks
except ImportError:  # direct ``python3 optimizer/v2/g03_readiness.py --selftest``
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from optimizer.v2.baseline import BaselinePreregistration
    from optimizer.v2.benchmark import BenchmarkPack
    from optimizer.v2.real_baseline import _case_tasks_digest, _validate_case_tasks, load_case_tasks


SCHEMA = "pi.g03-readiness/v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
MODEL_STATES = {"loaded", "running", "unloaded", "absent", "unknown"}
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
DEFAULT_TASK_MAP_SHA256 = "856d57e09ddc2a93ef4076395ee184777c14d8256f23bfa726a77d490b53f0ae"
TASK_ID = re.compile(r"^[a-z][a-z0-9._-]{0,127}$")


class ReadinessError(ValueError):
    """Raised when a readiness input cannot be trusted."""


def _sha(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise ReadinessError(f"{name} must be a lowercase SHA-256")
    return value


def validate_loopback_endpoint(value: str) -> str:
    """Return a canonical credential-free loopback endpoint."""

    if not isinstance(value, str) or len(value) > 256:
        raise ReadinessError("endpoint must be a bounded URL")
    try:
        parsed = urllib.parse.urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ReadinessError("endpoint is malformed") from exc
    if parsed.scheme != "http" or hostname is None or hostname.lower() not in LOOPBACK_HOSTS:
        raise ReadinessError("endpoint must be an http loopback URL")
    if parsed.username is not None or parsed.password is not None:
        raise ReadinessError("endpoint must not contain credentials")
    if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ReadinessError("endpoint must not contain a path, query, or fragment")
    if port is None:
        port = 80
    if not 1 <= port <= 65535:
        raise ReadinessError("endpoint port is invalid")
    host = hostname.lower()
    rendered = f"[{host}]" if ":" in host else host
    return f"http://{rendered}:{port}"


def classify_model_state(models: Any, requested_model: str) -> str:
    """Classify only the requested registry member, never the first catalog item."""

    if not isinstance(models, list) or not isinstance(requested_model, str) or not requested_model:
        return "unknown"
    for item in models:
        if not isinstance(item, dict) or item.get("id") != requested_model:
            continue
        status = item.get("status")
        value = status.get("value") if isinstance(status, dict) else None
        return value if isinstance(value, str) and value in MODEL_STATES - {"absent", "unknown"} else "unknown"
    return "absent"


def validate_execution_plan(
    pack: BenchmarkPack, case_tasks: dict[str, str], repository_root: str | pathlib.Path,
) -> dict[str, Any]:
    """Bind each case to the executor that is allowed to run its shape.

    The G03 map intentionally combines two execution surfaces: ordinary
    cases go through the trusted ``real_gate.sh`` evaluator, while research
    cases are recorded by the parent research runner and reduced later.  A
    plain case-to-task map is not enough to communicate that distinction, so
    readiness emits an explicit, validated execution plan.  This function is
    offline and never reads prompts or starts a process.
    """

    try:
        _validate_case_tasks(pack, case_tasks)
    except ValueError as exc:
        raise ReadinessError(f"case task binding is invalid: {exc}") from exc
    raw_root = pathlib.Path(repository_root).expanduser()
    if raw_root.is_symlink():
        raise ReadinessError("repository_root must not be a symlink")
    root = raw_root.resolve()
    if not root.is_dir():
        raise ReadinessError("repository_root must be a directory")

    cases: list[dict[str, Any]] = []
    executors: dict[str, list[str]] = {"real_gate": [], "research_parent": []}
    for split in ("train", "development"):
        for case in pack.splits[split]:
            task = case_tasks[case.case_id]
            if not isinstance(task, str) or not TASK_ID.fullmatch(task):
                raise ReadinessError(f"task identifier for {case.case_id} is invalid")
            if case.is_research:
                # Research cases have no real-gate manifest by design.  The
                # parent runner uses the admitted research spec and publishes
                # a private receipt for the reducer; verify that spec remains
                # a contained regular file at the same boundary.
                if not case.spec_path:
                    raise ReadinessError(f"research case {case.case_id} has no fixture spec")
                spec = root / case.spec_path
                resolved_spec = spec.resolve()
                if spec.is_symlink() or resolved_spec.is_symlink() or root not in resolved_spec.parents or not resolved_spec.is_file():
                    raise ReadinessError(f"research fixture spec for {case.case_id} is not a contained regular file")
                executor = "research_parent"
                item: dict[str, Any] = {
                    "case_id": case.case_id, "split": split, "kind": case.kind,
                    "task": task, "executor": executor, "spec_relpath": case.spec_path,
                }
            else:
                manifest_relpath = pathlib.PurePosixPath("optimizer", "real-gate-fixtures", "manifests", f"{task}.json")
                manifest = root.joinpath(*manifest_relpath.parts)
                resolved_manifest = manifest.resolve()
                if manifest.is_symlink() or resolved_manifest.is_symlink() or root not in resolved_manifest.parents or not resolved_manifest.is_file():
                    raise ReadinessError(f"real-gate manifest for {case.case_id} is missing or not a regular file")
                executor = "real_gate"
                item = {
                    "case_id": case.case_id, "split": split, "kind": case.kind,
                    "task": task, "executor": executor, "manifest_relpath": str(manifest_relpath),
                }
            cases.append(item)
            executors[executor].append(case.case_id)
    return {
        "schema": "pi.g03-execution-plan/v1",
        "cases": cases,
        "executors": executors,
        "research_cases_are_parent_recorded": True,
        "real_gate_is_trusted_evaluator": True,
    }


def assess_readiness(
    *, expected_source: str, actual_source: str,
    expected_loaded: str, actual_loaded: str,
    expected_task_map: str, actual_task_map: str,
    expected_model: str, model_state: str, health_ok: bool,
) -> dict[str, Any]:
    """Apply the fail-closed readiness policy to already-observed values."""

    for name, value in (
        ("expected_source", expected_source), ("actual_source", actual_source),
        ("expected_loaded", expected_loaded), ("actual_loaded", actual_loaded),
        ("expected_task_map", expected_task_map), ("actual_task_map", actual_task_map),
    ):
        _sha(value, name)
    if not isinstance(expected_model, str) or not expected_model or any(char in expected_model for char in "\r\n"):
        raise ReadinessError("expected_model is invalid")
    if model_state not in MODEL_STATES:
        raise ReadinessError("model_state is invalid")
    if not isinstance(health_ok, bool):
        raise ReadinessError("health_ok is invalid")
    reasons: list[str] = []
    if actual_source != expected_source:
        reasons.append("source_surface_mismatch")
    if actual_loaded != expected_loaded:
        reasons.append("loaded_surface_mismatch")
    if actual_task_map != expected_task_map:
        reasons.append("case_task_map_mismatch")
    if not health_ok:
        reasons.append("server_unhealthy")
    if model_state == "absent":
        reasons.append("model_absent")
    elif model_state == "unloaded":
        reasons.append("model_unloaded")
    elif model_state not in {"loaded", "running"}:
        reasons.append("model_state_unknown")
    return {
        "schema": SCHEMA,
        "execution": False,
        "inference_started": False,
        "human_approval_required": True,
        "ready": not reasons,
        "reasons": reasons,
        "expected_source_surface_sha256": expected_source,
        "actual_source_surface_sha256": actual_source,
        "expected_loaded_surface_sha256": expected_loaded,
        "actual_loaded_surface_sha256": actual_loaded,
        "expected_case_tasks_sha256": expected_task_map,
        "actual_case_tasks_sha256": actual_task_map,
        "model_state": model_state,
        "health_ok": health_ok,
        "model": expected_model,
    }


def _fetch_json(url: str, *, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status < 200 or response.status >= 300:
            raise ReadinessError("server returned a non-success status")
        body = response.read(1_048_576)
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ReadinessError("server returned malformed JSON") from exc
    if not isinstance(value, dict):
        raise ReadinessError("server response must be an object")
    return value


def probe_server(endpoint: str, requested_model: str, *, timeout: float = 5.0) -> dict[str, Any]:
    """Read health and model inventory; this function never calls chat/completions."""

    canonical = validate_loopback_endpoint(endpoint)
    endpoint_sha256 = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    health_ok = False
    health_error: str | None = None
    try:
        with urllib.request.urlopen(
            urllib.request.Request(canonical + "/health", method="GET"), timeout=timeout
        ) as response:
            health_ok = 200 <= response.status < 300
            response.read(4096)
    except (OSError, urllib.error.URLError, ReadinessError) as exc:
        health_error = type(exc).__name__.lower()
    model_state = "unknown"
    model_error: str | None = None
    try:
        payload = _fetch_json(canonical + "/v1/models", timeout=timeout)
        model_state = classify_model_state(payload.get("data"), requested_model)
    except (OSError, urllib.error.URLError, ReadinessError) as exc:
        model_error = type(exc).__name__.lower()
    return {
        "endpoint_sha256": endpoint_sha256,
        "health_ok": health_ok,
        "health_error": health_error,
        "model_state": model_state,
        "model_error": model_error,
    }


def _resolve_hash(script: pathlib.Path, target: pathlib.Path, *, node_bin: str) -> str:
    try:
        completed = subprocess.run(
            [node_bin, *( ["--experimental-strip-types"] if script.suffix == ".ts" else [] ), str(script), str(target)],
            cwd=str(script.parents[2]), stdin=subprocess.DEVNULL,
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ReadinessError("surface hash resolution failed") from exc
    if completed.returncode:
        raise ReadinessError("surface hash resolution failed")
    value = completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else ""
    return _sha(value, "resolved surface hash")


def run_readiness(
    *, pack_path: str | pathlib.Path, preregistration_path: str | pathlib.Path,
    repository_root: str | pathlib.Path, agent_dir: str | pathlib.Path,
    case_tasks: str | pathlib.Path, endpoint: str, model: str | None = None,
    expected_task_map_sha256: str = DEFAULT_TASK_MAP_SHA256,
    node_bin: str = "node", timeout: float = 5.0,
) -> dict[str, Any]:
    root_raw = pathlib.Path(repository_root).expanduser()
    if root_raw.is_symlink():
        raise ReadinessError("repository_root must not be a symlink")
    root = root_raw.resolve()
    if not root.is_dir():
        raise ReadinessError("repository_root must be a directory")
    agent_raw = pathlib.Path(agent_dir).expanduser()
    if agent_raw.is_symlink() or not agent_raw.is_dir():
        raise ReadinessError("agent_dir must be a real directory")
    pack_raw = pathlib.Path(pack_path).expanduser()
    prereg_raw = pathlib.Path(preregistration_path).expanduser()
    if pack_raw.is_symlink() or prereg_raw.is_symlink():
        raise ReadinessError("frozen pack/preregistration must not be symlinks")
    if not pack_raw.is_file() or not prereg_raw.is_file():
        raise ReadinessError("frozen pack/preregistration must be regular files")
    pack = BenchmarkPack.load(pack_raw.resolve())
    prereg = BaselinePreregistration.load(prereg_raw.resolve())
    requested_model = model or prereg.subject_model["model"]
    if requested_model != prereg.subject_model["model"]:
        raise ReadinessError("model does not match the preregistered subject")
    mapping = load_case_tasks(case_tasks)
    execution_plan = validate_execution_plan(pack, mapping, root)
    expected_task_map_sha256 = _sha(expected_task_map_sha256, "expected_task_map_sha256")
    actual_source = _resolve_hash(root / "harness/scripts/source-surface-hash.mjs", root, node_bin=node_bin)
    actual_loaded = _resolve_hash(root / "harness/scripts/surface-hash.ts", agent_raw.resolve(), node_bin=node_bin)
    server = probe_server(endpoint, requested_model, timeout=timeout)
    result = assess_readiness(
        expected_source=prereg.surface_identity["source_sha256"], actual_source=actual_source,
        expected_loaded=prereg.surface_identity["surface_sha256"], actual_loaded=actual_loaded,
        expected_task_map=expected_task_map_sha256, actual_task_map=_case_tasks_digest(mapping),
        expected_model=requested_model, model_state=server["model_state"], health_ok=server["health_ok"],
    )
    result["preregistration_sha256"] = prereg.sha256
    result["benchmark_pack_sha256"] = pack.sha256
    result["execution_plan"] = execution_plan
    result["server"] = server
    return result


def selftest() -> None:
    models = [{"id": "qwen36-35b-iq3s", "status": {"value": "unloaded"}}]
    assert classify_model_state(models, "qwen36-35b-iq3s") == "unloaded"
    assert classify_model_state(models, "other") == "absent"
    assert validate_loopback_endpoint("http://127.0.0.1:8080") == "http://127.0.0.1:8080"
    for bad in ("https://example.com:8080", "http://u:p@127.0.0.1:8080", "http://127.0.0.1:8080/x"):
        try:
            validate_loopback_endpoint(bad)
        except ReadinessError:
            pass
        else:
            raise AssertionError("invalid endpoint accepted")
    result = assess_readiness(
        expected_source="a" * 64, actual_source="a" * 64,
        expected_loaded="b" * 64, actual_loaded="b" * 64,
        expected_task_map="c" * 64, actual_task_map="c" * 64,
        expected_model="qwen36-35b-iq3s", model_state="unloaded", health_ok=True,
    )
    assert result["ready"] is False and result["inference_started"] is False
    print("g03 readiness selftest: OK (identity, loopback, unloaded-target, no-inference policy)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m optimizer.v2.g03_readiness")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--selftest", action="store_true")
    modes.add_argument("--dry", action="store_true")
    parser.add_argument("--pack")
    parser.add_argument("--preregistration")
    parser.add_argument("--repository-root")
    parser.add_argument("--agent-dir")
    parser.add_argument("--case-tasks")
    parser.add_argument("--expected-task-map", default=DEFAULT_TASK_MAP_SHA256)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8080")
    parser.add_argument("--model")
    parser.add_argument("--node-bin", default="node")
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args(argv)
    try:
        if args.selftest:
            selftest()
            return 0
        required = (args.pack, args.preregistration, args.repository_root, args.agent_dir, args.case_tasks)
        if any(value is None for value in required):
            parser.error("--dry requires --pack, --preregistration, --repository-root, --agent-dir, and --case-tasks")
        result = run_readiness(
            pack_path=args.pack, preregistration_path=args.preregistration,
            repository_root=args.repository_root, agent_dir=args.agent_dir,
            case_tasks=args.case_tasks, endpoint=args.endpoint, model=args.model,
            expected_task_map_sha256=args.expected_task_map,
            node_bin=args.node_bin, timeout=args.timeout,
        )
        print(json.dumps(result, sort_keys=True))
        return 0 if result["ready"] else 1
    except (OSError, ReadinessError, ValueError, subprocess.SubprocessError) as exc:
        print(f"g03-readiness: {exc}", file=__import__("sys").stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
