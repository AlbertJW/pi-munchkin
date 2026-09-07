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
            "source_identity_bound": True, "stop_class": "normal", "child_telemetry": "unavailable-contained",
        }
        completed = subprocess.run([str(oracle)], input=json.dumps(payload), text=True, capture_output=True, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('"passed":true', completed.stdout)
        self.assertNotIn("private", completed.stdout)

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
