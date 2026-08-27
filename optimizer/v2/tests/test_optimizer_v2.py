from __future__ import annotations

import hashlib
import json
import os
import pathlib
import tempfile
import time
import unittest

from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.candidates import Candidate, CandidateError, compose_candidates
from optimizer.v2.engine import CampaignEngine, InjectedCrash
from optimizer.v2.events import EventStore, EventStoreError
from optimizer.v2.fake import FakeProvider, FakeScenario, FakeSurface
from optimizer.v2.manifest import ManifestError, load_campaign
from optimizer.v2.pi_gate import PiGateEvidenceError, load_fresh_gate_evidence, validate_gate_evidence
from optimizer.v2.surface import PatchSurfaceAdapter
from optimizer.v2.cli import _assert_run_root_outside_git


HEX = "a" * 64


def campaign_dict() -> dict:
    return {
        "schema": "pi.optimizer-campaign/v2",
        "campaign_id": "offline-smoke",
        "primary_metric": {
            "name": "task_success",
            "direction": "maximize",
            "kind": "binary",
            "paired_policy": {"name": "exact-sign", "minimum_net_fixes": 1},
        },
        "hard_guards": [
            {"metric": "security_failures", "direction": "at_most", "threshold": 0}
        ],
        "optimizer_provider": {"plugin": "fake", "config": {}},
        "surface_adapter": {"plugin": "fake", "config": {}},
        "subject_model": {"provider": "fake", "model": "subject"},
        "guard_models": [{"provider": "fake", "model": "guard"}],
        "benchmark": {
            "plugin": "fake",
            "pack_id": "tiny-pack",
            "revision": "r1",
            "manifest": "benchmark.json",
            "discrimination_band": {"minimum": 0.2, "maximum": 0.8, "minimum_cases": 2},
        },
        "permitted_surface_families": ["capability", "steering"],
        "seeds": [7, 11],
        "limits": {
            "iterations": 1,
            "rollouts_per_candidate": 6,
            "provider_sessions": 8,
            "wall_seconds": 120,
            "case_timeout_seconds": 10,
        },
        "provenance": {
            "source_sha256": HEX,
            "config_sha256": "b" * 64,
            "surface_sha256": "c" * 64,
        },
    }


def benchmark_dict() -> dict:
    def cases(prefix: str, count: int) -> list[dict]:
        return [
            {
                "id": f"{prefix}-{index}",
                "fixture_sha256": hashlib.sha256(f"{prefix}-{index}".encode()).hexdigest(),
                "admission_receipt_sha256": hashlib.sha256(f"receipt-{prefix}-{index}".encode()).hexdigest(),
            }
            for index in range(count)
        ]

    return {
        "schema": "pi.optimizer-benchmark-pack/v1",
        "pack_id": "tiny-pack",
        "revision": "r1",
        "metric": "task_success",
        "splits": {"train": cases("train", 3), "development": cases("dev", 2), "test": cases("test", 2)},
    }


class ManifestTests(unittest.TestCase):
    def test_manifest_is_strict_and_content_addressed(self) -> None:
        campaign = load_campaign(campaign_dict())
        self.assertEqual(campaign.schema, "pi.optimizer-campaign/v2")
        self.assertEqual(len(campaign.sha256), 64)
        mutated = campaign_dict()
        mutated["surprise"] = True
        with self.assertRaisesRegex(ManifestError, "unknown field"):
            load_campaign(mutated)

    def test_unresolved_or_malformed_identity_fails(self) -> None:
        malformed = campaign_dict()
        malformed["provenance"]["surface_sha256"] = "pending"
        with self.assertRaisesRegex(ManifestError, "surface_sha256"):
            load_campaign(malformed)

    def test_run_root_inside_repository_is_rejected(self) -> None:
        repository = pathlib.Path(__file__).resolve().parents[3]
        with self.assertRaisesRegex(ValueError, "outside Git ancestry"):
            _assert_run_root_outside_git(repository / "optimizer" / "v2-runs")
        malformed = campaign_dict()
        malformed["guard_models"] = [{"provider": "", "model": "guard"}]
        with self.assertRaises(ManifestError):
            load_campaign(malformed)


class BenchmarkTests(unittest.TestCase):
    def test_split_disjointness_and_revision_binding(self) -> None:
        pack = BenchmarkPack.from_dict(benchmark_dict())
        self.assertEqual(pack.pack_id, "tiny-pack")
        overlap = benchmark_dict()
        overlap["splits"]["test"][0] = overlap["splits"]["train"][0]
        with self.assertRaisesRegex(ValueError, "disjoint"):
            BenchmarkPack.from_dict(overlap)


