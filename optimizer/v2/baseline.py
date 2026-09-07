from __future__ import annotations

"""Governed baseline preparation and deterministic offline execution for G03.

The real Pi gate remains the only model-quality evaluator.  This module gives
the benchmark a reviewable preregistration and a no-inference protocol runner
that exercises pairing, provenance, quarantine, cost accounting, and report
reconstruction without contacting a model or reading answer content.
"""

import dataclasses
import hashlib
import json
import os
import pathlib
import tempfile
import argparse
import re
from typing import Any

try:
    from .benchmark import BenchmarkPack
except ImportError:  # direct `python optimizer/v2/baseline.py --selftest`
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from optimizer.v2.benchmark import BenchmarkPack


PREREG_SCHEMA = "pi.optimizer-baseline-preregistration/v1"
REPORT_SCHEMA = "pi.optimizer-baseline-report/v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")


class BaselineError(ValueError):
    pass


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def _strict(value: Any, name: str, required: set[str], optional: set[str] = frozenset()) -> dict:
    if not isinstance(value, dict):
        raise BaselineError(f"{name} must be an object")
    unknown = set(value) - required - optional
    missing = required - set(value)
    if unknown:
        raise BaselineError(f"{name} has unknown field(s): {', '.join(sorted(unknown))}")
    if missing:
        raise BaselineError(f"{name} is missing field(s): {', '.join(sorted(missing))}")
    return value


