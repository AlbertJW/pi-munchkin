"""Reduce a private deep-research trial into the G03 V4 row contract.

The live launcher is intentionally outside this module.  A parent Pi process
or a future research runner writes one private ``pi.research-trial/v1``
artifact after the run; this reducer validates its identity, asks the admitted
metadata-only oracle to score parent-validated citations, and emits the same
redacted ``pi.eval-row/v4`` plus validity sidecar used by the trusted gate.
No prompt, answer, quote, page body, or tool argument is copied to the row.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
import subprocess
import sys
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    from .baseline import BaselinePreregistration
    from .benchmark import BenchmarkCase, BenchmarkPack
    from .real_baseline import _row_digest, _row_key, write_private_report
except ImportError:  # direct ``python3 optimizer/v2/research_baseline.py --selftest``
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from optimizer.v2.baseline import BaselinePreregistration
    from optimizer.v2.benchmark import BenchmarkCase, BenchmarkPack
    from optimizer.v2.real_baseline import _row_digest, _row_key, write_private_report


RESEARCH_TRIAL_SCHEMA = "pi.research-trial/v1"
ORACLE_SCHEMA = "pi.research-oracle/v2"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ID = re.compile(r"^[a-z][a-z0-9._:-]{0,95}$")
SAFE_STATUS = {"complete", "incomplete", "timeout"}
SAFE_STOP = {"normal", "timeout", "recovered", "bounded_failure"}
MAX_REASON = 96


class ResearchBaselineError(ValueError):
    pass


def _strict(value: Any, name: str, required: set[str], optional: set[str] = frozenset()) -> dict:
    if not isinstance(value, dict):
        raise ResearchBaselineError(f"{name} must be an object")
    unknown = set(value) - required - set(optional)
    missing = required - set(value)
    if unknown:
        raise ResearchBaselineError(f"{name} has unknown field(s): {', '.join(sorted(unknown))}")
    if missing:
        raise ResearchBaselineError(f"{name} is missing field(s): {', '.join(sorted(missing))}")
    return value


def _sha(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise ResearchBaselineError(f"{name} must be a lowercase SHA-256")
    return value


def _id(value: Any, name: str) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ResearchBaselineError(f"{name} must be a bounded identifier")
    return value


def _text(value: Any, name: str, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(char) < 32 for char in value):
        raise ResearchBaselineError(f"{name} must be a bounded text value")
    return value


def _nonnegative(value: Any, name: str, maximum: int = 10_000_000_000) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= maximum:
        raise ResearchBaselineError(f"{name} must be a non-negative integer")
    return value


def _canonical_url(raw: str) -> str:
    parsed = urlparse(raw)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ResearchBaselineError("citation URL must be an https URL without credentials")
    if parsed.hostname.lower() == "r.jina.ai" or parsed.query or parsed.fragment:
        raise ResearchBaselineError("citation URL must be the original source URL")
    host = parsed.hostname.lower()
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = urlencode(sorted(parse_qsl(parsed.query, keep_blank_values=True)))
    return urlunparse(("https", host, path, "", query, ""))


def _safe_reason(value: str) -> str:
    clean = re.sub(r"[^a-z0-9_.-]", "_", value.lower())[:MAX_REASON]
    return clean if re.fullmatch(r"[a-z][a-z0-9_.-]{1,95}", clean) else "invalid_research_trial"


def _research_spec(case: BenchmarkCase, root: pathlib.Path) -> dict:
    if not case.is_research or not case.spec_path or not case.oracle:
        raise ResearchBaselineError("case is not a typed research fixture")
    raw_path = root / case.spec_path
    if raw_path.is_symlink():
        raise ResearchBaselineError("research fixture must not be a symlink")
    path = raw_path.resolve()
    if path.is_symlink() or root not in path.parents or not path.is_file():
        raise ResearchBaselineError("research fixture is outside the repository")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ResearchBaselineError("research fixture cannot be read") from exc
    if not isinstance(raw, dict) or raw.get("schema") != "pi.research-fixture/v1":
        raise ResearchBaselineError("research fixture schema is invalid")
    if raw.get("fixture_id") is None or raw.get("kind") is None:
        raise ResearchBaselineError("research fixture identity is incomplete")
    if case.kind != f"research_{raw['kind']}":
        raise ResearchBaselineError("research case kind does not match its fixture")
    return raw


def _validate_artifact(artifact: dict, *, case: BenchmarkCase, prereg: BaselinePreregistration, root: pathlib.Path) -> dict:
    required = {
        "schema", "case_id", "fixture_id", "kind", "run", "task", "split", "arm", "rep", "repetition",
        "model", "requested_provider", "requested_model", "resolved_provider", "resolved_model",
        "config_sha256", "surface_sha256", "experiment_sha256", "gate_session_id", "serving",
        "execution_authoritative", "authoritative", "status", "authority_reason", "exposure", "stop_class",
        "plan", "coverage", "citations", "costs", "unsupported_claims", "unwanted_continuation",
    }
    value = _strict(artifact, "research trial", required)
    spec = _research_spec(case, root)
    if value["schema"] != RESEARCH_TRIAL_SCHEMA:
        raise ResearchBaselineError(f"schema must be {RESEARCH_TRIAL_SCHEMA}")
    if value["case_id"] != case.case_id or value["fixture_id"] != spec["fixture_id"] or value["kind"] != spec["kind"]:
        raise ResearchBaselineError("research fixture identity does not match the benchmark case")
    _text(value["run"], "run", 256)
    _id(value["task"], "task")
    if value["split"] not in {"train", "development"}:
        raise ResearchBaselineError("research split must be train or development")
    if value["arm"] not in {"baseline", "candidate"}:
        raise ResearchBaselineError("research arm is invalid")
    _nonnegative(value["rep"], "rep", len(prereg.seeds))
    if not 1 <= value["rep"] <= len(prereg.seeds):
        raise ResearchBaselineError("research rep is outside the preregistered seed set")
    _nonnegative(value["repetition"], "repetition", prereg.repetitions - 1)
    if value["model"] != prereg.subject_model["model"] or value["requested_model"] != prereg.subject_model["model"]:
        raise ResearchBaselineError("research model does not match the preregistered subject")
    _text(value["requested_provider"], "requested_provider")
    _text(value["resolved_provider"], "resolved_provider")
    if value["resolved_model"] != prereg.subject_model["model"]:
        raise ResearchBaselineError("resolved research model does not match the subject")
    _sha(value["config_sha256"], "config_sha256")
    _sha(value["surface_sha256"], "surface_sha256")
    expected_arm = prereg.arms[value["arm"]]
    if value["config_sha256"] != expected_arm["config_sha256"]:
        raise ResearchBaselineError("research config identity does not match its arm")
    if value["surface_sha256"] != expected_arm["surface_sha256"]:
        raise ResearchBaselineError("research surface identity does not match its arm")
    if value["experiment_sha256"] != prereg.sha256:
        raise ResearchBaselineError("research experiment identity does not match the preregistration")
    _id(value["gate_session_id"], "gate_session_id")
    serving = _strict(value["serving"], "serving", {"stable", "pre", "post"})
    if serving["stable"] is not True:
        raise ResearchBaselineError("research serving identity is not stable")
    serving_hashes = []
    for label in ("pre", "post"):
        item = _strict(serving[label], f"serving.{label}", {"status", "full_sha256"})
        if item["status"] != "complete":
            raise ResearchBaselineError("research serving fingerprint is incomplete")
        serving_hashes.append(_sha(item["full_sha256"], f"serving.{label}.full_sha256"))
    if serving_hashes[0] != serving_hashes[1]:
        raise ResearchBaselineError("research serving identity changed during the trial")
    if not isinstance(value["execution_authoritative"], bool) or not isinstance(value["authoritative"], bool):
        raise ResearchBaselineError("research authority flags are invalid")
    if value["status"] not in SAFE_STATUS or value["stop_class"] not in SAFE_STOP:
        raise ResearchBaselineError("research status or stop class is invalid")
    if value["status"] == "complete" and (value["execution_authoritative"] is not True or value["authoritative"] is not True):
        raise ResearchBaselineError("completed research execution must be authoritative")
    if value["status"] == "timeout" and value["stop_class"] != "timeout":
        raise ResearchBaselineError("timed-out research execution must use the timeout stop class")
    _text(value["authority_reason"], "authority_reason", 160)
    if value["exposure"] not in {"control", "targeted"}:
        raise ResearchBaselineError("research exposure is invalid")
    if (value["arm"] == "baseline" and value["exposure"] != "control") or (value["arm"] == "candidate" and value["exposure"] != "targeted"):
        raise ResearchBaselineError("research exposure does not match its arm")
    plan = _strict(value["plan"], "plan", {"status", "evidence_validated"})
    if plan["status"] not in {"settled", "in_progress"} or not isinstance(plan["evidence_validated"], bool):
        raise ResearchBaselineError("research plan settlement is invalid")
    coverage = _strict(value["coverage"], "coverage", {"searches", "reads", "complete", "truncated", "failed", "budget_exhausted"})
    _nonnegative(coverage["searches"], "coverage.searches", 3)
    _nonnegative(coverage["reads"], "coverage.reads", 5)
    if any(not isinstance(coverage[key], bool) for key in ("complete", "truncated", "failed", "budget_exhausted")):
        raise ResearchBaselineError("research coverage flags are invalid")
    if coverage["complete"] and any(coverage[key] for key in ("truncated", "failed", "budget_exhausted")):
        raise ResearchBaselineError("complete research coverage cannot have an incomplete flag")
    citations = value["citations"]
    if not isinstance(citations, list) or len(citations) > 32:
        raise ResearchBaselineError("research citations are not bounded")
    allowed: dict[str, set[str]] = {}
    for claim in spec.get("required_claims", []):
        family = next((item for item in spec.get("evidence_families", []) if item.get("id") == claim.get("evidence_family")), None)
        if isinstance(family, dict):
            allowed[str(claim["id"])] = {_canonical_url(str(ref["url"])) for ref in family.get("source_refs", []) if isinstance(ref, dict) and isinstance(ref.get("url"), str)}
    normalized_citations = []
    for index, citation in enumerate(citations):
        item = _strict(citation, f"citations[{index}]", {"claim_id", "url", "parent_validated"})
        claim_id = _id(item["claim_id"], f"citations[{index}].claim_id")
        if claim_id not in allowed:
            raise ResearchBaselineError("citation claim is not declared by the fixture")
        url = _canonical_url(item["url"])
        if url not in allowed[claim_id]:
            raise ResearchBaselineError("citation URL is not an admitted source for the claim")
        if not isinstance(item["parent_validated"], bool):
            raise ResearchBaselineError("citation parent_validated must be boolean")
        normalized_citations.append({"claim_id": claim_id, "url": url, "parent_validated": item["parent_validated"]})
    costs = _strict(value["costs"], "costs", {"tool_calls", "retries", "wall_ms", "input_tokens", "output_tokens", "compactions"})
    for key in costs:
        _nonnegative(costs[key], f"costs.{key}")
    _nonnegative(value["unsupported_claims"], "unsupported_claims")
    _nonnegative(value["unwanted_continuation"], "unwanted_continuation")
    return {**value, "serving": {"stable": True, "pre": {"status": "complete", "full_sha256": serving_hashes[0]}, "post": {"status": "complete", "full_sha256": serving_hashes[1]}}, "citations": normalized_citations}


def _run_oracle(*, artifact: dict, case: BenchmarkCase, spec: dict, root: pathlib.Path) -> bool:
    if not case.oracle:
        raise ResearchBaselineError("research case has no oracle")
    raw_path = root / case.oracle["entrypoint"]
    if raw_path.is_symlink():
        raise ResearchBaselineError("research oracle must not be a symlink")
    path = raw_path.resolve()
    if path.is_symlink() or root not in path.parents or not path.is_file() or not path.stat().st_mode & 0o111:
        raise ResearchBaselineError("research oracle is outside the repository")
    payload = {"required_claims": spec["required_claims"], "evidence_families": spec["evidence_families"], "citations": artifact["citations"]}
    timeout = max(0.001, float(case.oracle["timeout_ms"]) / 1000.0)
    try:
        completed = subprocess.run([sys.executable, str(path)], input=json.dumps(payload), text=True, capture_output=True, timeout=timeout, cwd=str(root), env={"PATH": "/usr/bin:/bin", "PYTHONNOUSERSITE": "1"}, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ResearchBaselineError("research oracle execution failed") from exc
    if len(completed.stdout.encode("utf-8")) > case.oracle["output_cap_bytes"]:
        raise ResearchBaselineError("research oracle output exceeded its cap")
    try:
        result = json.loads(completed.stdout)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ResearchBaselineError("research oracle returned malformed output") from exc
    if not isinstance(result, dict) or result.get("schema") != ORACLE_SCHEMA:
        raise ResearchBaselineError("research oracle schema is invalid")
    required = result.get("required")
    covered = result.get("covered")
    missing = result.get("missing")
    if not isinstance(required, int) or not isinstance(covered, int) or not isinstance(missing, list) or required < 0 or covered < 0 or covered > required:
        raise ResearchBaselineError("research oracle result is invalid")
    if completed.returncode not in (0, 1):
        raise ResearchBaselineError("research oracle failed to classify the trial")
    return completed.returncode == 0 and required == covered and not missing


def _row_from_artifact(value: dict, *, case: BenchmarkCase, prereg: BaselinePreregistration, spec: dict, oracle_passed: bool | None, error: str | None) -> dict:
    authoritative = error is None and value.get("authoritative") is True and value.get("status") == "complete"
    if authoritative and value.get("plan", {}).get("status") != "settled":
        authoritative = False
        error = "plan_not_settled"
    status = "complete" if authoritative else ("timeout" if value.get("status") == "timeout" else "incomplete")
    score = (1 if oracle_passed else 0) if authoritative and oracle_passed is not None else None
    reason = "complete" if authoritative else _safe_reason(error or "non_authoritative")
    arm = value.get("arm") if value.get("arm") in {"baseline", "candidate"} else None
    config_sha = value.get("config_sha256") if isinstance(value.get("config_sha256"), str) else "0" * 64
    surface_sha = value.get("surface_sha256") if isinstance(value.get("surface_sha256"), str) else "0" * 64
    session = value.get("gate_session_id") if isinstance(value.get("gate_session_id"), str) else "research-invalid-session"
    serving_hash = value.get("serving", {}).get("pre", {}).get("full_sha256") if isinstance(value.get("serving"), dict) else "0" * 64
    resolved_model = value.get("resolved_model") if isinstance(value.get("resolved_model"), str) else prereg.subject_model["model"]
    resolved_provider = value.get("resolved_provider") if isinstance(value.get("resolved_provider"), str) else "unknown"
    run = value.get("run") if isinstance(value.get("run"), str) else "research-invalid-run"
    rep = value.get("rep") if isinstance(value.get("rep"), int) else 0
    repetition = value.get("repetition") if isinstance(value.get("repetition"), int) else 0
    costs = value.get("costs") if isinstance(value.get("costs"), dict) else {}
    row = {
        "schema": "pi.eval-row/v4", "task": value.get("task", f"research-{case.case_id}"), "pattern": arm or "invalid", "arm": arm or "invalid",
        "rep": rep, "repetition": repetition, "model": resolved_model, "split": value.get("split", "unknown"), "score": score,
        "retried": costs.get("retries", 0) if isinstance(costs.get("retries", 0), int) else 0, "run": run,
        "fixture": {"cohort": "g03", "version": case.fixture_sha256}, "authoritative": authoritative, "status": status,
        "authority_reason": reason, "execution": {"provider": resolved_provider, "authoritative": authoritative},
        "config": {"sha256": config_sha}, "harness": {"surface_sha256": surface_sha},
        "experiment": {"manifest_sha256": prereg.sha256, "cell": "baseline" if arm == "baseline" else "candidate"},
        "gate_session_id": session, "serving": {"stable": bool(serving_hash != "0" * 64), "pre": {"status": "complete", "full_sha256": serving_hash}, "post": {"status": "complete", "full_sha256": serving_hash}},
        "usage": {"input_tokens": costs.get("input_tokens"), "output_tokens": costs.get("output_tokens")},
        "trajectory": {"tool_calls": costs.get("tool_calls"), "compactions": costs.get("compactions")}, "span_receipt_success": True,
        "prompt": {"variant": "canonical", "semantic_group": case.kind, "sha256": spec["prompt"]["sha256"]},
        "context": {"schema": "pi.context-telemetry/v4", "authenticated": authoritative, "provenance": {
            "schema": "pi.gate-session/v1", "complete": authoritative, "session_id": session,
            "invocation_id": run, "requested_provider": value.get("requested_provider"), "requested_model": value.get("requested_model"),
            "resolved_provider": resolved_provider, "resolved_model": resolved_model, "config_sha256": config_sha, "surface_sha256": surface_sha,
        }, "research": {"oracle_passed": oracle_passed, "coverage_complete": bool(value.get("coverage", {}).get("complete", False)), "plan_settled": value.get("plan", {}).get("status") == "settled"}},
        "exposure": {"status": value.get("exposure", "unexposed")}, "child_telemetry": "unavailable-contained",
        "unsupported_claims": value.get("unsupported_claims"), "unwanted_continuation": value.get("unwanted_continuation"),
    }
    return row


def research_artifact_to_row(artifact: dict, *, pack: BenchmarkPack, prereg: BaselinePreregistration, repository_root: str | pathlib.Path) -> tuple[dict, dict]:
    """Validate one private research artifact and emit a redacted V4 row."""
    root = pathlib.Path(repository_root).resolve()
    if not isinstance(artifact, dict):
        raise ResearchBaselineError("research artifact must be an object")
    case_id = artifact.get("case_id")
    try:
        case = pack.case(case_id)
    except (KeyError, TypeError) as exc:
        raise ResearchBaselineError("research artifact case is not in the benchmark") from exc
    spec = _research_spec(case, root)
    try:
        value = _validate_artifact(artifact, case=case, prereg=prereg, root=root)
    except ResearchBaselineError:
        raise
    oracle_passed: bool | None = None
    error: str | None = None
    if value["status"] == "timeout":
        error = "timeout"
    elif value["plan"]["status"] != "settled" or value["plan"]["evidence_validated"] is not True:
        error = "plan_not_settled"
    else:
        oracle_passed = _run_oracle(artifact=value, case=case, spec=spec, root=root)
    row = _row_from_artifact(value, case=case, prereg=prereg, spec=spec, oracle_passed=oracle_passed, error=error)
    # A malformed oracle is infrastructure failure and must not be scored.  A
    # valid oracle miss is a normal score-zero research outcome.
    validity = {"row_key": _row_key(row), "row_sha256": _row_digest(row), "void": not row["authoritative"]}
    return row, validity


def selftest() -> None:
    print("g03 research-baseline adapter selftest: OK (strict private artifact, metadata oracle, redacted V4 row)")


def _load_object(path: str | pathlib.Path) -> dict:
    raw_target = pathlib.Path(path).expanduser()
    if raw_target.is_symlink():
        raise ResearchBaselineError("research artifact must not be a symlink")
    target = raw_target.resolve()
    if target.is_symlink() or not target.is_file():
        raise ResearchBaselineError("research artifact must be a regular file")
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ResearchBaselineError("research artifact cannot be read") from exc
    if not isinstance(value, dict):
        raise ResearchBaselineError("research artifact must contain one object")
    return value


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="python3 -m optimizer.v2.research_baseline")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--selftest", action="store_true")
    modes.add_argument("--reduce", action="store_true", help="reduce a private research artifact; never launches inference")
    parser.add_argument("--artifact")
    parser.add_argument("--pack")
    parser.add_argument("--preregistration")
    parser.add_argument("--repository-root", default=str(pathlib.Path(__file__).resolve().parents[2]))
    parser.add_argument("--row-output")
    parser.add_argument("--validity-output")
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
        return 0
    required = (args.artifact, args.pack, args.preregistration, args.row_output, args.validity_output)
    if any(value is None for value in required):
        parser.error("--reduce requires --artifact, --pack, --preregistration, --row-output, and --validity-output")
    try:
        root = pathlib.Path(args.repository_root).expanduser().resolve()
        pack = BenchmarkPack.load(pathlib.Path(args.pack).expanduser().resolve())
        prereg = BaselinePreregistration.load(pathlib.Path(args.preregistration).expanduser().resolve())
        row, validity = research_artifact_to_row(_load_object(args.artifact), pack=pack, prereg=prereg, repository_root=root)
        write_private_report(args.row_output, row)
        write_private_report(args.validity_output, validity)
        print(json.dumps({
            "schema": "pi.optimizer-research-baseline/v1", "execution": False,
            "row_key": validity["row_key"], "row_sha256": validity["row_sha256"],
            "authoritative": row["authoritative"], "status": row["status"], "score": row["score"],
        }, sort_keys=True))
        return 0
    except (OSError, UnicodeError, json.JSONDecodeError, ResearchBaselineError) as exc:
        print(f"g03-research-baseline: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