class CandidateTests(unittest.TestCase):
    def test_candidate_identity_is_stable_and_workspace_independent(self) -> None:
        kwargs = dict(
            parent_ids=("seed",),
            mutation_family="capability",
            hypothesis="Expose a bounded retrieval capability",
            predicted_mechanism="fewer failed reads",
            expected_exposure="retrieval-capability-used",
            diff="--- a/prompt\n+++ b/prompt\n@@\n-old\n+new\n",
            changed_units=("skills/retrieve",),
            provenance={"provider_session": "session-1"},
        )
        first = Candidate.create(**kwargs)
        second = Candidate.create(**kwargs)
        self.assertEqual(first.candidate_id, second.candidate_id)
        self.assertNotIn("workspace", first.to_dict())

    def test_composition_rejects_conflicts_and_unaccepted_parents(self) -> None:
        left = Candidate.create(parent_ids=("seed",), mutation_family="capability", hypothesis="h", predicted_mechanism="m", expected_exposure="e", diff="left", changed_units=("skills/a",), provenance={})
        right = Candidate.create(parent_ids=("seed",), mutation_family="steering", hypothesis="h2", predicted_mechanism="m2", expected_exposure="e2", diff="right", changed_units=("skills/a",), provenance={})
        with self.assertRaisesRegex(CandidateError, "conflict"):
            compose_candidates(left, right, accepted_ids={left.candidate_id, right.candidate_id})
        clean = Candidate.create(parent_ids=("seed",), mutation_family="steering", hypothesis="h3", predicted_mechanism="m3", expected_exposure="e3", diff="clean", changed_units=("prompts/b",), provenance={})
        with self.assertRaisesRegex(CandidateError, "accepted"):
            compose_candidates(left, clean, accepted_ids={left.candidate_id})

    def test_patch_surface_rejects_path_escape_and_unauthorized_family(self) -> None:
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as workspaces:
            adapter = PatchSurfaceAdapter(pathlib.Path(source), pathlib.Path(workspaces), {"capability": ("skills/",)})
            manifest = load_campaign(campaign_dict())
            parent = FakeSurface().seed_candidate(manifest)
            with self.assertRaisesRegex(CandidateError, "contained"):
                adapter.build_candidate(parent, {"family": "capability", "diff": "--- a/../secret\n+++ b/../secret\n", "changed_units": ["../secret"]}, manifest)
            with self.assertRaisesRegex(CandidateError, "unauthorized"):
                adapter.build_candidate(parent, {"family": "steering", "diff": "--- a/prompts/x\n+++ b/prompts/x\n", "changed_units": ["prompts/x"]}, manifest)


