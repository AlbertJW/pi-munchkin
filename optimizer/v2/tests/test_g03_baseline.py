from __future__ import annotations

import copy
import json
import pathlib
import subprocess
import sys
import unittest

from optimizer.v2.baseline import BaselineError, BaselinePreregistration, prepare_baseline, run_offline_baseline, validate_offline_report
from optimizer.v2.benchmark import BenchmarkPack


ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO = ROOT.parent
PACK_PATH = ROOT / "v2/benchmarks/g03-representative-pilot-v1.json"
PREREG_PATH = ROOT / "v2/examples/g03-baseline-preregistration.json"


class G03RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pack = BenchmarkPack.load(PACK_PATH)
        cls.prereg = BaselinePreregistration.load(PREREG_PATH)

    def test_twelve_case_taxonomy_and_artifact_receipts_are_bound(self) -> None:
        self.assertEqual(len(self.pack.all_cases()), 12)
        self.assertEqual(self.pack.taxonomy_counts(), {
            "coding_edit": 2, "failure_recovery": 2, "documentation": 2,
            "long_context": 2, "research_comparative": 1, "research_contested": 1,
            "research_multi_part": 1, "research_fact_lookup": 1,
        })
        records = self.pack.validate_artifacts(REPO)
        self.assertEqual(len(records), 12)
        self.assertTrue(all(record["status"] == "validated" for record in records))

    def test_duplicate_fixture_hashes_are_rejected_across_splits(self) -> None:
        raw = json.loads(PACK_PATH.read_text(encoding="utf-8"))
        raw["splits"]["test"][0]["fixture_sha256"] = raw["splits"]["train"][0]["fixture_sha256"]
        with self.assertRaisesRegex(ValueError, "reuse a fixture"):
            BenchmarkPack.from_dict(raw)

    def test_isolation_allowlist_must_be_relative_and_contained(self) -> None:
        raw = json.loads(PACK_PATH.read_text(encoding="utf-8"))
        raw["splits"]["train"][0]["isolation"]["path_allowlist"] = ["../outside"]
        with self.assertRaisesRegex(ValueError, "path_allowlist"):
            BenchmarkPack.from_dict(raw)

    def test_case_kind_and_versioned_spec_must_agree(self) -> None:
        raw = json.loads(PACK_PATH.read_text(encoding="utf-8"))
        # Point a research case at a coding fixture. The digest is intentionally
        # left unchanged: schema/kind validation must fail before any artifact
        # identity can be trusted.
        raw["splits"]["train"][4]["spec_path"] = "optimizer/real-gate-fixtures/manifests/access-log-triage.json"
        mutated = BenchmarkPack.from_dict(raw)
        with self.assertRaisesRegex(ValueError, "research kind requires"):
            mutated.validate_artifacts(REPO)

        raw = json.loads(PACK_PATH.read_text(encoding="utf-8"))
        raw["splits"]["train"][0]["spec_path"] = "optimizer/research-fixtures/manifests/comparative.json"
        mutated = BenchmarkPack.from_dict(raw)
        with self.assertRaisesRegex(ValueError, "research kind does not match"):
            mutated.validate_artifacts(REPO)

    def test_prepare_binds_pack_and_requires_the_complete_slate(self) -> None:
        prepared = prepare_baseline(self.pack, self.prereg, REPO)
        self.assertEqual(prepared["case_count"], 12)
        self.assertEqual(prepared["split_counts"], {"train": 6, "development": 4, "test": 2})
        self.assertTrue(prepared["development_quarantined"])
        self.assertTrue(prepared["opaque_test_unreachable"])
        bad = copy.deepcopy(self.prereg.raw)
        bad["benchmark_pack"]["revision"] = "other"
        with self.assertRaises(BaselineError):
            prepare_baseline(self.pack, BaselinePreregistration.from_dict(bad), REPO)


