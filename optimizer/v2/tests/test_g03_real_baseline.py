from __future__ import annotations

import copy
import json
import pathlib
import unittest

from optimizer.v2.baseline import BaselinePreregistration
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.real_baseline import RealBaselineError, _row_digest, _row_key, ingest_gate_baseline, validate_real_report


ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO = ROOT.parent
PACK = BenchmarkPack.load(ROOT / "v2/benchmarks/g03-representative-pilot-v1.json")
PREREG = BaselinePreregistration.load(ROOT / "v2/examples/g03-baseline-preregistration.json")
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

    def test_timeout_and_missing_cells_are_retained_as_non_authoritative(self) -> None:
        row = make_row("coding-edit-access", "base", 1, "session-timeout", timeout=True)
        validity = [{"row_key": _row_key(row), "row_sha256": _row_digest(row), "void": True}]
        report = ingest_gate_baseline(PACK, PREREG, REPO, [row], validity, case_tasks=CASE_TASKS, run_id="g03-real-run", resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"})
        validate_real_report(report, PACK, PREREG)
        self.assertFalse(report["model_quality_evidence"])
        self.assertEqual(sum(trial["status"] == "timeout" for trial in report["trials"]), 1)
        self.assertGreater(sum(trial["status"] == "excluded" for trial in report["trials"]), 0)
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