def _text(value: Any, name: str, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise BaselineError(f"{name} must be a non-empty string of at most {maximum} characters")
    return value


def _sha(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise BaselineError(f"{name} must be a lowercase SHA-256")
    return value


def _positive_int(value: Any, name: str, maximum: int = 1_000_000) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= maximum:
        raise BaselineError(f"{name} must be an integer in 1..{maximum}")
    return value


@dataclasses.dataclass(frozen=True)
class BaselinePreregistration:
    raw: dict
    sha256: str
    preregistration_id: str
    pack_path: str
    pack_sha256: str
    primary_metric: dict
    subject_model: dict
    guard_models: tuple[dict, ...]
    surface_identity: dict
    arms: dict
    seeds: tuple[int, ...]
    repetitions: int
    randomization: dict
    limits: dict
    quarantine: dict

    @classmethod
    def from_dict(cls, raw: dict) -> "BaselinePreregistration":
        obj = _strict(raw, "baseline preregistration", {
            "schema", "preregistration_id", "benchmark_pack", "primary_metric", "subject_model",
            "guard_models", "surface_identity", "arms", "seeds", "repetitions", "randomization",
            "limits", "quarantine",
        })
        if obj["schema"] != PREREG_SCHEMA:
            raise BaselineError(f"schema must be {PREREG_SCHEMA}")
        prereg_id = _text(obj["preregistration_id"], "preregistration_id")
        pack = _strict(obj["benchmark_pack"], "benchmark_pack", {"path", "sha256", "pack_id", "revision"})
        pack_path = _text(pack["path"], "benchmark_pack.path", 512)
        if pathlib.PurePosixPath(pack_path).is_absolute() or ".." in pathlib.PurePosixPath(pack_path).parts:
            raise BaselineError("benchmark_pack.path must be repository-relative")
        pack_sha = _sha(pack["sha256"], "benchmark_pack.sha256")
        pack_id = _text(pack["pack_id"], "benchmark_pack.pack_id")
        revision = _text(pack["revision"], "benchmark_pack.revision")
        metric = _strict(obj["primary_metric"], "primary_metric", {"name", "direction", "kind"})
        metric_name = _text(metric["name"], "primary_metric.name")
        if metric["direction"] not in ("maximize", "minimize") or metric["kind"] not in ("binary", "continuous"):
            raise BaselineError("primary_metric direction or kind is invalid")
        subject = _strict(obj["subject_model"], "subject_model", {"provider", "model", "role"})
        _text(subject["provider"], "subject_model.provider")
        _text(subject["model"], "subject_model.model")
        if subject["role"] != "adoption-cohort":
            raise BaselineError("subject_model.role must be adoption-cohort")
        guards = obj["guard_models"]
        if not isinstance(guards, list):
            raise BaselineError("guard_models must be a list")
        parsed_guards = []
        for index, guard in enumerate(guards):
            value = _strict(guard, f"guard_models[{index}]", {"provider", "model", "role"})
            _text(value["provider"], f"guard_models[{index}].provider")
            _text(value["model"], f"guard_models[{index}].model")
            if value["role"] != "guard":
                raise BaselineError(f"guard_models[{index}].role must be guard")
            parsed_guards.append(dict(value))
        identity = _strict(obj["surface_identity"], "surface_identity", {"source_sha256", "config_sha256", "surface_sha256"})
        for field in identity:
            _sha(identity[field], f"surface_identity.{field}")
        arms = _strict(obj["arms"], "arms", {"baseline", "candidate"})
        for name, arm in arms.items():
            value = _strict(arm, f"arms.{name}", {"config_path", "config_sha256", "surface_sha256", "label"})
            config_path = _text(value["config_path"], f"arms.{name}.config_path", 512)
            path = pathlib.PurePosixPath(config_path)
            if path.is_absolute() or ".." in path.parts:
                raise BaselineError(f"arms.{name}.config_path must be repository-relative")
            _sha(value["config_sha256"], f"arms.{name}.config_sha256")
            _sha(value["surface_sha256"], f"arms.{name}.surface_sha256")
            if value["label"] not in ("baseline", "candidate") or value["label"] != name:
                raise BaselineError(f"arms.{name}.label is invalid or does not match its arm identity")
        seeds = obj["seeds"]
        if not isinstance(seeds, list) or not seeds or len(seeds) != len(set(seeds)) or any(not isinstance(seed, int) or isinstance(seed, bool) or seed < 0 for seed in seeds):
            raise BaselineError("seeds must be unique non-negative integers")
        repetitions = _positive_int(obj["repetitions"], "repetitions", 100)
        randomization = _strict(obj["randomization"], "randomization", {"method", "seed", "arm_order"})
        if randomization["method"] != "deterministic-hash" or not isinstance(randomization["seed"], int) or isinstance(randomization["seed"], bool) or randomization["arm_order"] != ["baseline", "candidate"]:
            raise BaselineError("randomization must use deterministic-hash arm ordering")
        limits = _strict(obj["limits"], "limits", {"case_timeout_seconds", "pack_timeout_seconds", "max_tool_calls", "max_retries", "max_output_bytes"})
        _positive_int(limits["case_timeout_seconds"], "limits.case_timeout_seconds", 3_600)
        _positive_int(limits["pack_timeout_seconds"], "limits.pack_timeout_seconds", 86_400)
        _positive_int(limits["max_tool_calls"], "limits.max_tool_calls", 100_000)
        _positive_int(limits["max_retries"], "limits.max_retries", 10_000)
        _positive_int(limits["max_output_bytes"], "limits.max_output_bytes", 16_777_216)
        quarantine = _strict(obj["quarantine"], "quarantine", {"development_payloads", "test_payloads", "optimizer_diagnosis"})
        if quarantine["development_payloads"] is not True or quarantine["test_payloads"] is not True or quarantine["optimizer_diagnosis"] != "forbidden":
            raise BaselineError("development/test quarantine must be enabled and diagnosis access forbidden")
        normalized = json.loads(canonical(obj))
        return cls(normalized, digest(normalized), prereg_id, pack_path, pack_sha, dict(metric), dict(subject), tuple(parsed_guards), dict(identity), dict(arms), tuple(seeds), repetitions, dict(randomization), dict(limits), dict(quarantine))

    @classmethod
    def load(cls, path: str | pathlib.Path) -> "BaselinePreregistration":
        try:
            return cls.from_dict(json.loads(pathlib.Path(path).read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as exc:
            raise BaselineError(f"cannot read baseline preregistration: {exc}") from exc


def prepare_baseline(pack: BenchmarkPack, prereg: BaselinePreregistration, repository_root: str | pathlib.Path) -> dict:
    root = pathlib.Path(repository_root).resolve()
    pack_path = (root / prereg.pack_path).resolve()
    if pack_path.is_symlink() or root not in pack_path.parents or not pack_path.is_file():
        raise BaselineError("benchmark pack path is outside the repository")
    if hashlib.sha256(pack_path.read_bytes()).hexdigest() != prereg.pack_sha256:
        raise BaselineError("benchmark pack hash does not match preregistration")
    if pack.pack_id != prereg.raw["benchmark_pack"]["pack_id"] or pack.revision != prereg.raw["benchmark_pack"]["revision"] or pack.metric != prereg.primary_metric["name"]:
        raise BaselineError("benchmark pack identity does not match preregistration")
    if pack.provenance is not None:
        if (pack.provenance.get("source_surface_sha256") != prereg.surface_identity["source_sha256"] or
                pack.provenance.get("config_sha256") != prereg.surface_identity["config_sha256"]):
            raise BaselineError("benchmark provenance does not match preregistered source/config identity")
    for arm_name, arm in prereg.arms.items():
        config_path = (root / arm["config_path"]).resolve()
        if config_path.is_symlink() or root not in config_path.parents or not config_path.is_file():
            raise BaselineError(f"{arm_name} arm config is outside the repository")
        if hashlib.sha256(config_path.read_bytes()).hexdigest() != arm["config_sha256"]:
            raise BaselineError(f"{arm_name} arm config hash does not match preregistration")
    artifacts = pack.validate_artifacts(root)
    counts = pack.taxonomy_counts()
    expected = {"coding_edit": 2, "failure_recovery": 2, "documentation": 2, "long_context": 2, "research_comparative": 1, "research_contested": 1, "research_multi_part": 1, "research_fact_lookup": 1}
    if counts != expected:
        raise BaselineError("G03 pilot taxonomy does not contain the required 12-case slate")
    if len(artifacts) != len(pack.all_cases()):
        raise BaselineError("benchmark artifact validation is incomplete")
    return {
        "schema": "pi.optimizer-baseline-prepared/v1",
        "preregistration_sha256": prereg.sha256,
        "benchmark_pack_sha256": pack.sha256,
        "case_count": len(pack.all_cases()),
        "split_counts": {name: len(values) for name, values in pack.splits.items()},
        "taxonomy_counts": counts,
        "subject_model": prereg.subject_model,
        "guard_models": list(prereg.guard_models),
        "development_quarantined": True,
        "opaque_test_unreachable": True,
        "model_execution": False,
    }


def arm_order(case_id: str, seed: int, repetition: int, randomization_seed: int) -> list[str]:
    value = f"{randomization_seed}:{case_id}:{seed}:{repetition}".encode()
    return ["candidate", "baseline"] if int(hashlib.sha256(value).hexdigest()[:2], 16) & 1 else ["baseline", "candidate"]


def _trial(case, split: str, arm: str, seed: int, repetition: int, randomization_seed: int) -> dict:
    digest_seed = hashlib.sha256(f"g03:{case.case_id}:{arm}:{seed}:{repetition}".encode()).hexdigest()
    success = int(digest_seed[:2], 16) % 5 != 0
    outcome = "success" if success else "failure"
    telemetry_digest = hashlib.sha256(f"g03-telemetry:{case.case_id}:{arm}:{seed}:{repetition}".encode()).hexdigest()
    return {
        "case_id": case.case_id, "split": split, "arm": arm, "seed": seed, "repetition": repetition,
        "status": "completed", "outcome": outcome, "score": int(success),
        "artifact_persisted": True, "verification_passed": True, "evidence_coverage": bool(success or not case.is_research),
        "source_identity_bound": True, "stop_class": "normal", "invalid_reason": None,
        "config_sha256": "bound-by-preregistration", "surface_sha256": "bound-by-preregistration",
        "telemetry": {"status": "protocol-fixture", "digest": telemetry_digest, "authenticated": True},
        "costs": {
            "tool_calls": 2 + int(digest_seed[2], 16) % 5, "retries": int(digest_seed[3], 16) % 2,
            "wall_ms": 100 + int(digest_seed[4:8], 16) % 900, "input_tokens": 80 + int(digest_seed[8:12], 16) % 400,
            "output_tokens": 20 + int(digest_seed[12:16], 16) % 180, "compactions": int(digest_seed[16], 16) % 2,
        },
        "child_telemetry": "unavailable-contained", "arm_order": arm_order(case.case_id, seed, repetition, randomization_seed),
    }


def run_offline_baseline(pack: BenchmarkPack, prereg: BaselinePreregistration, repository_root: str | pathlib.Path) -> dict:
    prepared = prepare_baseline(pack, prereg, repository_root)
    rows = []
    # Opaque test cases are intentionally not touched; this report is a
    # protocol qualification artifact, never model-quality evidence.
    for split in ("train", "development"):
        for case in pack.splits[split]:
            for seed in prereg.seeds:
                for repetition in range(prereg.repetitions):
                    for arm in ("baseline", "candidate"):
                        row = _trial(case, split, arm, seed, repetition, prereg.randomization["seed"])
                        row["config_sha256"] = prereg.arms[arm]["config_sha256"]
                        row["surface_sha256"] = prereg.arms[arm]["surface_sha256"]
                        rows.append(row)
    by_arm: dict[str, list[dict]] = {"baseline": [], "candidate": []}
    for row in rows:
        by_arm[row["arm"]].append(row)
    def summary(arm: str) -> dict:
        values = by_arm[arm]
        score = sum(row["score"] for row in values) / len(values) if values else 0.0
        return {
            "trials": len(values), "completed": sum(row["status"] == "completed" for row in values),
            "successes": sum(row["score"] for row in values), "primary_score": score,
            "invalid_trials": sum(row["status"] == "invalid" for row in values),
            "timeouts": sum(row["outcome"] == "timeout" for row in values),
            "tool_calls": sum(row["costs"]["tool_calls"] for row in values),
            "retries": sum(row["costs"]["retries"] for row in values),
            "wall_ms": sum(row["costs"]["wall_ms"] for row in values),
            "input_tokens": sum(row["costs"]["input_tokens"] for row in values),
            "output_tokens": sum(row["costs"]["output_tokens"] for row in values),
            "compactions": sum(row["costs"]["compactions"] for row in values),
            "child_telemetry": "unavailable-contained",
        }
    per_case = {}
    for case in pack.all_cases():
        if case.case_id in {value.case_id for value in pack.splits["test"]}:
            continue
        split_name = next(split for split in ("train", "development") if case in pack.splits[split])
        per_case[case.case_id] = {}
        for arm in ("baseline", "candidate"):
            values = [row for row in rows if row["case_id"] == case.case_id and row["arm"] == arm]
            per_case[case.case_id][arm] = {
                "split": split_name, "attempted": len(values),
                "completed": sum(row["status"] == "completed" for row in values),
                "successes": sum(row["score"] == 1 for row in values),
                "invalid_trials": sum(row["status"] == "invalid" for row in values),
                "timeouts": sum(row["outcome"] == "timeout" for row in values),
                "tool_calls": sum(row["costs"]["tool_calls"] for row in values),
                "retries": sum(row["costs"]["retries"] for row in values),
                "wall_ms": sum(row["costs"]["wall_ms"] for row in values),
                "input_tokens": sum(row["costs"]["input_tokens"] for row in values),
                "output_tokens": sum(row["costs"]["output_tokens"] for row in values),
                "compactions": sum(row["costs"]["compactions"] for row in values),
                "child_telemetry": "unavailable-contained",
            }
    report = {
        "schema": REPORT_SCHEMA, "evidence_class": "protocol-only", "model_quality_evidence": False,
        "prepared": prepared, "preregistration_sha256": prereg.sha256, "benchmark_pack_sha256": pack.sha256,
        "subject_model": prereg.subject_model, "guard_models": list(prereg.guard_models),
        "arms": {name: {"label": value["label"], "config_sha256": value["config_sha256"], "surface_sha256": value["surface_sha256"]} for name, value in prereg.arms.items()},
        "train_and_development_only": True, "opaque_test_cases_evaluated": False,
        "development_payloads_quarantined": True, "optimizer_diagnosis_access": "forbidden",
        "randomization": {"method": prereg.randomization["method"], "seed": prereg.randomization["seed"], "paired_cells": True},
        "primary_metric": prereg.primary_metric, "hard_guards": {"security_failures": 0, "unsupported_claims": 0, "unwanted_continuation": 0},
        "external_references": [], "reference_pooling": "forbidden", "historical_evidence": "display-only-not-pooled",
        "decision": {"status": "inconclusive", "reason": "offline_protocol_fixture_is_not_model_quality_evidence", "statistical_power": "not-established"},
        "telemetry_binding": {"status": "protocol-fixture", "authenticated": True, "raw_payloads": False},
        "cohorts": {"subject": summary("baseline"), "candidate": summary("candidate"), "guards": [{"model": model, "status": "not-executed-offline"} for model in prereg.guard_models]},
        "per_case": per_case, "trial_count": len(rows), "trials": rows,
        "reconstruction": {"pack_path": prereg.pack_path, "preregistration_sha256": prereg.sha256, "immutable_receipts": True, "rerun_inference_required": False},
        "human_review_required": True, "adoption_authorized": False,
    }
    report["report_sha256"] = digest(report)
    return report


def validate_offline_report(report: dict, pack: BenchmarkPack, prereg: BaselinePreregistration) -> None:
    """Check the report's safe protocol invariants without running inference."""
    if not isinstance(report, dict) or report.get("schema") != REPORT_SCHEMA:
        raise BaselineError("offline baseline report schema is invalid")
    if report.get("preregistration_sha256") != prereg.sha256 or report.get("benchmark_pack_sha256") != pack.sha256:
        raise BaselineError("offline baseline report identity is not bound")
    if report.get("evidence_class") != "protocol-only" or report.get("model_quality_evidence") is not False:
        raise BaselineError("offline report cannot be presented as model-quality evidence")
    if report.get("opaque_test_cases_evaluated") is not False or report.get("development_payloads_quarantined") is not True:
        raise BaselineError("offline report violated benchmark quarantine")
    rows = report.get("trials")
    if not isinstance(rows, list):
        raise BaselineError("offline report has no trial rows")
    expected = {(case.case_id, seed, repetition, arm) for split in ("train", "development") for case in pack.splits[split] for seed in prereg.seeds for repetition in range(prereg.repetitions) for arm in ("baseline", "candidate")}
    actual = set()
    for row in rows:
        if not isinstance(row, dict):
            raise BaselineError("offline report contains a malformed trial")
        key = (row.get("case_id"), row.get("seed"), row.get("repetition"), row.get("arm"))
        if key in actual or key not in expected:
            raise BaselineError("offline report has duplicate, unknown, or opaque trial cells")
        actual.add(key)
        if row.get("status") == "invalid" and not isinstance(row.get("invalid_reason"), str):
            raise BaselineError("invalid trials require an explicit reason")
        telemetry = row.get("telemetry") or {}
        if telemetry.get("authenticated") is not True or not HEX64.fullmatch(str(telemetry.get("digest", ""))):
            raise BaselineError("offline trial telemetry binding is incomplete")
        arm = prereg.arms.get(str(row.get("arm")))
        if arm is None or row.get("config_sha256") != arm["config_sha256"] or row.get("surface_sha256") != arm["surface_sha256"]:
            raise BaselineError("offline trial arm identity is not bound")
    if actual != expected or report.get("trial_count") != len(expected):
        raise BaselineError("offline report does not cover the complete paired grid")
    if report.get("decision", {}).get("status") != "inconclusive":
        raise BaselineError("offline protocol must remain inconclusive")


def write_private_json(path: str | pathlib.Path, value: dict) -> pathlib.Path:
    target = pathlib.Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(target.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=".baseline.", dir=target.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, target); os.chmod(target, 0o600)
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
    except Exception:
        try: os.unlink(temporary)
        except OSError: pass
        raise
    return target


def selftest() -> None:
    repo = pathlib.Path(__file__).resolve().parents[1]
    pack_path = repo / "v2/benchmarks/g03-representative-pilot-v1.json"
    pack = BenchmarkPack.load(pack_path)
    prereg_path = repo / "v2/examples/g03-baseline-preregistration.json"
    prereg = BaselinePreregistration.load(prereg_path)
    report = run_offline_baseline(pack, prereg, repo.parent)
    validate_offline_report(report, pack, prereg)
    if report["trial_count"] != 40 or report["opaque_test_cases_evaluated"] or report["model_quality_evidence"]:
        raise BaselineError("offline baseline selftest violated quarantine or trial count")
    if len({(row["case_id"], row["seed"], row["repetition"], row["arm"]) for row in report["trials"]}) != 40:
        raise BaselineError("offline baseline cells are not unique")
    with tempfile.TemporaryDirectory() as td:
        path = write_private_json(pathlib.Path(td) / "report.json", report)
        if path.stat().st_mode & 0o077:
            raise BaselineError("baseline report is not private")
    print("g03 baseline selftest: OK (12-case registry, paired offline protocol, test quarantine, no inference)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m optimizer.v2.baseline")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--dry", action="store_true")
    parser.add_argument("--preregistration")
    parser.add_argument("--repository-root", default=str(pathlib.Path(__file__).resolve().parents[2]))
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    try:
        if args.selftest:
            selftest(); return 0
        if not args.dry or not args.preregistration:
            parser.error("choose --selftest or --dry --preregistration <path>")
        prereg = BaselinePreregistration.load(args.preregistration)
        repository = pathlib.Path(args.repository_root).expanduser().resolve()
        pack_path = repository / prereg.pack_path
        report = run_offline_baseline(BenchmarkPack.load(pack_path), prereg, repository)
        if args.output:
            write_private_json(args.output, report)
        print(json.dumps({
            "schema": REPORT_SCHEMA, "report_sha256": report["report_sha256"],
            "evidence_class": report["evidence_class"], "model_quality_evidence": report["model_quality_evidence"],
            "trial_count": report["trial_count"], "opaque_test_cases_evaluated": report["opaque_test_cases_evaluated"],
            "execution": False,
        }, sort_keys=True))
        return 0
    except (BaselineError, OSError, json.JSONDecodeError) as exc:
        print(f"g03-baseline: {exc}", file=__import__("sys").stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
