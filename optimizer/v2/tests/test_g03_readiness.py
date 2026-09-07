from __future__ import annotations

import unittest

from optimizer.v2.g03_readiness import (
    ReadinessError,
    assess_readiness,
    classify_model_state,
    validate_loopback_endpoint,
)


class G03ReadinessTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