class EventStoreTests(unittest.TestCase):
    def test_append_is_fsynced_idempotent_and_replayable(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = EventStore(pathlib.Path(td))
            one = store.append("op-1", "campaign.prepared", {"sha256": HEX})
            duplicate = store.append("op-1", "campaign.prepared", {"sha256": HEX})
            self.assertEqual(one, duplicate)
            self.assertEqual(len(store.read_all()), 1)
            self.assertEqual(store.project()["campaign"]["sha256"], HEX)
            self.assertEqual(os.stat(store.events_path).st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(EventStoreError, "operation ID collision"):
                store.append("op-1", "campaign.prepared", {"sha256": "b" * 64})

    def test_malformed_log_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = EventStore(pathlib.Path(td))
            store.events_path.write_text('{"partial":', encoding="utf-8")
            with self.assertRaisesRegex(EventStoreError, "line 1"):
                store.read_all()

    def test_run_has_one_nonblocking_writer(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            first = EventStore(pathlib.Path(td))
            second = EventStore(pathlib.Path(td))
            with first.campaign_lock():
                with self.assertRaisesRegex(EventStoreError, "another optimizer writer"):
                    with second.campaign_lock():
                        pass


class EngineTests(unittest.TestCase):
    def test_full_fake_campaign_selects_review_only_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            manifest = load_campaign(campaign_dict())
            provider = FakeProvider()
            scenario = FakeScenario(BenchmarkPack.from_dict(benchmark_dict()))
            engine = CampaignEngine(manifest, EventStore(pathlib.Path(td)), scenario, FakeSurface(), provider)
            result = engine.run(approve_sha=manifest.sha256)
            self.assertEqual(result["status"], "complete")
            self.assertTrue(result["selected_candidate_id"].startswith("sha256:"))
            self.assertFalse(result["deployment_performed"])
            self.assertEqual(provider.calls_by_kind, {"diagnose_patch": 1, "reflect": 1, "evolve": 1})
            self.assertNotIn("development", json.dumps(provider.evidence_seen))
            self.assertTrue((pathlib.Path(td) / "review-packet.json").is_file())

    def test_resume_after_each_transition_does_not_duplicate_calls(self) -> None:
        manifest = load_campaign(campaign_dict())
        with tempfile.TemporaryDirectory() as baseline_td:
            baseline_store = EventStore(pathlib.Path(baseline_td))
            CampaignEngine(manifest, baseline_store, FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), FakeProvider()).run(approve_sha=manifest.sha256)
            transition_count = len(baseline_store.read_all())
        for crash_after in range(1, transition_count + 1):
            with self.subTest(crash_after=crash_after), tempfile.TemporaryDirectory() as td:
                provider = FakeProvider()
                scenario = FakeScenario(BenchmarkPack.from_dict(benchmark_dict()))
                store = EventStore(pathlib.Path(td))
                crashing = CampaignEngine(manifest, store, scenario, FakeSurface(), provider, crash_after_transition=crash_after)
                try:
                    crashing.run(approve_sha=manifest.sha256)
                except InjectedCrash:
                    pass
                resumed = CampaignEngine(manifest, store, scenario, FakeSurface(), provider)
                result = resumed.run(approve_sha=manifest.sha256)
                self.assertEqual(result["status"], "complete")
                self.assertLessEqual(provider.calls_by_kind.get("diagnose_patch", 0), 1)
                self.assertLessEqual(provider.calls_by_kind.get("reflect", 0), 1)
                self.assertLessEqual(provider.calls_by_kind.get("evolve", 0), 1)

    def test_approval_hash_mismatch_prevents_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            manifest = load_campaign(campaign_dict())
            provider = FakeProvider()
            engine = CampaignEngine(manifest, EventStore(pathlib.Path(td)), FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), provider)
            with self.assertRaisesRegex(ValueError, "approval"):
                engine.run(approve_sha="d" * 64)
            self.assertEqual(provider.calls_by_kind, {})

    def test_multiple_iterations_evolve_without_promoting_a_non_improvement(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            raw = campaign_dict(); raw["limits"]["iterations"] = 2
            manifest = load_campaign(raw); provider = FakeProvider()
            result = CampaignEngine(manifest, EventStore(pathlib.Path(td)), FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), provider).run(approve_sha=manifest.sha256)
            self.assertEqual(result["status"], "complete")
            self.assertEqual(provider.calls_by_kind, {"diagnose_patch": 2, "reflect": 2, "evolve": 2})
            self.assertFalse(result["training_decision"]["accepted"])

    def test_missing_exposure_guard_regression_and_malformed_provider_cannot_advance(self) -> None:
        class NoExposure(FakeScenario):
            def evaluate_pair(self, *args, **kwargs):
                value = super().evaluate_pair(*args, **kwargs); value["candidate"]["mechanism_exposed"] = False; return value
        class GuardRegression(FakeScenario):
            def evaluate_pair(self, *args, **kwargs):
                value = super().evaluate_pair(*args, **kwargs); value["candidate"]["guards"]["security_failures"] = 1; return value
        class Malformed(FakeProvider):
            def session(self, kind, payload, *, operation_id):
                value = super().session(kind, payload, operation_id=operation_id)
                if kind == "diagnose_patch": value["unknown"] = True
                return value
        for scenario_type in (NoExposure, GuardRegression):
            with self.subTest(scenario=scenario_type.__name__), tempfile.TemporaryDirectory() as td:
                manifest = load_campaign(campaign_dict()); scenario = scenario_type(BenchmarkPack.from_dict(benchmark_dict()))
                result = CampaignEngine(manifest, EventStore(pathlib.Path(td)), scenario, FakeSurface(), FakeProvider()).run(approve_sha=manifest.sha256)
                self.assertFalse(result["training_decision"]["accepted"])
                self.assertEqual(result["selected_candidate_id"], FakeSurface().seed_candidate(manifest).candidate_id)
        with tempfile.TemporaryDirectory() as td:
            manifest = load_campaign(campaign_dict())
            with self.assertRaisesRegex(ValueError, "unknown fields"):
                CampaignEngine(manifest, EventStore(pathlib.Path(td)), FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), Malformed()).run(approve_sha=manifest.sha256)

    def test_uninformative_calibration_and_rollout_inflation_stop_fail_closed(self) -> None:
        class Uninformative(FakeScenario):
            def calibrate(self, campaign, *, model): return {"status": "uninformative", "model": model, "selected_case_ids": []}
        with tempfile.TemporaryDirectory() as td:
            manifest = load_campaign(campaign_dict())
            result = CampaignEngine(manifest, EventStore(pathlib.Path(td)), Uninformative(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), FakeProvider()).run(approve_sha=manifest.sha256)
            self.assertEqual(result["status"], "uninformative_benchmark")
        with tempfile.TemporaryDirectory() as td:
            raw = campaign_dict(); raw["limits"]["rollouts_per_candidate"] = 5
            manifest = load_campaign(raw)
            with self.assertRaisesRegex(ValueError, "rollout budget"):
                CampaignEngine(manifest, EventStore(pathlib.Path(td)), FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), FakeProvider()).run(approve_sha=manifest.sha256)

    def test_resume_respects_original_wall_clock_budget(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            manifest = load_campaign(campaign_dict()); store = EventStore(pathlib.Path(td))
            store.append("campaign:prepare", "campaign.prepared", {
                "schema": manifest.schema, "campaign_id": manifest.campaign_id, "sha256": manifest.sha256,
                "provenance": manifest.provenance,
                "benchmark": {"pack_id": manifest.benchmark["pack_id"], "revision": manifest.benchmark["revision"]},
            })
            store.append("campaign:approve", "campaign.approved", {"approved_sha256": manifest.sha256, "scope": "one-campaign", "started_unix_ns": time.time_ns() - 200 * 1_000_000_000})
            provider = FakeProvider()
            result = CampaignEngine(manifest, store, FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), provider).run(approve_sha=manifest.sha256)
            self.assertEqual(result["status"], "budget_exhausted")
            self.assertEqual(provider.calls_by_kind, {})


