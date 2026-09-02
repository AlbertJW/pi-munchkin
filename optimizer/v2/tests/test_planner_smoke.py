import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT.parent))

from optimizer.v2.planner_smoke import classify_result, run_bounded_command  # noqa: E402


class PlannerSmokeTests(unittest.TestCase):
    def test_classification_prioritises_bound_reason(self):
        self.assertEqual(classify_result(exit_code=-15, reason="output_cap"), "output_cap")
        self.assertEqual(classify_result(exit_code=-15, reason="wall_timeout"), "wall_timeout")
        self.assertEqual(classify_result(exit_code=0, reason=None), "completed")
        self.assertEqual(classify_result(exit_code=3, reason=None), "failed")

    def test_output_cap_is_process_group_bounded_and_summary_has_no_payload(self):
        result = run_bounded_command(
            [sys.executable, "-c", "import sys; sys.stdout.write('x' * 100000); sys.stdout.flush()"],
            cwd=pathlib.Path.cwd(), wall_seconds=5, max_output_bytes=4096,
        )
        self.assertEqual(result.reason, "output_cap")
        self.assertLessEqual(result.stdout_bytes + result.stderr_bytes, 4096)
        self.assertNotIn("x" * 100, json.dumps(result.to_summary()))

    def test_wall_timeout_is_reported_without_retaining_child_output(self):
        result = run_bounded_command(
            [sys.executable, "-c", "import time; print('private', flush=True); time.sleep(10)"],
            cwd=pathlib.Path.cwd(), wall_seconds=0.2, max_output_bytes=4096,
        )
        self.assertEqual(result.reason, "wall_timeout")
        self.assertLessEqual(result.stdout_bytes + result.stderr_bytes, 4096)
        self.assertNotIn("private", json.dumps(result.to_summary()))


if __name__ == "__main__":
    unittest.main()
