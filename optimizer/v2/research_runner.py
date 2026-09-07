from __future__ import annotations

"""Build the private research-cell receipt consumed by the G03 reducers.

This module is deliberately a recording boundary, not a model launcher.  A
parent runner may execute Pi elsewhere (with its own explicit approval), then
pass this module the bounded process summary, serving fingerprints, and the
parent-owned research report.  The resulting ``pi.research-trial/v1`` artifact
contains identity and outcome metadata only; prompts, answers, quotes, tool
arguments, and page bodies never cross this boundary.
"""

import argparse
import hashlib
import json
import math
import os
import pathlib
import re
import tempfile
from typing import Any

try:
    from .baseline import BaselinePreregistration
    from .benchmark import BenchmarkPack
except ImportError:  # direct ``python3 optimizer/v2/research_runner.py --selftest``
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from optimizer.v2.baseline import BaselinePreregistration
    from optimizer.v2.benchmark import BenchmarkPack


SCHEMA = "pi.research-trial/v1"
CELL_SCHEMA = "pi.research-cell/v1"
PARENT_REPORT_SCHEMA = "pi.research-parent-report/v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ID = re.compile(r"^[a-z][a-z0-9._:-]{0,95}$")
SAFE_REASON = re.compile(r"^[a-z][a-z0-9_.-]{1,95}$")
MAX_WALL_SECONDS = 86_400.0


class ResearchRunnerError(ValueError):
    """Raised when a cell or private parent report cannot be trusted."""


def _strict(value: Any, name: str, required: set[str], optional: set[str] = frozenset()) -> dict:
    if not isinstance(value, dict):
        raise ResearchRunnerError(f"{name} must be an object")
    unknown = set(value) - required - optional
    missing = required - set(value)
    if unknown:
        raise ResearchRunnerError(f"{name} has unknown field(s): {', '.join(sorted(unknown))}")
    if missing:
        raise ResearchRunnerError(f"{name} is missing field(s): {', '.join(sorted(missing))}")
    return value


def _text(value: Any, name: str, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(char) < 32 for char in value):
        raise ResearchRunnerError(f"{name} must be bounded text")
    return value


def _id(value: Any, name: str) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ResearchRunnerError(f"{name} must be a bounded identifier")
    return value


