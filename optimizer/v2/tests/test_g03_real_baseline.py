from __future__ import annotations

import copy
import json
import pathlib
import unittest

from optimizer.v2.baseline import BaselinePreregistration
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.real_baseline import RealBaselineError, _row_digest, _row_key, ingest_gate_baseline, load_case_tasks, validate_input_receipts, validate_real_report, write_private_report


ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO = ROOT.parent
PACK = BenchmarkPack.load(ROOT / "v2/benchmarks/g03-representative-pilot-v1.json")
PREREG = BaselinePreregistration.load(ROOT / "v2/examples/g03-baseline-preregistration.json")
R2_TASK_MAP = json.loads((ROOT / "v2/examples/g03-baseline-task-map-r2.json").read_text(encoding="utf-8"))
CASE_TASKS = {
    case.case_id: f"g03-{case.case_id}"
    for split in ("train", "development")
    for case in PACK.splits[split]
}


def make_row(case_id: str, arm: str, rep: int, session: str, *, timeout: bool = False) -> dict:
    case = PACK.case(case_id)
    config = PREREG.arms["baseline" if arm == "base" else "candidate"]
    resolved_model = "qwen36-35b-iq3s"
    resolved_provider = "llama"
    return {
        "schema": "pi.eval-row/v4", "run": "g03-real-run", "model": PREREG.subject_model["model"],
        "split": "train" if case in PACK.splits["train"] else "development", "task": CASE_TASKS[case_id],
        # real_gate.sh writes the one-based seed ordinal into both fields for
        # its one-repetition invocation; the ingestor must normalize that
        # legacy shape to the preregistered repetition zero.
        "pattern": arm, "arm": arm, "rep": rep, "repetition": rep,
        "score": 0 if timeout else 1, "authoritative": not timeout, "status": "incomplete" if timeout else "complete",
        "authority_reason": "wall_timeout" if timeout else "complete",
        "execution": {"provider": "llama", "authoritative": True},
        "config": {"sha256": config["config_sha256"]},
        "harness": {"surface_sha256": config["surface_sha256"]},
        "experiment": {"manifest_sha256": PREREG.sha256},
        "gate_session_id": session,
        "serving": {"stable": True, "pre": {"status": "complete", "full_sha256": "d" * 64}, "post": {"status": "complete", "full_sha256": "d" * 64}},
        "context": {
            "schema": "pi.context-telemetry/v4", "authenticated": True,
            "provenance": {
                "schema": "pi.gate-session/v1", "complete": True,
                "session_id": session, "invocation_id": "g03-real-run",
                "requested_provider": PREREG.subject_model["provider"],
                "requested_model": PREREG.subject_model["model"],
                "resolved_provider": resolved_provider, "resolved_model": resolved_model,
                "config_sha256": config["config_sha256"], "surface_sha256": config["surface_sha256"],
            },
        },
        "exposure": {"status": "control" if arm == "base" else "targeted"},
        "trajectory": {"tool_calls": 3, "compactions": 0}, "retried": 0,
        "usage": {"input_tokens": 100, "output_tokens": 50},
    }


def complete_rows() -> tuple[list[dict], list[dict]]:
    rows: list[dict] = []
    validity: list[dict] = []
    n = 0
    for split in ("train", "development"):
        for case in PACK.splits[split]:
            for rep in (1, 2):
                for arm in ("base", "cand"):
                    n += 1
                    row = make_row(case.case_id, arm, rep, f"session-{n:02d}")
                    rows.append(row)
                    validity.append({"row_key": _row_key(row), "row_sha256": _row_digest(row), "void": False})
    return rows, validity


