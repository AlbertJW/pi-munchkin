#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


LAB = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


screen = load("span_screen", LAB / "span_screen.py")
metrics = load("span_metrics", LAB.parent / "ab-machinery" / "metrics.py")
trajectory = load("span_trajectory", LAB / "trajectory_check.py")


class SpanScreenTests(unittest.TestCase):
    def setUp(self):
        self.manifest = screen.load_manifest()

    def rows(self, *, exposure=True, receipts=True, drift=False):
        rows = []
        cells = {cell["arm"]: cell for cell in self.manifest["cells"]}
        for arm in ("base", "cand"):
            for rep in range(1, 7):
                cell = cells[arm]
                trajectory_metrics = {name: 0 for name in screen.TRAJECTORY_METRICS}
                trajectory_metrics.update(search_spans=int(arm == "cand" and exposure),
                                          read_span=int(arm == "cand" and exposure), reads=2,
                                          repeat_reads=1, tool_result_chars=100)
                rows.append({
                    "schema": "pi.eval-row/v2", "pattern": arm, "arm": arm, "task": "bigdata",
                    "split": "val", "rep": rep, "repetition": rep, "score": 1,
                    "authoritative": True, "status": "complete", "model": "model-a", "run": "run-a",
                    "prompt": {"variant": "canonical"},
                    "execution": {"provider": "llama", "endpoint_identity_sha256": "e" * 64},
                    "serving": {"stable": True,
                                "pre": {"status": "complete", "fingerprint_sha256": "s" * 64},
                                "post": {"status": "complete", "fingerprint_sha256": "s" * 64}},
                    "fixture": {"cohort": "2026-07", "version": "1"},
                    "usage": {"exact": True}, "in_tok": 10, "out_tok": 5,
                    "trajectory": trajectory_metrics,
                    "span_receipt_success": bool(arm == "cand" and receipts),
                    "experiment": {"manifest_sha256": "0" * 64 if drift else self.manifest["manifest_sha256"],
                                   "cell": cell["id"]},
                    "config": {"sha256": cell["config_sha256"], "declared_env": cell["declared_env"],
                               "rendered_governor_sha256": "d" * 64},
                    "harness": {"surface_sha256": None, "hash_blocker": "loaded surface unavailable"},
                    "context": {
                        "schema": "pi.context-telemetry/v1", "authenticated": True,
                        "content_sha256": "c" * 64, "session_key": "run-a", "events": 1,
                        "config": {"enabled": True, "thresholdPct": 70, "rearmPct": 55},
                        "compactions": {"total": 0, "watcher": 0, "pi": 0, "compact_tool": 0,
                                         "manual_unknown": 0, "extension_content": 0, "threshold": 0,
                                         "overflow": 0, "manual": 0, "will_retry": 0},
                        "watcher": {"requests": 0, "completed": 0, "failed": 0,
                                    "thrash_silenced": 0, "resume_required": 0, "estimates": []},
                    },
                })
        return rows

    def test_manifest_is_one_valid_comparison(self):
        self.assertEqual([("span-off", "base"), ("span-on", "cand")],
                         [(c["id"], c["arm"]) for c in self.manifest["cells"]])
        self.assertEqual(6, self.manifest["defaults"]["reps"])
        self.assertEqual("0.05", self.manifest["defaults"]["execution"]["FLEET_ALPHA"])

    def test_eval_row_schema_declares_span_and_provenance_additively(self):
        schema = json.loads((LAB.parent / "real-gate-fixtures" / "schemas" /
                             "pi.eval-row-v2.schema.json").read_text(encoding="utf-8"))
        trajectory = schema["properties"]["trajectory"]["properties"]
        self.assertIn("search_spans", trajectory); self.assertIn("read_span", trajectory)
        for field in ("span_receipt_success", "config", "experiment", "harness"):
            self.assertIn(field, schema["properties"])
            self.assertNotIn(field, schema["required"])
        conditional = schema["allOf"][1]
        self.assertEqual({"type": "object"}, conditional["if"]["properties"]["experiment"])
        self.assertEqual(["search_spans", "read_span"],
                         conditional["then"]["properties"]["trajectory"]["required"])
        self.assertIn("context", conditional["then"]["required"])

    def test_treatment_counts_across_attempts(self):
        lines = []
        for name in ("search_spans", "read_span", "search_spans"):
            lines.append(json.dumps({"type": "message", "message": {"role": "assistant", "content": [
                {"type": "toolCall", "name": name, "arguments": {"path": "data/events.jsonl"}}]}}))
        result = metrics.parse_session(lines)
        self.assertEqual((2, 1), (result["search_spans"], result["read_span"]))

    def test_receipt_can_come_from_retry_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            corpus = Path(temporary) / "events.jsonl"; corpus.write_text('{"x":1}\n', encoding="utf-8")
            facts = trajectory.file_facts(corpus)
            valid = {"schema": "pi.tool-receipt/v1", "operation": "search_spans",
                     "normalized_file": facts["path"], "sha256": facts["sha256"],
                     "size_bytes": facts["size"], "bytes_examined": facts["size"],
                     "total_lines_scanned": facts["lines"], "complete": True}
            messages = [
                {"role": "assistant", "content": [{"type": "toolCall", "id": "first", "name": "search_spans", "arguments": {}}]},
                {"role": "toolResult", "toolCallId": "first", "details": {"receipt": {}}},
                {"role": "assistant", "content": [{"type": "toolCall", "id": "retry", "name": "search_spans", "arguments": {}}]},
                {"role": "toolResult", "toolCallId": "retry", "details": {"receipt": valid}},
            ]
            self.assertTrue(trajectory.check_bigdata(messages, corpus)[0])

    def test_zero_exposure_and_missing_receipts_are_ineligible(self):
        text, eligible = screen.mechanism_report(self.rows(exposure=False, receipts=False), self.manifest)
        self.assertFalse(eligible); self.assertIn("INELIGIBLE", text)
        self.assertIn("zero span-tool exposure", text)
        self.assertIn("lack exhaustive", text)

    def test_missing_rendered_governor_hash_is_ineligible(self):
        rows = self.rows()
        del rows[0]["config"]["rendered_governor_sha256"]
        text, eligible = screen.mechanism_report(rows, self.manifest)
        self.assertFalse(eligible)
        self.assertIn("rendered_governor_sha256 missing or malformed", text)

    def test_malformed_rendered_governor_hash_is_ineligible(self):
        rows = self.rows()
        rows[0]["config"]["rendered_governor_sha256"] = "not-a-hash"
        text, eligible = screen.mechanism_report(rows, self.manifest)
        self.assertFalse(eligible)
        self.assertIn("rendered_governor_sha256 missing or malformed", text)

    def test_default_rows_report_same_run_screen_only(self):
        text, eligible = screen.mechanism_report(self.rows(), self.manifest)
        self.assertTrue(eligible)
        self.assertIn("SAME-RUN SCREEN ONLY", text)
        self.assertIn("REPRODUCIBILITY BLOCKER", text)
        self.assertNotIn("VERIFIED HARNESS SURFACE", text)

    def test_fully_corroborated_harness_hash_reports_verified_not_blocked(self):
        rows = self.rows()
        for row in rows:
            row["harness"] = {"surface_sha256": "b" * 64, "hash_blocker": ""}
            row["context"]["harness_surface_sha256"] = "b" * 64
        text, eligible = screen.mechanism_report(rows, self.manifest)
        self.assertTrue(eligible)
        self.assertIn("VERIFIED HARNESS SURFACE", text)
        self.assertIn("## HARNESS SURFACE", text)
        self.assertNotIn("REPRODUCIBILITY BLOCKER", text)

    def test_one_row_with_broken_corroboration_is_ineligible(self):
        # A hash present but not matching the row's own authenticated telemetry is
        # rejected outright (existing per-row check) — confirms a single broken row
        # among otherwise-corroborated ones still fails the whole comparison, not
        # just silently downgrading the report's status.
        rows = self.rows()
        for row in rows:
            row["harness"] = {"surface_sha256": "b" * 64, "hash_blocker": ""}
            row["context"]["harness_surface_sha256"] = "b" * 64
        rows[0]["context"]["harness_surface_sha256"] = "c" * 64  # one row's corroboration breaks
        text, eligible = screen.mechanism_report(rows, self.manifest)
        self.assertFalse(eligible)
        self.assertIn("not corroborated by authenticated telemetry", text)

    def test_provenance_hash_drift_is_ineligible(self):
        text, eligible = screen.mechanism_report(self.rows(drift=True), self.manifest)
        self.assertFalse(eligible); self.assertIn("manifest provenance drift", text)

    def test_malformed_or_incomplete_rows_are_ineligible(self):
        mutations = [
            lambda rows: rows[0].update(schema="legacy"),
            lambda rows: rows[0].update(rep=2, repetition=2),
            lambda rows: rows[0].update(authoritative=False),
            lambda rows: rows[0].update(score=2),
            lambda rows: rows[0]["execution"].update(provider=""),
            lambda rows: rows[0].update(run="different-run"),
            lambda rows: rows[0].update(arm="cand"),
            lambda rows: rows[0].update(rep=True, repetition=True),
            lambda rows: rows[0].update(rep="1", repetition="1"),
            lambda rows: rows[0].update(span_receipt_success=None),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                rows = self.rows(); mutate(rows)
                self.assertFalse(screen.mechanism_report(rows, self.manifest)[1])

    def test_ineligible_evidence_never_invokes_fleet_and_replaces_stale_verdict(self):
        calls = []
        with tempfile.TemporaryDirectory() as temporary:
            old_results = screen.RESULTS; screen.RESULTS = Path(temporary)
            try:
                gen = "ineligible-test"
                stale = Path(temporary) / f"{gen}-FLEET.md"
                stale.write_text("## VERDICT: ADOPT-UNIVERSAL\n", encoding="utf-8")
                def fake_run(command, **kwargs):
                    calls.append(command)
                    rows = self.rows(exposure=False, receipts=False)
                    (Path(temporary) / f"{gen}.jsonl").write_text(
                        "\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
                    return mock.Mock(returncode=0)
                with self.assertRaises(screen.ScreenIneligible):
                    screen.execute(self.manifest, gen, False, fake_run)
                marker = stale.read_text(encoding="utf-8")
            finally:
                screen.RESULTS = old_results
        self.assertEqual([[str(screen.REAL_GATE), "bigdata"]], calls)
        self.assertIn("INELIGIBLE", marker); self.assertNotIn("ADOPT", marker)

    def test_reduced_env_and_declared_endpoint_win(self):
        calls = []
        with tempfile.TemporaryDirectory() as temporary:
            old_results = screen.RESULTS; screen.RESULTS = Path(temporary)
            try:
                gen = "env-test"
                def fake_run(command, **kwargs):
                    calls.append((command, kwargs))
                    if command[0] == str(screen.REAL_GATE):
                        (Path(temporary) / f"{gen}.jsonl").write_text(
                            "\n".join(json.dumps(row) for row in self.rows()) + "\n", encoding="utf-8")
                    return mock.Mock(returncode=0)
                inherited = {"SPAN_TEST_SECRET": "hidden", "GATE_NETWORK": "open",
                             "FLEET_ALPHA": "0.0001", "MIN_SESSION_OUTPUT": "999999"}
                with mock.patch.dict(os.environ, inherited):
                    self.assertTrue(screen.execute(self.manifest, gen, False, fake_run))
            finally:
                screen.RESULTS = old_results
        self.assertEqual(2, len(calls))
        env = calls[0][1]["env"]
        self.assertEqual("endpoint", env["GATE_NETWORK"]); self.assertEqual("0.05", env["FLEET_ALPHA"])
        self.assertNotIn("SPAN_TEST_SECRET", env); self.assertNotIn("MIN_SESSION_OUTPUT", env)
        self.assertEqual("model-a", calls[1][1]["env"]["FLEET_DD"])
        self.assertNotIn("shell", calls[0][1]); self.assertNotIn("shell", calls[1][1])

    def test_dry_has_no_writes_and_paths_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            old_results = screen.RESULTS; screen.RESULTS = Path(temporary)
            try:
                runner = mock.Mock(side_effect=AssertionError("dry invoked child"))
                self.assertTrue(screen.execute(self.manifest, "dry-test", True, runner))
                self.assertEqual([], list(Path(temporary).iterdir()))
                runner.assert_not_called()
                with self.assertRaises(screen.ScreenError): screen.result_paths("../escape")
            finally:
                screen.RESULTS = old_results


if __name__ == "__main__":
    unittest.main()
