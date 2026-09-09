"""Independent golden cases for the new, explicitly versioned policies."""
import pathlib
import tempfile
import unittest

from optimizer.v2.manifest import load_campaign, ManifestError
from optimizer.v2.policies import accept_training_candidate, matched_classification, PolicyError
from optimizer.v2.tests.test_optimizer_v2 import campaign_dict, benchmark_dict
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.engine import CampaignEngine, InjectedCrash
from optimizer.v2.events import EventStore
from optimizer.v2.fake import FakeScenario, FakeSurface, FakeProvider


def evaluation(scores, *, same_case=False):
    return {"observations": [
        {"case_id": "one" if same_case else str(i), "seed": i,
         "repetition": 0, "score": score}
        for i, score in enumerate(scores)
    ], "guards": {"security_failures": 0}, "mechanism_exposed": True}


def campaign(name, *, kind="binary", direction="maximize", **fields):
    raw = campaign_dict()
    raw["primary_metric"].update(kind=kind, direction=direction,
                                 paired_policy={"name": name, **fields})
    return load_campaign(raw)


class QualifiedPolicies(unittest.TestCase):
    def test_exact_sign_golden_and_case_independence(self):
        c = campaign("case-sign/v1", alpha=.05, minimum_cases=5)
        result = accept_training_candidate(evaluation([0]*5), evaluation([1]*5), c)
        self.assertTrue(result["accepted"])
        self.assertEqual(result["policy"]["pvalue"], 1/32)
        repeated = accept_training_candidate(evaluation([0]*5, same_case=True), evaluation([1]*5, same_case=True), c)
        self.assertFalse(repeated["accepted"])
        self.assertEqual(repeated["policy"]["independent_cases"], 1)

    def test_minimize_and_ties(self):
        c = campaign("case-sign/v1", direction="minimize", alpha=.05, minimum_cases=5)
        result = accept_training_candidate(evaluation([1]*5+[0]), evaluation([0]*6), c)
        self.assertTrue(result["accepted"])
        self.assertEqual(result["policy"]["pvalue"], 1/32)
        self.assertEqual(result["classification"]["fixed"], 5)
        self.assertFalse(accept_training_candidate(evaluation([0]*6), evaluation([0]*6), c)["accepted"])

    def test_engineering_threshold_is_named_and_not_significance(self):
        c = campaign("net-case-wins/v1", minimum_net_wins=1, minimum_cases=1)
        result = accept_training_candidate(evaluation([0]), evaluation([1]), c)
        self.assertTrue(result["accepted"])
        self.assertIsNone(result["policy"]["pvalue"])

    def test_continuous_golden_and_no_fabricated_success(self):
        c = campaign("case-permutation/v1", kind="continuous", alpha=.05, minimum_cases=5, max_exact_cases=20)
        result = accept_training_candidate(evaluation([.2]*5), evaluation([.3]*5), c)
        self.assertEqual(result["policy"]["pvalue"], 1/32)
        self.assertTrue(result["accepted"])
        self.assertEqual(result["classification"], {"improved": 5, "regressed": 0, "unchanged": 0})

    def test_reject_unused_fields_and_bad_numbers(self):
        for extra in ({"permutations": 100}, {"alpha": True}, {"minimum_cases": 0}, {"max_exact_cases": 21}):
            args = dict(alpha=.05, minimum_cases=5, max_exact_cases=20)
            args.update(extra)
            with self.assertRaises(ManifestError):
                campaign("case-permutation/v1", kind="continuous", **args)

    def test_invalid_and_unexposed_cannot_advance(self):
        c = campaign("case-sign/v1", alpha=.05, minimum_cases=5)
        for scores in ([float("nan")]*5, [True]*5, [2]*5):
            with self.assertRaises(PolicyError):
                accept_training_candidate(evaluation([0]*5), evaluation(scores), c)
        result = evaluation([1]*5)
        result["mechanism_exposed"] = False
        self.assertFalse(accept_training_candidate(evaluation([0]*5), result, c)["accepted"])

    def test_legacy_approved_policy_keeps_meaning(self):
        c = campaign("exact-sign", minimum_net_fixes=1)
        self.assertTrue(accept_training_candidate(evaluation([0]), evaluation([1]), c)["accepted"])

    def test_incomplete_development_and_wrong_model_fail_before_evolution(self):
        for corruption in ("missing", "wrong_model", "duplicate", "wrong_seed", "nonbinary"):
            class Broken(FakeScenario):
                def evaluate(self, *args, **kwargs):
                    result = super().evaluate(*args, **kwargs)
                    if kwargs["split"] == "development":
                        if corruption == "missing": result["observations"].pop()
                        if corruption == "wrong_model": result["model"] = {"provider": "other", "model": "other"}
                        if corruption == "duplicate": result["observations"][-1] = result["observations"][0]
                        if corruption == "wrong_seed": result["observations"][0]["seed"] = 999
                        if corruption == "nonbinary": result["observations"][0]["score"] = 2
                    return result
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as directory:
                c = load_campaign(campaign_dict())
                provider = FakeProvider()
                engine = CampaignEngine(c, EventStore(pathlib.Path(directory)), Broken(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), provider)
                self.assertEqual(engine.run(approve_sha=c.sha256)["status"], "execution_error")
                self.assertEqual(provider.calls_by_kind, {})

    def test_development_regression_cannot_create_a_positive_lesson(self):
        class Regressing(FakeScenario):
            def evaluate(self, candidate, **kwargs):
                result = super().evaluate(candidate, **kwargs)
                if kwargs["split"] == "development" and candidate.mutation_family != "seed":
                    for row in result["observations"]: row["score"] = 0
                return result
        with tempfile.TemporaryDirectory() as directory:
            c = load_campaign(campaign_dict())
            store = EventStore(pathlib.Path(directory))
            result = CampaignEngine(c, store, Regressing(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), FakeProvider()).run(approve_sha=c.sha256)
            self.assertFalse(result["training_decision"]["accepted"])

    def test_versioned_policy_resumes_after_each_transition_without_duplicate_sessions(self):
        c = campaign("net-case-wins/v1", minimum_net_wins=1, minimum_cases=2)
        pack = BenchmarkPack.from_dict(benchmark_dict())
        with tempfile.TemporaryDirectory() as directory:
            store = EventStore(pathlib.Path(directory))
            provider = FakeProvider()
            reference = CampaignEngine(c, store, FakeScenario(pack), FakeSurface(), provider).run(approve_sha=c.sha256)
            self.assertEqual(reference["status"], "complete")
            count = len(store.read_all())
            calls = dict(provider.calls_by_kind)
        for boundary in range(1, count + 1):
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as directory:
                store = EventStore(pathlib.Path(directory))
                provider = FakeProvider()
                interrupted = CampaignEngine(c, store, FakeScenario(pack), FakeSurface(), provider, crash_after_transition=boundary)
                try: interrupted.run(approve_sha=c.sha256)
                except InjectedCrash: pass
                resumed = CampaignEngine(c, store, FakeScenario(pack), FakeSurface(), provider).run(approve_sha=c.sha256)
                self.assertEqual(resumed, reference)
                self.assertEqual(provider.calls_by_kind, calls)


if __name__ == "__main__":
    unittest.main()
