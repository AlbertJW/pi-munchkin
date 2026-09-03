import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT.parent))

from optimizer.v2.planner_smoke import (  # noqa: E402
    arm_spec, build_planner_env, build_pi_command, classify_result,
    fixture_spec, run_bounded_command,
)


class PlannerSmokeTests(unittest.TestCase):
    def test_fixture_manifest_is_canonically_bound_and_supplies_prompt(self):
        fixture = fixture_spec(
            ROOT / "research-fixtures/manifests/compare-json-yaml-config.json",
            expected_sha256="c59fd0a480fc370b17e3df7fb8fccbbbf0279b2932ef6049791f7cd03adab646",
        )
        self.assertEqual(fixture["fixture_id"], "compare-json-yaml-config")
        self.assertEqual(fixture["kind"], "comparative")
        self.assertIn("one bounded evidence branch", fixture["prompt"])
        self.assertEqual(fixture["fixture_sha256"], "c59fd0a480fc370b17e3df7fb8fccbbbf0279b2932ef6049791f7cd03adab646")

    def test_fixture_manifest_digest_mismatch_fails_closed(self):
        with self.assertRaises(ValueError):
            fixture_spec(
                ROOT / "research-fixtures/manifests/compare-json-yaml-config.json",
                expected_sha256="0" * 64,
            )

    def test_fixture_manifest_can_supply_only_its_negative_control(self):
        fixture = fixture_spec(
            ROOT / "research-fixtures/manifests/compare-json-yaml-config.json",
            expected_sha256="c59fd0a480fc370b17e3df7fb8fccbbbf0279b2932ef6049791f7cd03adab646",
            negative_control=True,
        )
        self.assertEqual(fixture["fixture_role"], "negative_control")
        self.assertIn("two JSON structural types", fixture["prompt"])

    def test_candidate_and_control_arms_have_distinct_bound_flags(self):
        candidate = arm_spec("candidate")
        control = arm_spec("control")
        self.assertEqual(candidate["flags"]["PLAN_GRAPH"], "on")
        self.assertEqual(candidate["flags"]["DEEP_RESEARCH_PLANNING"], "on")
        self.assertEqual(control["flags"]["PLAN_GRAPH"], "off")
        self.assertEqual(control["flags"]["DEEP_RESEARCH_PLANNING"], "off")
        self.assertNotEqual(candidate["config_sha256"], control["config_sha256"])

    def test_control_environment_cannot_inherit_graph_lease_or_parent_flags(self):
        env = build_planner_env(
            arm="control", agent_dir=pathlib.Path("/private/agent"),
            expected_surface="a" * 64, telemetry_path=pathlib.Path("/private/t.jsonl"),
            base_env={"PLAN_GRAPH": "on", "DEEP_RESEARCH_PLANNING": "on", "PI_MUNCHKIN_HEADLESS_PLAN": "on"},
        )
        self.assertEqual(env["PLAN_GRAPH"], "off")
        self.assertEqual(env["DEEP_RESEARCH_PLANNING"], "off")
        self.assertEqual(env["RESEARCH_LEDGER"], "on")
        self.assertNotIn("PI_MUNCHKIN_HEADLESS_PLAN", env)

    def test_explicit_thinking_is_pinned_in_the_model_command(self):
        command = build_pi_command(
            pi_bin="pi", model="local-llamacpp/qwen36-35b-iq3s",
            prompt="bounded probe", thinking="minimal",
        )
        self.assertEqual(command[-3:], ["--thinking", "minimal", "bounded probe"])

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
