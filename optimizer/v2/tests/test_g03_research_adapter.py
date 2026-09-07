from __future__ import annotations

import copy
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

from optimizer.v2.baseline import BaselinePreregistration
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.real_baseline import ingest_gate_baseline
from optimizer.v2.research_baseline import ResearchBaselineError, research_artifact_to_row


ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO = ROOT.parent
PACK_PATH = ROOT / "v2/benchmarks/g03-representative-pilot-v1.json"
PREREG_PATH = ROOT / "v2/examples/g03-baseline-preregistration.json"
PACK = BenchmarkPack.load(PACK_PATH)
PREREG = BaselinePreregistration.load(PREREG_PATH)
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

    def test_reduce_cli_is_artifact_only_and_writes_private_row_pair(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            artifact_path = root / "research-artifact.json"
            row_path = root / "row.json"
            validity_path = root / "row.validity.json"
            artifact_path.write_text(json.dumps(valid_artifact()), encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(ROOT / "v2/research_baseline.py"), "--reduce",
                 "--artifact", str(artifact_path), "--pack", str(PACK_PATH.relative_to(REPO)),
                 "--preregistration", str(PREREG_PATH.relative_to(REPO)), "--repository-root", str(REPO),
                 "--row-output", str(row_path), "--validity-output", str(validity_path)],
                cwd=str(REPO), text=True, capture_output=True, check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            summary = json.loads(completed.stdout)
            self.assertFalse(summary["execution"])
            row = json.loads(row_path.read_text(encoding="utf-8"))
            self.assertEqual(row["schema"], "pi.eval-row/v4")
            self.assertNotIn("citations", json.dumps(row))
            self.assertEqual(json.loads(validity_path.read_text(encoding="utf-8"))["void"], False)

    def test_research_row_is_accepted_by_the_shared_real_baseline_reducer(self) -> None:
        row, validity = research_artifact_to_row(valid_artifact(), pack=PACK, prereg=PREREG, repository_root=REPO)
        report = ingest_gate_baseline(
            PACK, PREREG, REPO, [row], [validity], case_tasks=CASE_TASKS,
            run_id="g03-research-run", resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"},
        )
        trial = next(item for item in report["trials"] if item["case_id"] == CASE_ID and item["arm"] == "baseline")
        self.assertEqual(trial["status"], "completed")
        self.assertEqual(trial["score"], 1)


if __name__ == "__main__":
    unittest.main()