class PiGateTests(unittest.TestCase):
    def test_only_fresh_authoritative_bound_v4_rows_are_accepted(self) -> None:
        row = {
            "schema": "pi.eval-row/v4",
            "task": "t1",
            "model": "subject",
            "arm": "candidate",
            "run": "run-1",
            "status": "complete",
            "score": 1,
            "authoritative": True,
            "gate_session_id": "session-1",
            "harness": {"surface_sha256": "c" * 64},
            "config": {"sha256": "b" * 64},
            "experiment": {"manifest_sha256": HEX},
            "execution": {"authoritative": True},
            "serving": {
                "stable": True,
                "pre": {"status": "complete", "full_sha256": "d" * 64},
                "post": {"status": "complete", "full_sha256": "d" * 64},
            },
            "context": {"schema": "pi.context-telemetry/v4", "authenticated": True},
            "exposure": {"status": "exposed"},
        }
        digest = hashlib.sha256(json.dumps(row, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        validity = {"row_key": "run-1:subject:None:t1:candidate:None:canonical", "row_sha256": digest, "void": False, "void_reasons": []}
        accepted = validate_gate_evidence([row], [validity], campaign_sha256=HEX, config_sha256="b" * 64, surface_sha256="c" * 64)
        self.assertEqual(accepted, [row])
        broken = dict(row, authoritative=False)
        with self.assertRaises(PiGateEvidenceError):
            validate_gate_evidence([broken], [validity], campaign_sha256=HEX, config_sha256="b" * 64, surface_sha256="c" * 64)

    def test_gate_files_must_be_fresh_and_complete(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            results = pathlib.Path(td) / "rows.jsonl"; sidecar = pathlib.Path(str(results) + ".validity.jsonl")
            results.write_text('{"row":1}\n', encoding="utf-8"); sidecar.write_text('{"verdict":1}\n', encoding="utf-8")
            before = min(results.stat().st_mtime_ns, sidecar.stat().st_mtime_ns)
            rows, verdicts = load_fresh_gate_evidence(results, not_before_ns=before)
            self.assertEqual((len(rows), len(verdicts)), (1, 1))
            with self.assertRaisesRegex(PiGateEvidenceError, "stale"):
                load_fresh_gate_evidence(results, not_before_ns=max(results.stat().st_mtime_ns, sidecar.stat().st_mtime_ns) + 1)


if __name__ == "__main__":
    unittest.main()
