from __future__ import annotations

import copy
import json
import pathlib
import stat
import tempfile
import unittest

from optimizer.v2.baseline import BaselinePreregistration
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.research_baseline import research_artifact_to_row
from optimizer.v2.research_runner import (
    ResearchRunnerError,
    build_research_artifact,
    make_cell_request,
    record_research_artifact,
)


ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO = ROOT.parent
PACK_PATH = ROOT / "v2/benchmarks/g03-representative-pilot-r2.json"
PREREG_PATH = ROOT / "v2/examples/g03-baseline-preregistration-r2.json"
PACK = BenchmarkPack.load(PACK_PATH)
PREREG = BaselinePreregistration.load(PREREG_PATH)
CASE_ID = "research-comparative"
CASE = PACK.case(CASE_ID)


def cell_request() -> dict:
    return {
        "schema": "pi.research-cell/v1",
        "case_id": CASE_ID,
        "split": "train",
        "arm": "baseline",
        "rep": 1,
        "repetition": 0,
        "run": "g03-research-run",
        "task": "g03-research-comparative",
        "model": "qwen36-35b-iq3s",
        "requested_provider": "local-llamacpp",
        "resolved_provider": "llama",
        "resolved_model": "qwen36-35b-iq3s",
        "config_sha256": PREREG.arms["baseline"]["config_sha256"],
        "surface_sha256": PREREG.arms["baseline"]["surface_sha256"],
        "experiment_sha256": PREREG.sha256,
        "gate_session_id": "session-research-runner-01",
    }


def serving() -> dict:
    fingerprint = {"status": "complete", "full_sha256": "d" * 64}
    return {"stable": True, "pre": fingerprint, "post": fingerprint}


def process() -> dict:
    return {"reason": "completed", "exit_code": 0, "elapsed_seconds": 1.25}


def parent_report() -> dict:
    return {
        "schema": "pi.research-parent-report/v1",
        "plan": {"status": "settled", "evidence_validated": True},
        "coverage": {
            "searches": 2, "reads": 3, "complete": True,
            "truncated": False, "failed": False, "budget_exhausted": False,
        },
        "citations": [
            {"claim_id": "rest-tradeoff", "url": "https://www.rfc-editor.org/rfc/rfc9110", "parent_validated": True},
            {"claim_id": "graphql-tradeoff", "url": "https://spec.graphql.org/October2021/", "parent_validated": True},
            {"claim_id": "conditional-choice", "url": "https://cloud.google.com/apis/design", "parent_validated": True},
        ],
        "costs": {
            "tool_calls": 9, "retries": 0, "wall_ms": 9999,
            "input_tokens": 500, "output_tokens": 200, "compactions": 1,
        },
        "unsupported_claims": 0,
        "unwanted_continuation": 0,
    }


