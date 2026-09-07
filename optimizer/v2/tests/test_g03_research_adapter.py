from __future__ import annotations

import copy
import json
import pathlib
import unittest

from optimizer.v2.baseline import BaselinePreregistration
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.research_baseline import ResearchBaselineError, research_artifact_to_row


ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO = ROOT.parent
PACK = BenchmarkPack.load(ROOT / "v2/benchmarks/g03-representative-pilot-v1.json")
PREREG = BaselinePreregistration.load(ROOT / "v2/examples/g03-baseline-preregistration.json")
CASE_ID = "research-comparative"
CASE = PACK.case(CASE_ID)
CASE_TASKS = {case.case_id: f"g03-{case.case_id}" for split in ("train", "development") for case in PACK.splits[split]}


def valid_artifact() -> dict:
    return {
        "schema": "pi.research-trial/v1",
        "case_id": CASE_ID,
        "fixture_id": "compare-http-api-styles",
        "kind": "comparative",
        "run": "g03-research-run",
        "task": CASE_TASKS[CASE_ID],
        "split": "train",
        "arm": "baseline",
        "rep": 1,
        "repetition": 0,
        "model": "qwen36-35b-iq3s",
        "requested_provider": "local-llamacpp",
        "requested_model": "qwen36-35b-iq3s",
        "resolved_provider": "llama",
        "resolved_model": "qwen36-35b-iq3s",
        "config_sha256": PREREG.arms["baseline"]["config_sha256"],
        "surface_sha256": PREREG.arms["baseline"]["surface_sha256"],
        "experiment_sha256": PREREG.sha256,
        "gate_session_id": "session-research-01",
        "serving": {
            "stable": True,
            "pre": {"status": "complete", "full_sha256": "d" * 64},
            "post": {"status": "complete", "full_sha256": "d" * 64},
        },
        "execution_authoritative": True,
        "authoritative": True,
        "status": "complete",
        "authority_reason": "complete",
        "exposure": "control",
        "stop_class": "normal",
        "plan": {"status": "settled", "evidence_validated": True},
        "coverage": {
            "searches": 2,
            "reads": 3,
            "complete": True,
            "truncated": False,
            "failed": False,
            "budget_exhausted": False,
        },
        "citations": [
            {"claim_id": "rest-tradeoff", "url": "https://www.rfc-editor.org/rfc/rfc9110", "parent_validated": True},
            {"claim_id": "graphql-tradeoff", "url": "https://spec.graphql.org/October2021/", "parent_validated": True},
            {"claim_id": "conditional-choice", "url": "https://cloud.google.com/apis/design", "parent_validated": True},
        ],
        "costs": {"tool_calls": 9, "retries": 0, "wall_ms": 1234, "input_tokens": 500, "output_tokens": 200, "compactions": 1},
        "unsupported_claims": 0,
        "unwanted_continuation": 0,
    }


class G03ResearchAdapterTests(unittest.TestCase):
    def test_valid_parent_evidence_emits_redacted_v4_row_and_sidecar(self) -> None:
        row, validity = research_artifact_to_row(valid_artifact(), pack=PACK, prereg=PREREG, repository_root=REPO)
        self.assertEqual(row["schema"], "pi.eval-row/v4")
        self.assertEqual(row["score"], 1)
        self.assertEqual(row["status"], "complete")
        self.assertEqual(row["exposure"]["status"], "control")
        self.assertEqual(row["context"]["provenance"]["session_id"], "session-research-01")
        self.assertEqual(validity, {"row_key": validity["row_key"], "row_sha256": validity["row_sha256"], "void": False})
        encoded = json.dumps(row, sort_keys=True)
        self.assertNotIn("citations", encoded)
        self.assertNotIn("source_contents", encoded)
        self.assertNotIn("transcript", encoded)

    def test_missing_parent_validation_is_a_scored_research_failure(self) -> None:
        artifact = valid_artifact()
        artifact["citations"][0]["parent_validated"] = False
        row, _ = research_artifact_to_row(artifact, pack=PACK, prereg=PREREG, repository_root=REPO)
        self.assertEqual(row["status"], "complete")
        self.assertEqual(row["score"], 0)
        self.assertTrue(row["context"]["research"]["oracle_passed"] is False)

    def test_unsettled_plan_is_non_authoritative(self) -> None:
        artifact = valid_artifact()
        artifact["plan"] = {"status": "in_progress", "evidence_validated": False}
        row, _ = research_artifact_to_row(artifact, pack=PACK, prereg=PREREG, repository_root=REPO)
        self.assertEqual(row["status"], "incomplete")
        self.assertFalse(row["authoritative"])
        self.assertIsNone(row["score"])
        self.assertEqual(row["authority_reason"], "plan_not_settled")

    def test_identity_or_fixture_drift_is_rejected_before_oracle(self) -> None:
        artifact = valid_artifact()
        artifact["fixture_id"] = "other-fixture"
        with self.assertRaisesRegex(ResearchBaselineError, "fixture"):
            research_artifact_to_row(artifact, pack=PACK, prereg=PREREG, repository_root=REPO)
        artifact = valid_artifact()
        artifact["surface_sha256"] = "a" * 64
        with self.assertRaisesRegex(ResearchBaselineError, "surface"):
            research_artifact_to_row(artifact, pack=PACK, prereg=PREREG, repository_root=REPO)


if __name__ == "__main__":
    unittest.main()
