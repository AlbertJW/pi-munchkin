from __future__ import annotations

import pathlib
import tempfile
import unittest

from optimizer.v2.g03_readiness import (
    ReadinessError,
    assess_readiness,
    run_readiness,
    classify_model_state,
    validate_execution_plan,
    validate_loopback_endpoint,
)
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.pi_gate import PiGateScenario


ROOT = pathlib.Path(__file__).resolve().parents[2]
PACK = ROOT / "v2/benchmarks/g03-representative-pilot-r2.json"
PREREG = ROOT / "v2/examples/g03-baseline-preregistration-r2.json"
MAP = ROOT / "v2/examples/g03-baseline-task-map-r2.json"


class G03ReadinessTests(unittest.TestCase):
    def test_frozen_manifest_paths_reject_symlinks_before_any_probe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            alias = pathlib.Path(directory) / "pack.json"
            alias.symlink_to(PACK)
            with self.assertRaisesRegex(ReadinessError, "symlink"):
                run_readiness(
                    pack_path=alias, preregistration_path=PREREG,
                    repository_root=ROOT.parent, agent_dir=ROOT.parent,
                    case_tasks=MAP, endpoint="not-a-url", model="qwen36-35b-iq3s",
                )

    def test_model_state_requires_the_requested_member_to_be_loaded(self) -> None:
        models = [
            {"id": "qwen36-35b-iq3s", "status": {"value": "unloaded"}},
            {"id": "ling3-tiny-fast", "status": {"value": "loaded"}},
        ]
        self.assertEqual(classify_model_state(models, "qwen36-35b-iq3s"), "unloaded")
        self.assertEqual(classify_model_state(models, "missing"), "absent")
        self.assertEqual(classify_model_state([{ "id": "qwen36-35b-iq3s", "status": {"value": "running"}}], "qwen36-35b-iq3s"), "running")

    def test_loopback_endpoint_rejects_remote_and_credentials(self) -> None:
        self.assertEqual(validate_loopback_endpoint("http://127.0.0.1:8080"), "http://127.0.0.1:8080")
        with self.assertRaises(ReadinessError):
            validate_loopback_endpoint("https://example.com:8080")
        with self.assertRaises(ReadinessError):
            validate_loopback_endpoint("http://user:pass@127.0.0.1:8080")

    def test_assessment_is_not_ready_until_every_identity_and_model_guard_passes(self) -> None:
        blocked = assess_readiness(
            expected_source="a" * 64, actual_source="a" * 64,
            expected_loaded="b" * 64, actual_loaded="b" * 64,
            expected_task_map="c" * 64, actual_task_map="c" * 64,
            expected_model="qwen36-35b-iq3s", model_state="unloaded", health_ok=True,
        )
        self.assertFalse(blocked["ready"])
        self.assertIn("model_unloaded", blocked["reasons"])
        mismatched = assess_readiness(
            expected_source="a" * 64, actual_source="a" * 64,
            expected_loaded="b" * 64, actual_loaded="b" * 64,
            expected_task_map="d" * 64, actual_task_map="c" * 64,
            expected_model="qwen36-35b-iq3s", model_state="running", health_ok=True,
        )
        self.assertEqual(mismatched["reasons"], ["case_task_map_mismatch"])
        ready = assess_readiness(
            expected_source="a" * 64, actual_source="a" * 64,
            expected_loaded="b" * 64, actual_loaded="b" * 64,
            expected_task_map="c" * 64, actual_task_map="c" * 64,
            expected_model="qwen36-35b-iq3s", model_state="running", health_ok=True,
        )
        self.assertTrue(ready["ready"])
        self.assertFalse(ready["inference_started"])

    def test_execution_plan_routes_research_away_from_real_gate(self) -> None:
        mapping = __import__("json").loads(MAP.read_text(encoding="utf-8"))
        plan = validate_execution_plan(BenchmarkPack.load(PACK), mapping, ROOT.parent)
        self.assertEqual(plan["schema"], "pi.g03-execution-plan/v1")
        self.assertEqual(plan["executors"]["research_parent"], ["research-comparative", "research-contested"])
        self.assertEqual(len(plan["executors"]["real_gate"]), 8)
        research = next(item for item in plan["cases"] if item["case_id"] == "research-comparative")
        self.assertEqual(research["executor"], "research_parent")
        coding = next(item for item in plan["cases"] if item["case_id"] == "coding-edit-access")
        self.assertEqual(coding["executor"], "real_gate")
        self.assertTrue(coding["manifest_relpath"].endswith("access-log-triage.json"))

    def test_execution_plan_requires_real_gate_manifest_for_nonresearch_case(self) -> None:
        mapping = __import__("json").loads(MAP.read_text(encoding="utf-8"))
        mapping["coding-edit-access"] = "missing-gate-task"
        with self.assertRaisesRegex(ReadinessError, "real-gate manifest"):
            validate_execution_plan(BenchmarkPack.load(PACK), mapping, ROOT.parent)

    def test_execution_plan_rejects_unsafe_task_ids(self) -> None:
        mapping = __import__("json").loads(MAP.read_text(encoding="utf-8"))
        mapping["coding-edit-access"] = "../escape"
        with self.assertRaisesRegex(ReadinessError, "task identifier"):
            validate_execution_plan(BenchmarkPack.load(PACK), mapping, ROOT.parent)

    def test_pi_gate_refuses_a_research_benchmark_at_construction(self) -> None:
        pack = BenchmarkPack.load(PACK)
        mapping = {case.case_id: case.case_id for case in pack.all_cases()}
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "cannot execute research"):
                PiGateScenario(
                    ROOT, pack, None, pathlib.Path(directory) / "run",
                    {
                        "case_tasks": mapping, "model_control": "llama", "gate_network": "endpoint",
                        "llama_endpoint": {"scheme": "http", "host": "loopback", "port": 8080},
                        "model_registry_sha256": "a" * 64,
                    }, None,
                )


if __name__ == "__main__":
    unittest.main()
