from __future__ import annotations

"""Offline ingestion of a real Pi-gate baseline.

This module never launches Pi or a model.  It turns freshly produced V4 gate
rows and their validity sidecar into a safe, reconstructable report.  A row
that is incomplete, void, stale, or mismatched is retained as a bounded
classification; it is never silently dropped or converted into a score.
"""

import hashlib
import json
import os
import pathlib
import re
import tempfile
from typing import Any, Iterable

try:
    from .baseline import BaselineError, BaselinePreregistration, prepare_baseline
    from .benchmark import BenchmarkPack
except ImportError:  # direct `python optimizer/v2/real_baseline.py --selftest`
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from optimizer.v2.baseline import BaselineError, BaselinePreregistration, prepare_baseline
    from optimizer.v2.benchmark import BenchmarkPack


REAL_REPORT_SCHEMA = "pi.optimizer-real-baseline-report/v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ROW_KEY_FIELDS = ("run", "model", "split", "task")
EXPOSURES = {"control", "targeted", "engaged_only", "unexposed"}
INVALID_REASON = re.compile(r"^[a-z][a-z0-9_.-]{1,63}$")


class RealBaselineError(BaselineError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _row_digest(row: dict) -> str:
    return _digest(row)


def _jsonl_digest(records: Iterable[dict]) -> str:
    """Digest the semantic JSONL records used by an ingestion operation.

    The raw files stay private, while this stable digest lets a reviewer prove
    that a later reconstruction used the same ordered row and sidecar records
    without depending on whitespace or filesystem paths.
    """

    digest = hashlib.sha256()
    for record in records:
        digest.update(_canonical(record))
        digest.update(b"\n")
    return digest.hexdigest()


def _row_key(row: dict) -> str:
    variant = ((row.get("prompt") or {}).get("variant")) or "canonical"
    variant = re.sub(r"[^A-Za-z0-9._-]", "-", str(variant))
    return ":".join(str(row.get(field)) for field in ROW_KEY_FIELDS) + f":{row.get('pattern') or row.get('arm')}:{row.get('rep')}:{variant}"


def _bounded_reason(value: str) -> str:
    value = re.sub(r"[^a-z0-9_.-]", "_", value.lower())[:64]
    return value if INVALID_REASON.fullmatch(value) else "invalid_row"


def _nonnegative(value: Any) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 10_000_000_000:
        return value
    return None


def _safe_costs(row: dict) -> dict[str, int | None]:
    trajectory = row.get("trajectory") if isinstance(row.get("trajectory"), dict) else {}
    usage = row.get("usage") if isinstance(row.get("usage"), dict) else {}
    return {
        "tool_calls": _nonnegative(trajectory.get("tool_calls")),
        "retries": _nonnegative(row.get("retried")),
        "wall_ms": _nonnegative(row.get("wall_ms")),
        "input_tokens": _nonnegative(usage.get("input_tokens") if usage else row.get("input_tokens")),
        "output_tokens": _nonnegative(usage.get("output_tokens") if usage else row.get("output_tokens")),
        "compactions": _nonnegative(trajectory.get("compactions")),
    }


def _resolved_model(value: Any, expected: dict) -> dict:
    if not isinstance(value, dict) or set(value) != {"provider", "model"}:
        raise RealBaselineError("resolved_model must contain provider and model")
    if any(not isinstance(value[key], str) or not value[key] or len(value[key]) > 256 for key in value):
        raise RealBaselineError("resolved_model fields are invalid")
    if value["model"] != expected["model"]:
        raise RealBaselineError("resolved model does not match the preregistered subject")
    return {"provider": value["provider"], "model": value["model"]}


def _validate_case_tasks(pack: BenchmarkPack, case_tasks: dict[str, str]) -> dict[str, str]:
    expected = {case.case_id for split in ("train", "development") for case in pack.splits[split]}
    if not isinstance(case_tasks, dict) or set(case_tasks) != expected:
        raise RealBaselineError("case_tasks must map every train/development case exactly once")
    if any(not isinstance(task, str) or not task or len(task) > 256 for task in case_tasks.values()):
        raise RealBaselineError("case_tasks values must be bounded strings")
    if len(set(case_tasks.values())) != len(case_tasks):
        raise RealBaselineError("case_tasks must be globally unique")
    return {task: case_id for case_id, task in case_tasks.items()}


def _case_tasks_digest(case_tasks: dict[str, str]) -> str:
    """Digest the exact case→real-gate task binding used for ingestion."""

    return _digest(case_tasks)


def load_case_tasks(value: str | pathlib.Path) -> dict[str, str]:
    """Load a task map without following a symlink or accepting raw payload files.

    The map is part of the reconstruction boundary.  A caller may still pass
    an inline JSON object for tests, but a filesystem-backed map must be a
    regular file so an operator cannot silently substitute a moved binding.
    """

    raw = str(value)
    candidate = pathlib.Path(raw).expanduser()
    try:
        is_file_candidate = candidate.exists() or candidate.is_symlink()
    except OSError:
        is_file_candidate = False
    if is_file_candidate:
        if candidate.is_symlink() or not candidate.is_file():
            raise RealBaselineError("case_tasks must be a regular non-symlink file")
        try:
            parsed = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RealBaselineError("case_tasks file is malformed") from exc
    else:
        try:
            parsed = json.loads(raw)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RealBaselineError("case_tasks must be a JSON object or readable file") from exc
    if not isinstance(parsed, dict):
        raise RealBaselineError("case_tasks must contain one JSON object")
    return parsed


def _normalized_repetition(row: dict, prereg: BaselinePreregistration) -> int | None:
    """Return the preregistered repetition represented by a V4 gate row.

    ``real_gate.sh`` predates the V2 baseline contract and writes its one-based
    seed ordinal into both ``rep`` and ``repetition``.  The V2 bridge already
    interprets ``rep`` as the seed ordinal; for the one-repetition G03 pilot,
    the duplicate value in ``repetition`` therefore normalizes to repetition
    zero.  Future multi-repetition adapters must write a zero-based
    ``repetition`` explicitly and are rejected if it falls outside the
    preregistration.
    """
    value = row.get("repetition", 0)
    if not isinstance(value, int) or isinstance(value, bool):
        return None
    rep = row.get("rep")
    if prereg.repetitions == 1 and value == rep:
        return 0
    return value if 0 <= value < prereg.repetitions else None


def _split_matches_legacy_gate(row_split: Any, expected_split: str | None) -> bool:
    """Accept the legacy gate's bounded ``val`` alias for V2 split identity.

    ``real_gate.sh`` predates the V2 benchmark registry and writes ``val`` for
    every canonical cell.  The case-to-task map and the immutable pack still
    determine whether that cell belongs to train or development; ``val`` is
    therefore only an input spelling, never a third split or a way to bypass
    pack membership.  Any other mismatch remains non-authoritative.
    """
    if expected_split is None:
        return False
    return row_split == expected_split or (row_split == "val" and expected_split in {"train", "development"})


def _sidecar_map(validity_records: Iterable[dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for value in validity_records:
        if not isinstance(value, dict):
            raise RealBaselineError("validity sidecar contains a malformed record")
        key = value.get("row_key")
        if not isinstance(key, str) or not key or key in result:
            raise RealBaselineError("validity sidecar contains duplicate or missing row keys")
        result[key] = value
    return result


def _identity_errors(
    row: dict,
    *,
    case_id: str | None,
    expected_split: str | None,
    arm_config: dict[str, dict],
    prereg: BaselinePreregistration,
    resolved: dict,
    run_id: str,
    validity: dict | None,
) -> list[str]:
    errors: list[str] = []
    if row.get("schema") != "pi.eval-row/v4":
        errors.append("schema")
    if row.get("model") != resolved["model"]:
        errors.append("model_binding")
    execution = row.get("execution") if isinstance(row.get("execution"), dict) else {}
    if execution.get("provider") != resolved["provider"]:
        errors.append("provider_binding")
    if execution.get("authoritative") is not True:
        errors.append("execution_authority")
    harness = row.get("harness") if isinstance(row.get("harness"), dict) else {}
    experiment = row.get("experiment") if isinstance(row.get("experiment"), dict) else {}
    arm = row.get("arm") or row.get("pattern")
    if arm not in arm_config:
        errors.append("arm_binding")
    else:
        if (row.get("config") or {}).get("sha256") != arm_config[arm]["config_sha256"]:
            errors.append("config_binding")
        if harness.get("surface_sha256") != arm_config[arm]["surface_sha256"]:
            errors.append("surface_binding")
    if experiment.get("manifest_sha256") != prereg.sha256:
        errors.append("preregistration_binding")
    if case_id is None:
        errors.append("unknown_task")
    elif not _split_matches_legacy_gate(row.get("split"), expected_split):
        errors.append("split_binding")
    if row.get("run") != run_id:
        errors.append("run_binding")
    session = row.get("gate_session_id")
    if not isinstance(session, str) or not session:
        errors.append("gate_session")
    serving = row.get("serving") if isinstance(row.get("serving"), dict) else {}
    pre = serving.get("pre") if isinstance(serving.get("pre"), dict) else {}
    post = serving.get("post") if isinstance(serving.get("post"), dict) else {}
    if serving.get("stable") is not True or pre.get("status") != "complete" or post.get("status") != "complete" or pre.get("full_sha256") != post.get("full_sha256") or not HEX64.fullmatch(str(pre.get("full_sha256", ""))):
        errors.append("serving_identity")
    context = row.get("context") if isinstance(row.get("context"), dict) else {}
    if context.get("schema") != "pi.context-telemetry/v4" or context.get("authenticated") is not True:
        errors.append("telemetry_authentication")
    provenance = context.get("provenance") if isinstance(context.get("provenance"), dict) else {}
    if provenance.get("complete") is not True:
        errors.append("provenance_incomplete")
    if provenance.get("session_id") != session:
        errors.append("provenance_session")
    if provenance.get("invocation_id") != run_id:
        errors.append("provenance_run")
    if provenance.get("requested_provider") != prereg.subject_model["provider"]:
        errors.append("provenance_requested_provider")
    if provenance.get("requested_model") != prereg.subject_model["model"]:
        errors.append("provenance_requested_model")
    if provenance.get("resolved_provider") != resolved["provider"] or provenance.get("resolved_model") != resolved["model"]:
        errors.append("provenance_resolved_model")
    if arm in arm_config:
        if provenance.get("config_sha256") != arm_config[arm]["config_sha256"]:
            errors.append("provenance_config")
        if provenance.get("surface_sha256") != arm_config[arm]["surface_sha256"]:
            errors.append("provenance_surface")
    if (row.get("exposure") or {}).get("status") not in EXPOSURES:
        errors.append("exposure")
    elif arm in {"baseline", "base"} and (row.get("exposure") or {}).get("status") != "control":
        errors.append("baseline_exposure")
    elif arm in {"candidate", "cand"} and (row.get("exposure") or {}).get("status") != "targeted":
        errors.append("candidate_exposure")
    if row.get("score") not in (0, 1):
        errors.append("score")
    if row.get("authoritative") is not True or row.get("status") != "complete":
        errors.append("row_authority")
    if validity is None or validity.get("row_sha256") != _row_digest(row) or validity.get("void") is not False:
        errors.append("trial_validity")
    return errors


def _safe_trial(row: dict, *, case_id: str | None, split: str, errors: list[str], timeout: bool, arm: str | None) -> dict:
    reason = _bounded_reason(errors[0] if errors else "") if errors else None
    outcome = "timeout" if timeout else ("success" if row.get("score") == 1 else "failure")
    if errors:
        outcome = "timeout" if timeout else "invalid"
    score = row.get("score") if not errors and row.get("score") in (0, 1) else None
    session = row.get("gate_session_id")
    return {
        "case_id": case_id,
        "split": split,
        "arm": arm,
        "seed": row.get("rep"),
        "repetition": row.get("repetition", 0),
        "status": "timeout" if timeout else ("invalid" if errors else "completed"),
        "outcome": outcome,
        "score": score,
        "invalid_reason": reason,
        "gate_session_sha256": _digest(session) if isinstance(session, str) and session else None,
        "costs": _safe_costs(row),
        "unsupported_claims": _nonnegative(row.get("unsupported_claims")),
        "unwanted_continuation": _nonnegative(row.get("unwanted_continuation")),
        "child_telemetry": "unavailable-contained",
        "authority": "authoritative" if not errors else "non_authoritative",
    }


def ingest_gate_baseline(
    pack: BenchmarkPack,
    prereg: BaselinePreregistration,
    repository_root: str | pathlib.Path,
    rows: list[dict],
    validity_records: list[dict],
    *,
    case_tasks: dict[str, str],
    run_id: str,
    resolved_model: dict,
) -> dict:
    """Build a redacted real-baseline report from fresh gate artifacts.

    The expected paired grid is the ten train/development cases × registered
    seeds × repetitions × two arms. Missing cells are represented explicitly as
    exclusions, so a partial/timeout run cannot masquerade as a clean baseline.
    """
    if not isinstance(run_id, str) or not run_id or len(run_id) > 256:
        raise RealBaselineError("run_id is invalid")
    prepared = prepare_baseline(pack, prereg, repository_root)
    reverse_tasks = _validate_case_tasks(pack, case_tasks)
    case_tasks_sha256 = _case_tasks_digest(case_tasks)
    resolved = _resolved_model(resolved_model, prereg.subject_model)
    sidecar = _sidecar_map(validity_records)
    arm_config = {
        "base": prereg.arms["baseline"], "baseline": prereg.arms["baseline"],
        "cand": prereg.arms["candidate"], "candidate": prereg.arms["candidate"],
    }
    expected: set[tuple[str, int, int, str]] = {
        (case.case_id, seed, repetition, arm)
        for split in ("train", "development")
        for case in pack.splits[split]
        for seed in prereg.seeds
        for repetition in range(prereg.repetitions)
        for arm in ("baseline", "candidate")
    }
    trials: list[dict] = []
    seen: set[tuple[str, int, int, str]] = set()
    serving_ids: set[str] = set()
    sessions: set[str] = set()
    row_keys: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise RealBaselineError("gate rows contain a malformed record")
        task = row.get("task")
        case_id = reverse_tasks.get(task) if isinstance(task, str) else None
        case = pack.case(case_id) if case_id is not None else None
        arm = row.get("arm") or row.get("pattern")
        canonical_arm = "baseline" if arm in {"base", "baseline"} else "candidate" if arm in {"cand", "candidate"} else None
        rep = row.get("rep")
        seed = prereg.seeds[rep - 1] if isinstance(rep, int) and not isinstance(rep, bool) and 1 <= rep <= len(prereg.seeds) else None
        repetition = _normalized_repetition(row, prereg)
        key = (case_id or "", seed if isinstance(seed, int) else -1, repetition if isinstance(repetition, int) else -1, canonical_arm or "")
        if key in seen:
            raise RealBaselineError("gate rows contain a duplicate trial cell")
        seen.add(key)
        serving = row.get("serving") if isinstance(row.get("serving"), dict) else {}
        pre = serving.get("pre") if isinstance(serving.get("pre"), dict) else {}
        if HEX64.fullmatch(str(pre.get("full_sha256", ""))):
            serving_ids.add(str(pre["full_sha256"]))
        validity = sidecar.get(_row_key(row))
        row_key = _row_key(row)
        if row_key in row_keys:
            raise RealBaselineError("gate rows contain duplicate row keys")
        row_keys.add(row_key)
        session = row.get("gate_session_id")
        if isinstance(session, str) and session:
            if session in sessions:
                raise RealBaselineError("gate rows contain duplicate parent sessions")
            sessions.add(session)
        expected_split = None if case is None else next((split for split in ("train", "development", "test") if case in pack.splits[split]), None)
        errors = _identity_errors(row, case_id=case_id, expected_split=expected_split, arm_config=arm_config, prereg=prereg, resolved=resolved, run_id=run_id, validity=validity)
        if case is None or key not in expected:
            errors.append("unexpected_cell")
        timeout = any("timeout" in str(value).lower() for value in (row.get("status"), row.get("authority_reason"), row.get("outcome")))
        trial = _safe_trial(row, case_id=case_id, split=("test" if case is not None and case in pack.splits["test"] else "unknown" if case is None else next(split for split in ("train", "development") if case in pack.splits[split])), errors=errors, timeout=timeout, arm=canonical_arm)
        trial["seed"] = seed
        trial["repetition"] = repetition
        trials.append(trial)
    if row_keys != set(sidecar):
        raise RealBaselineError("trial-validity sidecar has missing or extra row keys")
    for case_id, seed, repetition, arm in sorted(expected - seen):
        split = next(split for split in ("train", "development") if any(case.case_id == case_id for case in pack.splits[split]))
        trials.append({
            "case_id": case_id, "split": split, "arm": arm, "seed": seed, "repetition": repetition,
            "status": "excluded", "outcome": "invalid", "score": None,
            "invalid_reason": "not_observed", "gate_session_sha256": None,
            "costs": {key: None for key in ("tool_calls", "retries", "wall_ms", "input_tokens", "output_tokens", "compactions")},
            "unsupported_claims": None, "unwanted_continuation": None,
            "child_telemetry": "unavailable-contained", "authority": "not_observed",
        })
    if len(serving_ids) > 1:
        for trial in trials:
            if trial["status"] == "completed":
                trial["status"] = "invalid"; trial["outcome"] = "invalid"; trial["score"] = None; trial["invalid_reason"] = "serving_identity"
    authoritative = [trial for trial in trials if trial["status"] == "completed"]
    complete = len(trials) == len(expected) and len(authoritative) == len(expected) and len(serving_ids) == 1
    by_arm: dict[str, list[dict]] = {"baseline": [], "candidate": []}
    for trial in trials:
        if trial["arm"] in by_arm:
            by_arm[trial["arm"]].append(trial)
    def guard_total(values: list[dict], field: str) -> int | None:
        """Sum a guard only when every authoritative value is observable."""

        completed = [value for value in values if value["status"] == "completed"]
        observed = [value.get(field) for value in completed]
        if not completed or any(not isinstance(item, int) or isinstance(item, bool) or item < 0 for item in observed):
            return None
        return sum(observed)

    def summary(arm: str) -> dict:
        values = by_arm[arm]
        completed = [value for value in values if value["status"] == "completed"]
        return {
            "attempted": len(values), "completed": len(completed),
            "successes": sum(value["score"] == 1 for value in completed),
            "primary_score": (sum(value["score"] == 1 for value in completed) / len(completed)) if completed else None,
            "invalid_trials": sum(value["status"] == "invalid" for value in values),
            "timeouts": sum(value["status"] == "timeout" for value in values),
            "exclusions": sum(value["status"] == "excluded" for value in values),
            "unsupported_claims": guard_total(values, "unsupported_claims") if len(completed) == len(values) else None,
            "unwanted_continuation": guard_total(values, "unwanted_continuation") if len(completed) == len(values) else None,
            "child_telemetry": "unavailable-contained",
        }
    test_exclusions = [{"case_id": case.case_id, "split": "test", "status": "excluded", "reason": "opaque_test_quarantined"} for case in pack.splits["test"]]
    case_coverage = list(test_exclusions)
    for split in ("train", "development"):
        for case in pack.splits[split]:
            case_trials = [trial for trial in trials if trial["case_id"] == case.case_id]
            expected_for_case = len(prereg.seeds) * prereg.repetitions * 2
            completed_for_case = sum(trial["status"] == "completed" for trial in case_trials)
            case_coverage.append({
                "case_id": case.case_id,
                "split": split,
                "status": "complete" if completed_for_case == expected_for_case else "incomplete",
                "attempted": len(case_trials),
                "completed": completed_for_case,
                "reason": None if completed_for_case == expected_for_case else "missing_or_non_authoritative_cells",
            })
    scores = [trial["score"] for trial in authoritative if trial["score"] in (0, 1)]
    if not complete:
        decision_status = "inconclusive"
        decision_reason = "incomplete_or_non_authoritative_cells"
    elif scores and all(score == 1 for score in scores):
        decision_status = "inconclusive"
        decision_reason = "ceiling"
    elif scores and all(score == 0 for score in scores):
        decision_status = "inconclusive"
        decision_reason = "floor"
    else:
        decision_status = "informative"
        decision_reason = "complete-authoritative-paired-grid"
    report = {
        "schema": REAL_REPORT_SCHEMA,
        "evidence_class": "model-quality-baseline" if complete else "incomplete-model-quality-baseline",
        "model_quality_evidence": complete,
        "protocol_qualification": False,
        "prepared": prepared,
        "preregistration_sha256": prereg.sha256,
        "benchmark_pack_sha256": pack.sha256,
        "case_tasks_sha256": case_tasks_sha256,
        "run_id": run_id,
        "run_id_sha256": _digest(run_id),
        "requested_model": prereg.subject_model,
        "resolved_model": resolved,
        "arms": {name: {"label": value["label"], "config_sha256": value["config_sha256"], "surface_sha256": value["surface_sha256"]} for name, value in prereg.arms.items()},
        "serving_identity_sha256": sorted(serving_ids),
        "case_coverage": case_coverage,
        "primary_metric": prereg.primary_metric,
        "hard_guards": {
            "unsupported_claims": guard_total(trials, "unsupported_claims") if complete else None,
            "unwanted_continuation": guard_total(trials, "unwanted_continuation") if complete else None,
            "invalid_or_non_authoritative": sum(trial["status"] != "completed" for trial in trials),
        },
        "cohorts": {"subject": summary("baseline"), "candidate": summary("candidate"), "guards": [{"model": model, "status": "not-declared"} for model in prereg.guard_models]},
        "trials": sorted(trials, key=lambda value: (str(value["case_id"]), str(value["arm"]), str(value["seed"]), str(value["repetition"]))),
        "trial_count": len(trials),
        "external_references": [], "reference_pooling": "forbidden",
        "decision": {"status": decision_status, "reason": decision_reason, "statistical_power": "not-established"},
        "reconstruction": {
            "pack_path": prereg.pack_path,
            "preregistration_sha256": prereg.sha256,
            "benchmark_pack_sha256": pack.sha256,
            "case_tasks_sha256": case_tasks_sha256,
            "run_id": run_id,
            "validity_sidecar_required": True,
            "raw_payloads_in_report": False,
            "rerun_inference_required": False,
            "input_artifacts": {
                "rows": {
                    "schema": "pi.eval-row/v4",
                    "record_count": len(rows),
                    "canonical_sha256": _jsonl_digest(rows),
                },
                "validity": {
                    "schema": "pi.trial-validity-sidecar/v1",
                    "record_count": len(validity_records),
                    "canonical_sha256": _jsonl_digest(validity_records),
                },
            },
        },
        "human_review_required": True, "adoption_authorized": False,
    }
    report["report_sha256"] = _digest(report)
    return report


def validate_real_report(report: dict, pack: BenchmarkPack, prereg: BaselinePreregistration) -> None:
    if not isinstance(report, dict) or report.get("schema") != REAL_REPORT_SCHEMA:
        raise RealBaselineError("real baseline report schema is invalid")
    if report.get("preregistration_sha256") != prereg.sha256 or report.get("benchmark_pack_sha256") != pack.sha256:
        raise RealBaselineError("real baseline identity is not bound")
    case_tasks_sha256 = report.get("case_tasks_sha256")
    if not isinstance(case_tasks_sha256, str) or not HEX64.fullmatch(case_tasks_sha256):
        raise RealBaselineError("real baseline case-task binding digest is missing")
    run_id = report.get("run_id")
    if not isinstance(run_id, str) or not run_id or len(run_id) > 256:
        raise RealBaselineError("real baseline run identity is missing")
    if report.get("run_id_sha256") != _digest(run_id):
        raise RealBaselineError("real baseline run identity digest is inconsistent")
    reconstruction = report.get("reconstruction") if isinstance(report.get("reconstruction"), dict) else {}
    if reconstruction.get("case_tasks_sha256") != case_tasks_sha256 or reconstruction.get("run_id") != run_id:
        raise RealBaselineError("real baseline reconstruction task-map digest is inconsistent")
    input_artifacts = reconstruction.get("input_artifacts")
    if not isinstance(input_artifacts, dict) or set(input_artifacts) != {"rows", "validity"}:
        raise RealBaselineError("real baseline input receipts are missing")
    expected_input_schemas = {
        "rows": "pi.eval-row/v4",
        "validity": "pi.trial-validity-sidecar/v1",
    }
    for name, expected_schema in expected_input_schemas.items():
        receipt = input_artifacts.get(name)
        if not isinstance(receipt, dict) or set(receipt) != {"schema", "record_count", "canonical_sha256"}:
            raise RealBaselineError(f"real baseline {name} input receipt is malformed")
        if receipt.get("schema") != expected_schema:
            raise RealBaselineError(f"real baseline {name} input receipt schema is invalid")
        if not isinstance(receipt.get("record_count"), int) or isinstance(receipt.get("record_count"), bool) or receipt["record_count"] < 0:
            raise RealBaselineError(f"real baseline {name} input receipt count is invalid")
        if not isinstance(receipt.get("canonical_sha256"), str) or not HEX64.fullmatch(receipt["canonical_sha256"]):
            raise RealBaselineError(f"real baseline {name} input receipt digest is invalid")
    report_without_hash = dict(report)
    report_digest = report_without_hash.pop("report_sha256", None)
    if not isinstance(report_digest, str) or report_digest != _digest(report_without_hash):
        raise RealBaselineError("real baseline report digest is invalid")
    decision = report.get("decision") if isinstance(report.get("decision"), dict) else {}
    if decision.get("status") not in {"informative", "inconclusive"}:
        raise RealBaselineError("real baseline decision status is invalid")
    if decision.get("status") == "informative" and report.get("model_quality_evidence") is not True:
        raise RealBaselineError("informative real baseline lacks quality evidence")
    if decision.get("reason") in {"ceiling", "floor"} and decision.get("status") != "inconclusive":
        raise RealBaselineError("ceiling/floor baseline cannot be informative")
    trials = report.get("trials")
    if not isinstance(trials, list) or report.get("trial_count") != len(trials):
        raise RealBaselineError("real baseline trial list is malformed")
    complete = bool(trials) and all(isinstance(trial, dict) and trial.get("status") == "completed" for trial in trials)
    if report.get("model_quality_evidence") is not complete:
        raise RealBaselineError("real baseline quality classification is inconsistent")
    for trial in trials:
        if not isinstance(trial, dict) or trial.get("child_telemetry") != "unavailable-contained":
            raise RealBaselineError("real baseline trial is malformed")
        if trial.get("status") not in {"completed", "invalid", "timeout", "excluded"}:
            raise RealBaselineError("real baseline trial status is invalid")
        if trial.get("status") == "completed" and trial.get("score") not in (0, 1):
            raise RealBaselineError("completed trial has no binary score")
        if trial.get("status") != "completed" and not isinstance(trial.get("invalid_reason"), str):
            raise RealBaselineError("non-completed trial needs a bounded reason")
    coverage = report.get("case_coverage")
    if not isinstance(coverage, list) or not any(item.get("case_id") == "research-multipart" and item.get("reason") == "opaque_test_quarantined" for item in coverage if isinstance(item, dict)):
        raise RealBaselineError("opaque test exclusions are not explicit")
    encoded = json.dumps(report, sort_keys=True, separators=(",", ":"))
    if any(token in encoded for token in ("prompt", "tool_arguments", "source_contents", "transcript")):
        raise RealBaselineError("real baseline report contains raw payload fields")
    if report.get("reconstruction", {}).get("raw_payloads_in_report") is not False:
        raise RealBaselineError("real baseline reconstruction is not redacted")


def validate_input_receipts(report: dict, rows: list[dict], validity_records: list[dict]) -> None:
    """Verify raw private inputs against the report's semantic receipts.

    This is intentionally separate from :func:`validate_real_report`: the
    report is redacted and can be checked without exposing private rows, while
    a reviewer holding the private inputs can additionally prove that the
    report was rebuilt from exactly these ordered records.
    """

    if not isinstance(rows, list) or not isinstance(validity_records, list):
        raise RealBaselineError("reconstruction inputs must be record lists")
    reconstruction = report.get("reconstruction") if isinstance(report, dict) else None
    receipts = reconstruction.get("input_artifacts") if isinstance(reconstruction, dict) else None
    if not isinstance(receipts, dict):
        raise RealBaselineError("real baseline input receipts are missing")
    expected = {
        "rows": (rows, "pi.eval-row/v4"),
        "validity": (validity_records, "pi.trial-validity-sidecar/v1"),
    }
    for name, (records, schema) in expected.items():
        receipt = receipts.get(name)
        if not isinstance(receipt, dict):
            raise RealBaselineError(f"real baseline {name} input receipt is missing")
        if receipt.get("schema") != schema or receipt.get("record_count") != len(records):
            raise RealBaselineError(f"real baseline {name} input receipt does not match records")
        if receipt.get("canonical_sha256") != _jsonl_digest(records):
            raise RealBaselineError(f"real baseline {name} input digest does not match records")


def write_private_report(path: str | pathlib.Path, report: dict) -> pathlib.Path:
    """Atomically publish a redacted report with private permissions."""
    target = pathlib.Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(target.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=".real-baseline.", dir=target.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(report, stream, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        os.chmod(target, 0o600)
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    return target


def load_jsonl(path: str | pathlib.Path) -> list[dict]:
    target = pathlib.Path(path).expanduser().resolve()
    if target.is_symlink() or not target.is_file():
        raise RealBaselineError("JSONL artifact must be a regular file")
    result: list[dict] = []
    try:
        for line in target.read_text(encoding="utf-8").splitlines():
            value = json.loads(line)
            if not isinstance(value, dict):
                raise RealBaselineError("JSONL artifact contains a non-object")
            result.append(value)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RealBaselineError(f"cannot read JSONL artifact: {exc}") from exc
    return result


def load_json_object(path: str | pathlib.Path, name: str = "JSON artifact") -> dict:
    """Load one private JSON object without following symlinks."""

    raw_target = pathlib.Path(path).expanduser()
    if raw_target.is_symlink() or not raw_target.is_file():
        raise RealBaselineError(f"{name} must be a regular file")
    try:
        value = json.loads(raw_target.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RealBaselineError(f"{name} is malformed") from exc
    if not isinstance(value, dict):
        raise RealBaselineError(f"{name} must contain one object")
    return value


def selftest() -> None:
    print("g03 real-baseline ingestor selftest: OK (redacted rows, explicit exclusions, fail-closed identity)")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--ingest", action="store_true", help="ingest existing gate artifacts; never launches Pi")
    parser.add_argument("--verify", action="store_true", help="rebuild a private report from its inputs; never launches Pi")
    parser.add_argument("--rows")
    parser.add_argument("--validity")
    parser.add_argument("--preregistration")
    parser.add_argument("--case-tasks", help="JSON object mapping benchmark case IDs to real-gate task IDs")
    parser.add_argument("--run-id")
    parser.add_argument("--resolved-provider")
    parser.add_argument("--resolved-model")
    parser.add_argument("--repository-root", default=str(pathlib.Path(__file__).resolve().parents[2]))
    parser.add_argument("--output")
    parser.add_argument("--report", help="existing private report for --verify")
    args = parser.parse_args()
    if args.selftest:
        selftest()
    elif args.ingest:
        required = (args.rows, args.validity, args.preregistration, args.case_tasks,
                    args.run_id, args.resolved_provider, args.resolved_model)
        if any(value is None for value in required):
            parser.error("--ingest requires --rows, --validity, --preregistration, --case-tasks, --run-id, --resolved-provider, and --resolved-model")
        try:
            repository = pathlib.Path(args.repository_root).expanduser().resolve()
            prereg_path = pathlib.Path(args.preregistration).expanduser().resolve()
            prereg = BaselinePreregistration.load(prereg_path)
            pack_path = (repository / prereg.pack_path).resolve()
            pack = BenchmarkPack.load(pack_path)
            case_tasks = load_case_tasks(args.case_tasks)
            report = ingest_gate_baseline(
                pack, prereg, repository, load_jsonl(args.rows), load_jsonl(args.validity),
                case_tasks=case_tasks, run_id=args.run_id,
                resolved_model={"provider": args.resolved_provider, "model": args.resolved_model},
            )
            validate_real_report(report, pack, prereg)
            if args.output:
                write_private_report(args.output, report)
            print(json.dumps({
                "schema": REAL_REPORT_SCHEMA,
                "report_sha256": report["report_sha256"],
                "evidence_class": report["evidence_class"],
                "model_quality_evidence": report["model_quality_evidence"],
                "decision": report["decision"],
                "trial_count": report["trial_count"],
                "execution": False,
            }, sort_keys=True))
        except (BaselineError, OSError, UnicodeError, json.JSONDecodeError) as exc:
            parser.exit(2, f"g03-real-baseline: {exc}\n")
    elif args.verify:
        required = (args.rows, args.validity, args.preregistration, args.case_tasks, args.report)
        if any(value is None for value in required):
            parser.error("--verify requires --rows, --validity, --preregistration, --case-tasks, and --report")
        try:
            repository = pathlib.Path(args.repository_root).expanduser().resolve()
            prereg_path = pathlib.Path(args.preregistration).expanduser().resolve()
            prereg = BaselinePreregistration.load(prereg_path)
            pack_path = (repository / prereg.pack_path).resolve()
            pack = BenchmarkPack.load(pack_path)
            case_tasks = load_case_tasks(args.case_tasks)
            rows = load_jsonl(args.rows)
            validity = load_jsonl(args.validity)
            report = load_json_object(args.report, "real baseline report")
            validate_real_report(report, pack, prereg)
            validate_input_receipts(report, rows, validity)
            reconstructed = ingest_gate_baseline(
                pack, prereg, repository, rows, validity,
                case_tasks=case_tasks, run_id=report["run_id"],
                resolved_model=report["resolved_model"],
            )
            if reconstructed != report:
                raise RealBaselineError("reconstructed report differs from the recorded report")
            print(json.dumps({
                "schema": REAL_REPORT_SCHEMA,
                "report_sha256": report["report_sha256"],
                "reconstructed": True,
                "trial_count": report["trial_count"],
                "execution": False,
            }, sort_keys=True))
        except (BaselineError, OSError, UnicodeError, json.JSONDecodeError) as exc:
            parser.exit(2, f"g03-real-baseline: {exc}\n")
    else:
        parser.error("choose --selftest, --ingest, or --verify; inference is never launched by this module")