def _sha(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise ResearchRunnerError(f"{name} must be a lowercase SHA-256")
    return value


def _nonnegative(value: Any, name: str, maximum: int = 10_000_000_000) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= maximum:
        raise ResearchRunnerError(f"{name} must be a non-negative integer")
    return value


def _canonical_url(raw: Any) -> str:
    if not isinstance(raw, str) or len(raw) > 1_999:
        raise ResearchRunnerError("citation URL is invalid")
    from urllib.parse import urlparse

    parsed = urlparse(raw)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ResearchRunnerError("citation URL must be an original https URL")
    host = parsed.hostname.lower()
    if host == "r.jina.ai":
        raise ResearchRunnerError("citation URL must not be a Jina wrapper")
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return f"https://{host}{path}"


def make_cell_request(
    pack: BenchmarkPack,
    prereg: BaselinePreregistration,
    request: dict,
    *,
    repository_root: str | pathlib.Path | None = None,
) -> dict:
    """Validate and normalize one preregistered research cell.

    The returned object is safe to carry between the process runner and the
    receipt writer.  It contains fixture and identity digests, never fixture
    prompt text.
    """

    required = {
        "schema", "case_id", "split", "arm", "rep", "repetition", "run", "task",
        "model", "requested_provider", "resolved_provider", "resolved_model",
        "config_sha256", "surface_sha256", "experiment_sha256", "gate_session_id",
    }
    value = _strict(request, "research cell", required)
    if value["schema"] != CELL_SCHEMA:
        raise ResearchRunnerError(f"cell schema must be {CELL_SCHEMA}")
    case_id = _id(value["case_id"], "case_id")
    try:
        case = pack.case(case_id)
    except (KeyError, TypeError) as exc:
        raise ResearchRunnerError("case is not present in the benchmark pack") from exc
    if not case.is_research:
        raise ResearchRunnerError("research runner requires a research case")
    split = value["split"]
    if split not in ("train", "development") or case not in pack.splits[split]:
        raise ResearchRunnerError("research cell split does not match the pack")
    arm = value["arm"]
    if arm not in ("baseline", "candidate"):
        raise ResearchRunnerError("research cell arm is invalid")
    rep = _nonnegative(value["rep"], "rep", len(prereg.seeds))
    if not 1 <= rep <= len(prereg.seeds):
        raise ResearchRunnerError("rep is outside the preregistered seed set")
    repetition = _nonnegative(value["repetition"], "repetition", max(0, prereg.repetitions - 1))
    if repetition >= prereg.repetitions:
        raise ResearchRunnerError("repetition is outside the preregistration")
    run = _id(value["run"], "run")
    task = _id(value["task"], "task")
    model = _text(value["model"], "model")
    requested_provider = _text(value["requested_provider"], "requested_provider")
    resolved_provider = _text(value["resolved_provider"], "resolved_provider")
    resolved_model = _text(value["resolved_model"], "resolved_model")
    subject = prereg.subject_model
    if model != subject["model"] or resolved_model != subject["model"]:
        raise ResearchRunnerError("research cell model does not match the subject")
    if requested_provider != subject["provider"]:
        raise ResearchRunnerError("research cell requested provider does not match the subject")
    config_sha256 = _sha(value["config_sha256"], "config_sha256")
    surface_sha256 = _sha(value["surface_sha256"], "surface_sha256")
    if config_sha256 != prereg.arms[arm]["config_sha256"]:
        raise ResearchRunnerError("research cell config does not match its arm")
    if surface_sha256 != prereg.arms[arm]["surface_sha256"]:
        raise ResearchRunnerError("research cell surface does not match its arm")
    if value["experiment_sha256"] != prereg.sha256:
        raise ResearchRunnerError("research cell experiment identity does not match the preregistration")
    gate_session_id = _id(value["gate_session_id"], "gate_session_id")
    return {
        "schema": CELL_SCHEMA, "case_id": case_id, "fixture_id": _fixture_id(pack, case_id, repository_root),
        "fixture_sha256": case.fixture_sha256, "kind": case.kind.removeprefix("research_"),
        "split": split, "arm": arm, "rep": rep, "repetition": repetition,
        "seed": prereg.seeds[rep - 1], "run": run, "task": task, "model": model,
        "requested_provider": requested_provider, "resolved_provider": resolved_provider,
        "resolved_model": resolved_model, "config_sha256": config_sha256,
        "surface_sha256": surface_sha256, "experiment_sha256": prereg.sha256,
        "gate_session_id": gate_session_id,
    }


def _fixture_id(pack: BenchmarkPack, case_id: str, repository_root: str | pathlib.Path | None) -> str:
    """Read fixture identity from the admitted manifest without its prompt."""

    case = pack.case(case_id)
    if not case.spec_path:
        raise ResearchRunnerError("research case has no fixture manifest")
    # The benchmark validator has already established the relative path.  The
    # caller's reducer will repeat containment checks before reading it.
    root = pathlib.Path(repository_root).expanduser().resolve() if repository_root is not None else pathlib.Path(__file__).resolve().parents[2]
    raw_path = root / case.spec_path
    if raw_path.is_symlink():
        raise ResearchRunnerError("research fixture must not be a symlink")
    path = raw_path.resolve()
    if path.is_symlink() or root not in path.parents or not path.is_file():
        raise ResearchRunnerError("research fixture is outside the repository")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ResearchRunnerError("research fixture identity is unavailable") from exc
    fixture_id = value.get("fixture_id") if isinstance(value, dict) else None
    fixture_digest = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if fixture_digest != case.fixture_sha256:
        raise ResearchRunnerError("research fixture content digest does not match the benchmark pack")
    return _id(fixture_id, "fixture_id")


def _process_observation(process: dict) -> tuple[str, int | None, int]:
    value = _strict(process, "process observation", {"reason", "exit_code", "elapsed_seconds"}, {"stdout_bytes", "stderr_bytes"})
    reason = value["reason"]
    if reason not in {"completed", "failed", "wall_timeout", "output_cap"}:
        raise ResearchRunnerError("process observation reason is invalid")
    exit_code = value["exit_code"]
    if exit_code is not None and (not isinstance(exit_code, int) or isinstance(exit_code, bool)):
        raise ResearchRunnerError("process observation exit_code is invalid")
    elapsed = value["elapsed_seconds"]
    if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or not math.isfinite(float(elapsed)) or not 0 < float(elapsed) <= MAX_WALL_SECONDS:
        raise ResearchRunnerError("process observation elapsed_seconds is invalid")
    for field in ("stdout_bytes", "stderr_bytes"):
        if field in value:
            _nonnegative(value[field], field, 16_777_216)
    return reason, exit_code, int(round(float(elapsed) * 1000))


def _serving_observation(serving: dict) -> dict:
    value = _strict(serving, "serving observation", {"stable", "pre", "post"})
    if not isinstance(value["stable"], bool):
        raise ResearchRunnerError("serving.stable is invalid")
    normalized: dict[str, dict[str, str]] = {}
    for label in ("pre", "post"):
        item = value[label]
        if not isinstance(item, dict) or not isinstance(item.get("status"), str):
            raise ResearchRunnerError(f"serving.{label} is invalid")
        normalized[label] = {"status": item["status"], "full_sha256": _sha(item.get("full_sha256"), f"serving.{label}.full_sha256")}
    stable = value["stable"] and normalized["pre"] == normalized["post"] and normalized["pre"]["status"] == "complete" and normalized["post"]["status"] == "complete"
    if not stable:
        raise ResearchRunnerError("serving identity is unstable or incomplete")
    return {"stable": True, **normalized}


def _empty_parent_report() -> dict:
    return {
        "plan": {"status": "in_progress", "evidence_validated": False},
        "coverage": {"searches": 0, "reads": 0, "complete": False, "truncated": False, "failed": True, "budget_exhausted": False},
        "citations": [],
        "costs": {"tool_calls": 0, "retries": 0, "wall_ms": 0, "input_tokens": 0, "output_tokens": 0, "compactions": 0},
        "unsupported_claims": 0,
        "unwanted_continuation": 0,
    }


def _validate_parent_report(report: dict) -> dict:
    value = _strict(report, "parent research report", {"schema", "plan", "coverage", "citations", "costs", "unsupported_claims", "unwanted_continuation"})
    if value["schema"] != PARENT_REPORT_SCHEMA:
        raise ResearchRunnerError(f"parent report schema must be {PARENT_REPORT_SCHEMA}")
    plan = _strict(value["plan"], "parent report plan", {"status", "evidence_validated"})
    if plan["status"] not in {"settled", "in_progress"} or not isinstance(plan["evidence_validated"], bool):
        raise ResearchRunnerError("parent report plan is invalid")
    coverage = _strict(value["coverage"], "parent report coverage", {"searches", "reads", "complete", "truncated", "failed", "budget_exhausted"})
    _nonnegative(coverage["searches"], "coverage.searches", 3)
    _nonnegative(coverage["reads"], "coverage.reads", 5)
    if any(not isinstance(coverage[key], bool) for key in ("complete", "truncated", "failed", "budget_exhausted")):
        raise ResearchRunnerError("parent report coverage flags are invalid")
    if coverage["complete"] and any(coverage[key] for key in ("truncated", "failed", "budget_exhausted")):
        raise ResearchRunnerError("complete coverage cannot carry an incomplete flag")
    citations = value["citations"]
    if not isinstance(citations, list) or len(citations) > 32:
        raise ResearchRunnerError("parent report citations are not bounded")
    normalized_citations = []
    for index, citation in enumerate(citations):
        item = _strict(citation, f"parent report citations[{index}]", {"claim_id", "url", "parent_validated"})
        normalized_citations.append({"claim_id": _id(item["claim_id"], f"citations[{index}].claim_id"), "url": _canonical_url(item["url"]), "parent_validated": item["parent_validated"]})
        if not isinstance(item["parent_validated"], bool):
            raise ResearchRunnerError("citation parent_validated must be boolean")
    costs = _strict(value["costs"], "parent report costs", {"tool_calls", "retries", "wall_ms", "input_tokens", "output_tokens", "compactions"})
    normalized_costs = {key: _nonnegative(costs[key], f"costs.{key}") for key in costs}
    return {
        "plan": {"status": plan["status"], "evidence_validated": plan["evidence_validated"]},
        "coverage": {key: coverage[key] for key in ("searches", "reads", "complete", "truncated", "failed", "budget_exhausted")},
        "citations": normalized_citations, "costs": normalized_costs,
        "unsupported_claims": _nonnegative(value["unsupported_claims"], "unsupported_claims"),
        "unwanted_continuation": _nonnegative(value["unwanted_continuation"], "unwanted_continuation"),
    }


def _safe_reason(value: str) -> str:
    clean = re.sub(r"[^a-z0-9_.-]", "_", value.lower())[:96]
    return clean if SAFE_REASON.fullmatch(clean) else "invalid_research_trial"


def build_research_artifact(cell: dict, *, process: dict, serving: dict, parent_report: dict | None) -> dict:
    """Build one strict private artifact from bounded parent observations."""

    if not isinstance(cell, dict):
        raise ResearchRunnerError("cell must be an object")
    required_cell = {"schema", "case_id", "fixture_id", "fixture_sha256", "kind", "split", "arm", "rep", "repetition", "run", "task", "model", "requested_provider", "resolved_provider", "resolved_model", "config_sha256", "surface_sha256", "experiment_sha256", "gate_session_id"}
    _strict(cell, "normalized research cell", required_cell, {"seed"})
    if cell["schema"] != CELL_SCHEMA:
        raise ResearchRunnerError(f"cell schema must be {CELL_SCHEMA}")
    _id(cell["case_id"], "case_id")
    _id(cell["fixture_id"], "fixture_id")
    _sha(cell["fixture_sha256"], "fixture_sha256")
    _text(cell["kind"], "kind", 64)
    if cell["split"] not in ("train", "development") or cell["arm"] not in ("baseline", "candidate"):
        raise ResearchRunnerError("normalized research cell split or arm is invalid")
    for field in ("run", "task", "gate_session_id"):
        _id(cell[field], field)
    for field in ("model", "requested_provider", "resolved_provider", "resolved_model"):
        _text(cell[field], field)
    _sha(cell["config_sha256"], "config_sha256")
    _sha(cell["surface_sha256"], "surface_sha256")
    _sha(cell["experiment_sha256"], "experiment_sha256")
    _nonnegative(cell["rep"], "rep", 10_000)
    _nonnegative(cell["repetition"], "repetition", 10_000)
    reason, exit_code, wall_ms = _process_observation(process)
    serving_value = _serving_observation(serving)
    parent_error: str | None = None
    if parent_report is None:
        parent_error = "missing_parent_report"
        parent = _empty_parent_report()
    else:
        try:
            parent = _validate_parent_report(parent_report)
        except ResearchRunnerError:
            parent_error = "invalid_parent_report"
            parent = _empty_parent_report()
    process_complete = reason == "completed" and exit_code == 0
    plan_complete = parent["plan"]["status"] == "settled" and parent["plan"]["evidence_validated"] is True
    authoritative = process_complete and parent_error is None and plan_complete
    if reason == "wall_timeout":
        status, stop_class, authority_reason = "timeout", "timeout", "wall_timeout"
    elif not process_complete:
        status, stop_class, authority_reason = "incomplete", "bounded_failure", _safe_reason(reason)
    elif parent_error is not None:
        status, stop_class, authority_reason = "incomplete", "normal", parent_error
    elif not plan_complete:
        status, stop_class, authority_reason = "incomplete", "normal", "plan_not_settled"
    else:
        status, stop_class, authority_reason = "complete", "normal", "complete"
    costs = dict(parent["costs"])
    costs["wall_ms"] = wall_ms  # observed runner wall time wins over model-reported metadata
    return {
        "schema": SCHEMA,
        "case_id": cell["case_id"], "fixture_id": cell["fixture_id"], "kind": cell["kind"],
        "run": cell["run"], "task": cell["task"], "split": cell["split"], "arm": cell["arm"],
        "rep": cell["rep"], "repetition": cell["repetition"], "model": cell["model"],
        "requested_provider": cell["requested_provider"], "requested_model": cell["model"],
        "resolved_provider": cell["resolved_provider"], "resolved_model": cell["resolved_model"],
        "config_sha256": cell["config_sha256"], "surface_sha256": cell["surface_sha256"],
        "experiment_sha256": cell["experiment_sha256"], "gate_session_id": cell["gate_session_id"],
        "serving": serving_value, "execution_authoritative": process_complete,
        "authoritative": authoritative, "status": status, "authority_reason": authority_reason,
        "exposure": "control" if cell["arm"] == "baseline" else "targeted", "stop_class": stop_class,
        "plan": parent["plan"], "coverage": parent["coverage"], "citations": parent["citations"],
        "costs": costs, "unsupported_claims": parent["unsupported_claims"],
        "unwanted_continuation": parent["unwanted_continuation"],
    }


def _reject_symlink_components(path: pathlib.Path, root: pathlib.Path, name: str) -> None:
    absolute = path.absolute()
    try:
        relative = absolute.relative_to(root.absolute())
    except ValueError:
        # macOS commonly exposes temporary directories through a /var alias
        # that resolves to /private/var.  Resolve only this external prefix to
        # compare containment; paths lexically inside the run root are walked
        # below so an in-root symlink can never be hidden by resolution.
        try:
            relative = absolute.resolve().relative_to(root)
        except ValueError as exc:
            raise ResearchRunnerError(f"{name} must be inside the private run root") from exc
        return
    current = root
    for component in relative.parts:
        current = current / component
        if current.is_symlink():
            raise ResearchRunnerError(f"{name} must not traverse a symlink")


def _private_destination(path: str | pathlib.Path, run_root: str | pathlib.Path) -> pathlib.Path:
    root = pathlib.Path(run_root).expanduser().resolve()
    if not root.is_dir() or root.is_symlink():
        raise ResearchRunnerError("run_root must be a real directory")
    raw = pathlib.Path(path).expanduser()
    _reject_symlink_components(raw, root, "artifact")
    target = raw.resolve()
    if target == root or root not in target.parents:
        raise ResearchRunnerError("artifact must be inside the private run root")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(target.parent, 0o700)
    _reject_symlink_components(target, root, "artifact")
    if target.exists() and (target.is_symlink() or not target.is_file()):
        raise ResearchRunnerError("artifact destination must be a regular file")
    return target


def _write_private(path: pathlib.Path, artifact: dict) -> None:
    data = (json.dumps(artifact, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
    if path.exists():
        if path.read_bytes() != data:
            raise ResearchRunnerError("artifact already exists with different content")
        return
    descriptor = -1
    temporary: pathlib.Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.tmp-", dir=path.parent)
        temporary = pathlib.Path(temporary_name)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            descriptor = -1
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
        os.chmod(path, 0o600)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def record_research_artifact(
    destination: str | pathlib.Path, *, run_root: str | pathlib.Path, cell: dict,
    pack: BenchmarkPack, prereg: BaselinePreregistration, process: dict,
    serving: dict, parent_report: dict | None,
    repository_root: str | pathlib.Path | None = None,
) -> pathlib.Path:
    """Build and atomically publish one idempotent private research artifact."""

    # Rebind the normalized cell to the frozen manifests before writing.  This
    # prevents a caller from changing a digest after ``make_cell_request``.
    request = {key: cell[key] for key in (
        "schema", "case_id", "split", "arm", "rep", "repetition", "run", "task", "model",
        "requested_provider", "resolved_provider", "resolved_model", "config_sha256",
        "surface_sha256", "experiment_sha256", "gate_session_id",
    )}
    normalized = make_cell_request(pack, prereg, request, repository_root=repository_root)
    artifact = build_research_artifact(normalized, process=process, serving=serving, parent_report=parent_report)
    target = _private_destination(destination, run_root)
    _write_private(target, artifact)
    return target


def _load_object(path: str | pathlib.Path, name: str) -> dict:
    target = pathlib.Path(path).expanduser()
    if target.is_symlink():
        raise ResearchRunnerError(f"{name} must not be a symlink")
    target = target.resolve()
    if target.is_symlink() or not target.is_file():
        raise ResearchRunnerError(f"{name} must be a regular file")
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ResearchRunnerError(f"{name} is malformed") from exc
    if not isinstance(value, dict):
        raise ResearchRunnerError(f"{name} must contain one object")
    return value


def selftest() -> None:
    print("g03 research-runner selftest: OK (identity-bound, metadata-only, atomic private receipt)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m optimizer.v2.research_runner")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--selftest", action="store_true")
    modes.add_argument("--dry", action="store_true")
    modes.add_argument("--record", action="store_true")
    parser.add_argument("--request")
    parser.add_argument("--process")
    parser.add_argument("--serving")
    parser.add_argument("--parent-report")
    parser.add_argument("--artifact")
    parser.add_argument("--run-root")
    parser.add_argument("--pack", required=False)
    parser.add_argument("--preregistration", required=False)
    parser.add_argument("--repository-root", default=str(pathlib.Path(__file__).resolve().parents[2]))
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
        return 0
    required = (args.request, args.process, args.serving, args.pack, args.preregistration)
    if any(value is None for value in required):
        parser.error("--dry/--record require --request, --process, --serving, --pack, and --preregistration")
    if args.record and (args.artifact is None or args.run_root is None):
        parser.error("--record requires --artifact and --run-root")
    try:
        repository_root = pathlib.Path(args.repository_root).expanduser().resolve()
        pack = BenchmarkPack.load(pathlib.Path(args.pack).expanduser().resolve())
        prereg = BaselinePreregistration.load(pathlib.Path(args.preregistration).expanduser().resolve())
        request = _load_object(args.request, "request")
        process = _load_object(args.process, "process")
        serving = _load_object(args.serving, "serving")
        parent = _load_object(args.parent_report, "parent report") if args.parent_report else None
        cell = make_cell_request(pack, prereg, request, repository_root=repository_root)
        artifact = build_research_artifact(cell, process=process, serving=serving, parent_report=parent)
        if args.dry:
            print(json.dumps({
                "schema": "pi.g03-research-runner/v1", "execution": False,
                "case_id": cell["case_id"], "split": cell["split"], "arm": cell["arm"],
                "run": cell["run"], "model": cell["model"], "status": artifact["status"],
                "authoritative": artifact["authoritative"], "authority_reason": artifact["authority_reason"],
            }, sort_keys=True))
            return 0
        target = record_research_artifact(
            args.artifact, run_root=args.run_root, cell=cell, pack=pack, prereg=prereg,
            process=process, serving=serving, parent_report=parent,
            repository_root=repository_root,
        )
        print(json.dumps({
            "schema": "pi.g03-research-runner/v1", "execution": False,
            "artifact": str(target), "case_id": cell["case_id"], "status": artifact["status"],
            "authoritative": artifact["authoritative"], "authority_reason": artifact["authority_reason"],
            "artifact_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        }, sort_keys=True))
        return 0
    except (OSError, UnicodeError, json.JSONDecodeError, ResearchRunnerError, ValueError) as exc:
        print(f"g03-research-runner: {exc}", file=__import__("sys").stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