class G03ResearchRunnerTests(unittest.TestCase):
    def test_completed_parent_report_builds_reducible_authoritative_artifact(self) -> None:
        cell = make_cell_request(PACK, PREREG, cell_request())
        artifact = build_research_artifact(cell, process=process(), serving=serving(), parent_report=parent_report())
        self.assertEqual(artifact["schema"], "pi.research-trial/v1")
        self.assertTrue(artifact["authoritative"])
        self.assertEqual(artifact["status"], "complete")
        self.assertEqual(artifact["costs"]["wall_ms"], 1250)
        row, validity = research_artifact_to_row(artifact, pack=PACK, prereg=PREREG, repository_root=REPO)
        self.assertEqual(row["status"], "complete")
        self.assertEqual(row["score"], 1)
        self.assertFalse(validity["void"])
        self.assertNotIn("quote", json.dumps(artifact))

    def test_missing_parent_report_is_a_bounded_non_authoritative_attempt(self) -> None:
        cell = make_cell_request(PACK, PREREG, cell_request())
        artifact = build_research_artifact(cell, process=process(), serving=serving(), parent_report=None)
        self.assertFalse(artifact["authoritative"])
        self.assertEqual(artifact["authority_reason"], "missing_parent_report")
        self.assertEqual(artifact["status"], "incomplete")
        row, validity = research_artifact_to_row(artifact, pack=PACK, prereg=PREREG, repository_root=REPO)
        self.assertEqual(row["status"], "incomplete")
        self.assertIsNone(row["score"])
        self.assertTrue(validity["void"])

    def test_malformed_parent_report_cannot_inflate_budget_or_authority(self) -> None:
        cell = make_cell_request(PACK, PREREG, cell_request())
        malformed = copy.deepcopy(parent_report())
        malformed["coverage"]["searches"] = 99
        artifact = build_research_artifact(cell, process=process(), serving=serving(), parent_report=malformed)
        self.assertFalse(artifact["authoritative"])
        self.assertEqual(artifact["authority_reason"], "invalid_parent_report")
        self.assertEqual(artifact["coverage"]["searches"], 0)
        self.assertEqual(artifact["coverage"]["reads"], 0)
        self.assertEqual(artifact["costs"]["tool_calls"], 0)

    def test_process_timeout_is_retained_with_safe_parent_metadata(self) -> None:
        cell = make_cell_request(PACK, PREREG, cell_request())
        timed_out = {"reason": "wall_timeout", "exit_code": -15, "elapsed_seconds": 900.0}
        artifact = build_research_artifact(cell, process=timed_out, serving=serving(), parent_report=parent_report())
        self.assertFalse(artifact["authoritative"])
        self.assertEqual(artifact["status"], "timeout")
        self.assertEqual(artifact["stop_class"], "timeout")
        self.assertEqual(artifact["authority_reason"], "wall_timeout")

    def test_record_writes_private_atomic_artifact_and_rejects_escape(self) -> None:
        cell = make_cell_request(PACK, PREREG, cell_request())
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            destination = root / "run" / "research.json"
            result = record_research_artifact(
                destination, run_root=root, cell=cell, pack=PACK, prereg=PREREG,
                process=process(), serving=serving(), parent_report=parent_report(),
            )
            self.assertEqual(result, destination.resolve())
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
            loaded = json.loads(destination.read_text(encoding="utf-8"))
            self.assertEqual(loaded["schema"], "pi.research-trial/v1")
            # Re-recording the same cell is a no-op; a different result cannot
            # overwrite an immutable receipt.
            record_research_artifact(
                destination, run_root=root, cell=cell, pack=PACK, prereg=PREREG,
                process=process(), serving=serving(), parent_report=parent_report(),
            )
            changed = process()
            changed["elapsed_seconds"] = 2.0
            with self.assertRaises(ResearchRunnerError):
                record_research_artifact(
                    destination, run_root=root, cell=cell, pack=PACK, prereg=PREREG,
                    process=changed, serving=serving(), parent_report=parent_report(),
                )
            with self.assertRaises(ResearchRunnerError):
                record_research_artifact(
                    root.parent / "escape.json", run_root=root, cell=cell, pack=PACK, prereg=PREREG,
                    process=process(), serving=serving(), parent_report=parent_report(),
                )

    def test_cli_dry_mode_is_non_executing_and_does_not_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            request_path = root / "request.json"
            process_path = root / "process.json"
            serving_path = root / "serving.json"
            request_path.write_text(json.dumps(cell_request()), encoding="utf-8")
            process_path.write_text(json.dumps(process()), encoding="utf-8")
            serving_path.write_text(json.dumps(serving()), encoding="utf-8")
            completed = __import__("subprocess").run(
                [
                    __import__("sys").executable, str(ROOT / "v2/research_runner.py"), "--dry",
                    "--request", str(request_path), "--process", str(process_path),
                    "--serving", str(serving_path), "--pack", str(PACK_PATH),
                    "--preregistration", str(PREREG_PATH), "--repository-root", str(REPO),
                ], cwd=str(REPO), text=True, capture_output=True, check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            summary = json.loads(completed.stdout)
            self.assertFalse(summary["execution"])
            self.assertFalse((root / "artifact.json").exists())


if __name__ == "__main__":
    unittest.main()