class G03RealBaselineIngestTests(unittest.TestCase):
    def test_checked_in_r2_task_map_covers_exact_train_development_cases(self) -> None:
        expected = {
            case.case_id
            for split in ("train", "development")
            for case in BenchmarkPack.load(ROOT / "v2/benchmarks/g03-representative-pilot-r2.json").splits[split]
        }
        self.assertEqual(set(R2_TASK_MAP), expected)
        self.assertEqual(len(set(R2_TASK_MAP.values())), len(R2_TASK_MAP))

    def test_case_task_map_loader_is_inline_or_regular_file_only(self) -> None:
        self.assertEqual(load_case_tasks(json.dumps(CASE_TASKS)), CASE_TASKS)
        with __import__("tempfile").TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "tasks.json"
            target.write_text(json.dumps(CASE_TASKS), encoding="utf-8")
            self.assertEqual(load_case_tasks(target), CASE_TASKS)
            alias = root / "tasks-alias.json"
            alias.symlink_to(target)
            with self.assertRaises(RealBaselineError):
                load_case_tasks(alias)

    def test_complete_paired_grid_is_quality_bound_but_not_adoption(self) -> None:
        rows, validity = complete_rows()
        report = ingest_gate_baseline(PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS, run_id="g03-real-run", resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"})
        validate_real_report(report, PACK, PREREG)
        self.assertTrue(report["model_quality_evidence"])
        self.assertEqual(report["decision"]["status"], "inconclusive")
        self.assertEqual(report["decision"]["reason"], "ceiling")
        self.assertFalse(report["adoption_authorized"])
        self.assertEqual(report["trial_count"], 40)
        self.assertEqual(len(report["serving_identity_sha256"]), 1)
        self.assertEqual({trial["repetition"] for trial in report["trials"]}, {0})
        self.assertNotIn("prompt", json.dumps(report))
        self.assertRegex(report["case_tasks_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            report["case_tasks_sha256"],
            __import__("hashlib").sha256(
                json.dumps(CASE_TASKS, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest(),
        )

    def test_report_binds_canonical_input_receipts_for_reconstruction(self) -> None:
        rows, validity = complete_rows()
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
            run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        receipts = report["reconstruction"]["input_artifacts"]
        self.assertEqual(set(receipts), {"rows", "validity"})
        self.assertEqual(receipts["rows"]["record_count"], len(rows))
        self.assertEqual(receipts["validity"]["record_count"], len(validity))
        self.assertRegex(receipts["rows"]["canonical_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(receipts["validity"]["canonical_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(report["reconstruction"]["run_id"], "g03-real-run")
        validate_real_report(report, PACK, PREREG)
        validate_input_receipts(report, rows, validity)
        tampered = copy.deepcopy(report)
        tampered["reconstruction"]["input_artifacts"]["rows"]["canonical_sha256"] = "0" * 64
        tampered["report_sha256"] = __import__("hashlib").sha256(
            json.dumps({key: value for key, value in tampered.items() if key != "report_sha256"}, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
        with self.assertRaises(RealBaselineError):
            validate_input_receipts(tampered, rows, validity)

    def test_timeout_and_missing_cells_are_retained_as_non_authoritative(self) -> None:
        row = make_row("coding-edit-access", "base", 1, "session-timeout", timeout=True)
        validity = [{"row_key": _row_key(row), "row_sha256": _row_digest(row), "void": True}]
        report = ingest_gate_baseline(PACK, PREREG, REPO, [row], validity, case_tasks=CASE_TASKS, run_id="g03-real-run", resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"})
        validate_real_report(report, PACK, PREREG)
        self.assertFalse(report["model_quality_evidence"])
        self.assertEqual(sum(trial["status"] == "timeout" for trial in report["trials"]), 1)
        self.assertGreater(sum(trial["status"] == "excluded" for trial in report["trials"]), 0)
        self.assertIsNone(report["hard_guards"]["unsupported_claims"])
        self.assertIsNone(report["hard_guards"]["unwanted_continuation"])
        self.assertEqual(report["decision"]["status"], "inconclusive")

    def test_complete_non_ceiling_grid_is_descriptively_informative(self) -> None:
        rows, validity = complete_rows()
        rows[0]["score"] = 0
        validity[0]["row_sha256"] = _row_digest(rows[0])
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
            run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        validate_real_report(report, PACK, PREREG)
        self.assertTrue(report["model_quality_evidence"])
        self.assertEqual(report["decision"], {
            "status": "informative",
            "reason": "complete-authoritative-paired-grid",
            "statistical_power": "not-established",
        })

    def test_complete_grid_aggregates_guard_counters(self) -> None:
        rows, validity = complete_rows()
        for row, sidecar in zip(rows, validity):
            row["unsupported_claims"] = 1
            row["unwanted_continuation"] = 0
            sidecar["row_sha256"] = _row_digest(row)
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
            run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        self.assertEqual(report["hard_guards"]["unsupported_claims"], 40)
        self.assertEqual(report["hard_guards"]["unwanted_continuation"], 0)
        self.assertEqual(report["cohorts"]["subject"]["unsupported_claims"], 20)
        self.assertEqual(report["cohorts"]["candidate"]["unsupported_claims"], 20)

    def test_model_identity_and_sidecar_mismatches_fail_closed(self) -> None:
        rows, validity = complete_rows()
        with self.assertRaises(RealBaselineError):
            ingest_gate_baseline(PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS, run_id="g03-real-run", resolved_model={"provider": "llama", "model": "wrong-model"})
        bad = copy.deepcopy(validity)
        bad[0]["row_sha256"] = "a" * 64
        report = ingest_gate_baseline(PACK, PREREG, REPO, rows, bad, case_tasks=CASE_TASKS, run_id="g03-real-run", resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"})
        self.assertFalse(report["model_quality_evidence"])
        self.assertEqual(report["trials"][0]["status"], "invalid")

    def test_report_generation_is_deterministic(self) -> None:
        rows, validity = complete_rows()
        kwargs = {"case_tasks": CASE_TASKS, "run_id": "g03-real-run", "resolved_model": {"provider": "llama", "model": "qwen36-35b-iq3s"}}
        first = ingest_gate_baseline(PACK, PREREG, REPO, rows, validity, **kwargs)
        second = ingest_gate_baseline(PACK, PREREG, REPO, rows, validity, **kwargs)
        self.assertEqual(first, second)

    def test_verify_cli_rebuilds_report_from_private_inputs(self) -> None:
        rows, validity = complete_rows()
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
            run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        with __import__("tempfile").TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            rows_path = root / "rows.jsonl"
            validity_path = root / "rows.jsonl.validity.jsonl"
            report_path = root / "report.json"
            rows_path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
            validity_path.write_text("".join(json.dumps(item, sort_keys=True) + "\n" for item in validity), encoding="utf-8")
            write_private_report(report_path, report)
            completed = __import__("subprocess").run(
                [
                    __import__("sys").executable, str(ROOT / "v2/real_baseline.py"), "--verify",
                    "--rows", str(rows_path), "--validity", str(validity_path),
                    "--report", str(report_path), "--preregistration", str(ROOT / "v2/examples/g03-baseline-preregistration.json"),
                    "--case-tasks", json.dumps(CASE_TASKS), "--repository-root", str(REPO),
                ], cwd=str(REPO), text=True, capture_output=True, check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue(json.loads(completed.stdout)["reconstructed"])

    def test_provenance_exposure_and_split_mismatches_are_non_authoritative(self) -> None:
        rows, validity = complete_rows()
        rows[0]["context"]["provenance"]["complete"] = False
        validity[0]["row_sha256"] = _row_digest(rows[0])
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
            run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        self.assertTrue(any(trial["invalid_reason"] == "provenance_incomplete" for trial in report["trials"]))
        rows, validity = complete_rows()
        candidate = next(row for row in rows if row["arm"] == "cand")
        candidate["exposure"]["status"] = "control"
        candidate_validity = next(item for item in validity if item["row_key"] == _row_key(candidate))
        candidate_validity["row_sha256"] = _row_digest(candidate)
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
            run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        self.assertTrue(any(trial["invalid_reason"] == "candidate_exposure" for trial in report["trials"]))
        rows, validity = complete_rows()
        rows[0]["split"] = "development"
        validity[0]["row_key"] = _row_key(rows[0])
        validity[0]["row_sha256"] = _row_digest(rows[0])
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
            run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        self.assertTrue(any(trial["invalid_reason"] == "split_binding" for trial in report["trials"]))

    def test_sidecar_extras_and_report_digest_tampering_fail_closed(self) -> None:
        rows, validity = complete_rows()
        validity.append({"row_key": "extra-row-key", "row_sha256": "a" * 64, "void": False})
        with self.assertRaises(RealBaselineError):
            ingest_gate_baseline(
                PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
                run_id="g03-real-run",
                resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
            )
        rows, validity = complete_rows()
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, rows, validity, case_tasks=CASE_TASKS,
            run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        report["trial_count"] += 1
        with self.assertRaises(RealBaselineError):
            validate_real_report(report, PACK, PREREG)


if __name__ == "__main__":
    unittest.main()
