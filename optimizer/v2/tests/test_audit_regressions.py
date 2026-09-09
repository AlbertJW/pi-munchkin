"""Offline regression probes for authority, projections, and decision policies."""
import copy
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from optimizer.v2.events import EventStore
from optimizer.v2.policies import PolicyError, accept_training_candidate, score
from optimizer.v2.engine import _guard_margin
from optimizer.v2.candidates import Candidate
from optimizer.v2.engine import CampaignEngine
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.fake import FakeProvider, FakeScenario, FakeSurface
from optimizer.v2.manifest import load_campaign
from optimizer.v2.tests.test_optimizer_v2 import benchmark_dict, campaign_dict


def campaign(direction="maximize"):
    return SimpleNamespace(
        primary_metric={"direction": direction, "kind": "binary",
                        "paired_policy": {"name": "exact-sign", "minimum_net_fixes": 1}},
        hard_guards=[{"metric": "security", "direction": "at_most", "threshold": 0}],
    )


def evaluation(value, guard=0):
    return {"observations": [{"case_id": "case", "seed": 1, "repetition": 0, "score": value}],
            "guards": {"security": guard}, "mechanism_exposed": True}


class AuditRegressions(unittest.TestCase):
    def test_candidate_identity_cannot_be_changed_through_provenance_aliases(self):
        provenance = {"nested": {"items": ["original"]}}
        candidate = Candidate.create(parent_ids=(), mutation_family="seed", hypothesis="baseline",
                                     predicted_mechanism="baseline", expected_exposure="baseline",
                                     diff="seed", changed_units=("source",), provenance=provenance)
        original = copy.deepcopy(candidate.to_dict())
        provenance["nested"]["items"].append("input mutation")
        candidate.provenance["nested"]["items"].append("attribute mutation")
        candidate.to_dict()["provenance"]["nested"]["items"].append("output mutation")
        self.assertEqual(candidate.to_dict(), original)
        self.assertEqual(Candidate.from_dict(original).candidate_id, candidate.candidate_id)

    def test_durable_append_survives_projection_and_dirty_marker_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EventStore(pathlib.Path(directory))
            with patch.object(store, "write_projections", side_effect=OSError("projection unavailable")), \
                    patch.object(pathlib.Path, "write_text", side_effect=OSError("marker unavailable")):
                event = store.append("once", "campaign.prepared", {})
            self.assertEqual(store.read_all(), [event])
            self.assertEqual(store.append("once", "campaign.prepared", {}), event)
            self.assertEqual(store.project()["event_count"], 1)

    def test_guard_model_failure_cannot_be_presented_as_validated_generalization(self):
        class BrokenGuard(FakeScenario):
            def evaluate(self, candidate, **kwargs):
                result = super().evaluate(candidate, **kwargs)
                if kwargs["model"]["model"] == "guard" and candidate.mutation_family != "seed":
                    result["guards"]["security_failures"] = float("nan")
                return result

        with tempfile.TemporaryDirectory() as directory:
            manifest = load_campaign(campaign_dict())
            provider = FakeProvider()
            result = CampaignEngine(manifest, EventStore(pathlib.Path(directory)),
                                    BrokenGuard(BenchmarkPack.from_dict(benchmark_dict())),
                                    FakeSurface(), provider).run(approve_sha=manifest.sha256)
            self.assertFalse(result["training_decision"]["accepted"])
            reflections = [item for item in provider.evidence_seen if item.get("schema") == "pi.optimizer-reflection-input/v2"]
            self.assertTrue(reflections)
            self.assertFalse(reflections[-1]["generalization_validated"])

    def test_projection_never_mutates_authoritative_events(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EventStore(pathlib.Path(directory))
            store.append("candidate", "candidate.recorded", {"candidate_id": "one"})
            store.append("verified", "candidate.verified", {"candidate_id": "one", "ok": True})
            events = store.read_all()
            original = copy.deepcopy(events)
            projection = store._project(events)
            self.assertEqual(events, original)
            projection["candidates"]["one"]["candidate_id"] = "changed"
            self.assertEqual(events, original)

    def test_binary_minimization_follows_declared_direction(self):
        accepted = accept_training_candidate(evaluation(1), evaluation(0), campaign("minimize"))
        self.assertTrue(accepted["accepted"])
        rejected = accept_training_candidate(evaluation(0), evaluation(1), campaign("minimize"))
        self.assertFalse(rejected["accepted"])

    def test_nonfinite_guards_fail_closed(self):
        for value in [float("nan"), float("inf"), -float("inf")]:
            with self.subTest(value=value):
                result = accept_training_candidate(evaluation(0), evaluation(1, value), campaign())
                self.assertFalse(result["accepted"])
                self.assertFalse(result["guards_passed"])
                self.assertEqual(_guard_margin(evaluation(1, value), campaign().hard_guards), -float("inf"))

    def test_preflight_selftest_is_offline_but_stale_readiness_still_fails(self):
        path = pathlib.Path(__file__).resolve().parents[2] / "research-fixtures" / "preflight.py"
        spec = importlib.util.spec_from_file_location("audit_preflight", path)
        preflight = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(preflight)
        with patch.object(preflight, "_source_hash", side_effect=RuntimeError("selftest must not bind the working tree")):
            preflight.selftest()
        with tempfile.TemporaryDirectory() as directory, patch.object(preflight, "_source_hash", return_value="f" * 64):
            with self.assertRaisesRegex(preflight.PreflightError, "source surface hash"):
                preflight.run_preflight(agent_dir=pathlib.Path(directory), expected_source="a" * 64,
                                        expected_loaded="b" * 64, model=preflight.DEFAULT_MODEL)

    def test_invalid_scores_and_pairing_keys_are_rejected(self):
        for field, value in [("score", float("nan")), ("score", float("inf")),
                             ("score", True), ("seed", True), ("repetition", []),
                             ("repetition", -1)]:
            with self.subTest(field=field, value=value):
                sample = evaluation(1)
                sample["observations"][0][field] = value
                with self.assertRaises(PolicyError):
                    score(sample)


if __name__ == "__main__":
    unittest.main()