class G03OfflineBaselineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pack = BenchmarkPack.load(PACK_PATH)
        cls.prereg = BaselinePreregistration.load(PREREG_PATH)

    def test_offline_report_is_paired_quarantined_and_reconstructable(self) -> None:
        report = run_offline_baseline(self.pack, self.prereg, REPO)
        validate_offline_report(report, self.pack, self.prereg)
        self.assertEqual(report["schema"], "pi.optimizer-baseline-report/v1")
        self.assertEqual(report["evidence_class"], "protocol-only")
        self.assertFalse(report["model_quality_evidence"])
        self.assertEqual(report["trial_count"], 40)
        self.assertFalse(report["opaque_test_cases_evaluated"])
        self.assertTrue(report["development_payloads_quarantined"])
        cells = {(row["case_id"], row["seed"], row["repetition"], row["arm"]) for row in report["trials"]}
        self.assertEqual(len(cells), 40)
        self.assertEqual(set(report["per_case"]), {case.case_id for split in ("train", "development") for case in self.pack.splits[split]})
        self.assertTrue(all(row["child_telemetry"] == "unavailable-contained" for row in report["trials"]))
        self.assertNotIn("prompt", json.dumps(report))

        malformed = json.loads(json.dumps(report))
        malformed["trials"][0]["telemetry"]["authenticated"] = False
        with self.assertRaises(BaselineError):
            validate_offline_report(malformed, self.pack, self.prereg)

        invalid_without_reason = json.loads(json.dumps(report))
        invalid_without_reason["trials"][0]["status"] = "invalid"
        invalid_without_reason["trials"][0]["invalid_reason"] = None
        with self.assertRaisesRegex(BaselineError, "explicit reason"):
            validate_offline_report(invalid_without_reason, self.pack, self.prereg)

    def test_offline_report_is_byte_deterministic(self) -> None:
        first = run_offline_baseline(self.pack, self.prereg, REPO)
        second = run_offline_baseline(self.pack, self.prereg, REPO)
        self.assertEqual(first, second)

    def test_baseline_oracle_accepts_only_the_redacted_contract(self) -> None:
        oracle = REPO / "optimizer/v2/oracles/baseline_shape.py"
        payload = {
            "case_id": "coding-edit-access", "kind": "coding_edit", "arm": "baseline",
            "outcome": "success", "artifact_persisted": True, "verification_passed": True,
            "evidence_coverage": True,
            "source_identity_bound": True, "stop_class": "normal", "child_telemetry": "unavailable-contained",
        }
        completed = subprocess.run([str(oracle)], input=json.dumps(payload), text=True, capture_output=True, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('"passed":true', completed.stdout)
        self.assertNotIn("private", completed.stdout)

    def test_oracle_rejects_missing_evidence_or_unknown_stop_class(self) -> None:
        oracle = REPO / "optimizer/v2/oracles/baseline_shape.py"
        payload = {
            "case_id": "research-comparative", "kind": "research_comparative", "arm": "baseline",
            "outcome": "success", "artifact_persisted": True, "verification_passed": True,
            "evidence_coverage": False, "source_identity_bound": True,
            "stop_class": "model-made-this-up", "child_telemetry": "unavailable-contained",
        }
        completed = subprocess.run([str(oracle)], input=json.dumps(payload), text=True, capture_output=True, check=False)
        self.assertEqual(completed.returncode, 1)
        self.assertIn('"evidence_coverage":false', completed.stdout)
        self.assertIn('"stop_class_valid":false', completed.stdout)

    def test_case_coverage_records_opaque_exclusions(self) -> None:
        report = run_offline_baseline(self.pack, self.prereg, REPO)
        validate_offline_report(report, self.pack, self.prereg)
        coverage = {item["case_id"]: item for item in report["case_coverage"]}
        self.assertEqual(len(coverage), 12)
        self.assertEqual(coverage["research-multipart"]["status"], "excluded")
        self.assertEqual(coverage["research-multipart"]["reason"], "opaque_test_quarantined")
        self.assertEqual(coverage["coding-edit-access"]["status"], "evaluated")
        malformed = json.loads(json.dumps(report))
        malformed["case_coverage"][-1]["reason"] = None
        with self.assertRaisesRegex(BaselineError, "exclusion reason"):
            validate_offline_report(malformed, self.pack, self.prereg)

    def test_preregistration_rejects_non_adoption_subject_or_unknown_fields(self) -> None:
        bad = copy.deepcopy(self.prereg.raw)
        bad["subject_model"]["role"] = "qualification-only"
        with self.assertRaises(BaselineError):
            BaselinePreregistration.from_dict(bad)
        bad = copy.deepcopy(self.prereg.raw)
        bad["unexpected"] = True
        with self.assertRaises(BaselineError):
            BaselinePreregistration.from_dict(bad)


if __name__ == "__main__":
    unittest.main()
