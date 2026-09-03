from __future__ import annotations

import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.candidates import Candidate, CandidateError, compose_candidates
from optimizer.v2.engine import CampaignEngine, InjectedCrash, _validate_session
from optimizer.v2.events import EventStore, EventStoreError
from optimizer.v2.fake import FakeProvider, FakeScenario, FakeSurface
from optimizer.v2.manifest import ManifestError, load_campaign
from optimizer.v2.pi_gate import PiGateEvidenceError, PiGateScenario, load_fresh_gate_evidence, validate_gate_evidence
from optimizer.v2.surface import ConfigSurfaceAdapter, PatchSurfaceAdapter
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


def diagnosis_for(mutation: dict) -> dict:
    return {
        "schema": "pi.optimizer-session/v2", "kind": "diagnose_patch",
        "root_cause_hypothesis": "A bounded surface change may repair the observed failure.",
        "alternatives_considered": ["leave the surface unchanged"],
        "target_surface": mutation["family"], "expected_exposure": "bounded-change-applied",
        "primary_metric": "task_success", "falsifier": "no matched improvement",
        "rollback_condition": "any hard-guard regression", "mutation": mutation,
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

    def test_invalid_paired_policy_fails_before_engine_sessions(self) -> None:
        malformed = campaign_dict()
        malformed["primary_metric"]["paired_policy"] = {
            "name": "exact-sign", "minimum_net_fixes": 0,
        }
        with self.assertRaisesRegex(ManifestError, "minimum_net_fixes"):
            load_campaign(malformed)

        malformed = campaign_dict()
        malformed["primary_metric"]["paired_policy"] = {
            "name": "not-a-policy", "minimum_net_fixes": 1,
        }
        with self.assertRaisesRegex(ManifestError, "paired_policy.name"):
            load_campaign(malformed)

        malformed = campaign_dict()
        malformed["primary_metric"]["kind"] = "continuous"
        malformed["primary_metric"]["paired_policy"] = {
            "name": "paired-permutation", "alpha": 2, "permutations": 20,
        }
        with self.assertRaisesRegex(ManifestError, "alpha"):
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
        card = first.card(train={"accepted": True}, development_validated=True)
        self.assertEqual(card["candidate_id"], first.candidate_id)
        self.assertEqual(card["train_disposition"], "accepted")
        self.assertTrue(card["development_validated"])
        self.assertNotIn("diff", card)

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
                adapter.build_candidate(parent, diagnosis_for({"family": "capability", "diff": "--- a/../secret\n+++ b/../secret\n", "changed_units": ["../secret"]}), manifest)
            with self.assertRaisesRegex(CandidateError, "unauthorized"):
                adapter.build_candidate(parent, diagnosis_for({"family": "steering", "diff": "--- a/prompts/x\n+++ b/prompts/x\n", "changed_units": ["prompts/x"]}), manifest)

    def test_config_surface_materializes_private_content_addressed_snapshots(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            baseline = root / "baseline.json"
            baseline.write_text('{"prompt_variant":"A","format":"md","scaffold":"none"}\n', encoding="utf-8")
            validator = pathlib.Path(__file__).resolve().parents[2] / "prompt-lab" / "config.py"
            raw = campaign_dict()
            raw["permitted_surface_families"] = ["configuration"]
            raw["provenance"]["config_sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
            campaign = load_campaign(raw)
            adapter = ConfigSurfaceAdapter(baseline, root / "snapshots", validator)
            seed = adapter.seed_candidate(campaign)
            candidate = adapter.build_candidate(seed, diagnosis_for({
                "family": "configuration",
                "diff": '{"scaffold":"decompose","name":"bounded-decompose"}',
                "changed_units": ["config.name", "config.scaffold"],
            }), campaign)
            path = adapter.materialize(candidate)
            self.assertEqual(json.loads(path.read_text())["scaffold"], "decompose")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertTrue(adapter.verify(candidate, campaign)["verified"])
            self.assertNotIn(str(path), json.dumps(candidate.to_dict()))

    def test_config_surface_rejects_unbound_or_misdeclared_mutations(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td); baseline = root / "baseline.json"
            baseline.write_text('{"prompt_variant":"A","format":"md","scaffold":"none"}\n', encoding="utf-8")
            raw = campaign_dict(); raw["permitted_surface_families"] = ["configuration"]
            raw["provenance"]["config_sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
            campaign = load_campaign(raw)
            adapter = ConfigSurfaceAdapter(baseline, root / "snapshots", pathlib.Path(__file__).resolve().parents[2] / "prompt-lab" / "config.py")
            seed = adapter.seed_candidate(campaign)
            with self.assertRaisesRegex(CandidateError, "changed units"):
                adapter.build_candidate(seed, diagnosis_for({"family": "configuration", "diff": '{"scaffold":"decompose"}', "changed_units": ["config.format"]}), campaign)
            with self.assertRaisesRegex(CandidateError, "unsupported"):
                adapter.build_candidate(seed, diagnosis_for({"family": "configuration", "diff": '{"shell":"unsafe"}', "changed_units": ["config.shell"]}), campaign)
            constrained = ConfigSurfaceAdapter(baseline, root / "constrained", pathlib.Path(__file__).resolve().parents[2] / "prompt-lab" / "config.py", ("name", "format", "scaffold"), ("format", "scaffold"))
            constrained_seed = constrained.seed_candidate(campaign)
            with self.assertRaisesRegex(CandidateError, "behavioral key"):
                constrained.build_candidate(constrained_seed, diagnosis_for({"family": "configuration", "diff": '{"name":"metadata-only"}', "changed_units": ["config.name"]}), campaign)
            with self.assertRaisesRegex(CandidateError, "unsupported"):
                constrained.build_candidate(constrained_seed, diagnosis_for({"family": "configuration", "diff": '{"prompt_variant":"/private/path"}', "changed_units": ["config.prompt_variant"]}), campaign)

    def test_config_grandchild_materializes_all_accepted_ancestors(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td); baseline = root / "baseline.json"
            baseline.write_text('{"format":"md","scaffold":"none","prompt_variant":"A"}\n', encoding="utf-8")
            raw = campaign_dict(); raw["permitted_surface_families"] = ["configuration"]
            raw["provenance"]["config_sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
            campaign = load_campaign(raw)
            adapter = ConfigSurfaceAdapter(baseline, root / "snapshots", pathlib.Path(__file__).resolve().parents[2] / "prompt-lab" / "config.py")
            seed = adapter.seed_candidate(campaign)
            child = adapter.build_candidate(seed, diagnosis_for({"family": "configuration", "diff": '{"scaffold":"decompose"}', "changed_units": ["config.scaffold"]}), campaign)
            grandchild = adapter.build_candidate(child, diagnosis_for({"family": "configuration", "diff": '{"format":"xml"}', "changed_units": ["config.format"]}), campaign)
            value = json.loads(adapter.materialize(grandchild).read_text(encoding="utf-8"))
            self.assertEqual(value["scaffold"], "decompose")
            self.assertEqual(value["format"], "xml")

    def test_config_composition_requires_nonconflicting_accepted_branches(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td); baseline = root / "baseline.json"
            baseline.write_text('{"format":"md","scaffold":"none","prompt_variant":"A"}\n', encoding="utf-8")
            raw = campaign_dict(); raw["permitted_surface_families"] = ["configuration"]
            raw["provenance"]["config_sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
            campaign = load_campaign(raw)
            adapter = ConfigSurfaceAdapter(baseline, root / "snapshots", pathlib.Path(__file__).resolve().parents[2] / "prompt-lab" / "config.py")
            seed = adapter.seed_candidate(campaign); graph = {seed.candidate_id: seed}
            left = adapter.build_candidate(seed, diagnosis_for({"family": "configuration", "diff": '{"format":"xml"}', "changed_units": ["config.format"]}), campaign)
            right = adapter.build_candidate(seed, diagnosis_for({"family": "configuration", "diff": '{"scaffold":"decompose"}', "changed_units": ["config.scaffold"]}), campaign)
            graph.update({left.candidate_id: left, right.candidate_id: right})
            composed = adapter.compose(left, right, candidates_by_id=graph, campaign=campaign)
            self.assertTrue(adapter.verify(composed, campaign, candidates_by_id={**graph, composed.candidate_id: composed})["verified"])
            conflict = adapter.build_candidate(seed, diagnosis_for({"family": "configuration", "diff": '{"format":"json"}', "changed_units": ["config.format"]}), campaign)
            graph[conflict.candidate_id] = conflict
            with self.assertRaisesRegex(CandidateError, "conflict"):
                adapter.compose(left, conflict, candidates_by_id=graph, campaign=campaign)

    def test_patch_composition_materializes_grandchild_and_sibling_from_common_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            source = root / "source"
            (source / "skills").mkdir(parents=True)
            (source / "skills" / "a.txt").write_text("base\n", encoding="utf-8")
            (source / "skills" / "b.txt").write_text("base-b\n", encoding="utf-8")
            subprocess.run(["git", "init", "-q"], cwd=source, check=True)
            subprocess.run(["git", "config", "user.email", "optimizer@test.invalid"], cwd=source, check=True)
            subprocess.run(["git", "config", "user.name", "Optimizer Test"], cwd=source, check=True)
            subprocess.run(["git", "add", "skills"], cwd=source, check=True)
            subprocess.run(["git", "commit", "-qm", "baseline"], cwd=source, check=True)
            manifest_raw = campaign_dict()
            manifest_raw["permitted_surface_families"] = ["capability"]
            manifest = load_campaign(manifest_raw)
            adapter = PatchSurfaceAdapter(source, root / "workspaces", {"capability": ("skills/",)})
            seed = adapter.seed_candidate(manifest)
            child = adapter.build_candidate(seed, diagnosis_for({
                "family": "capability",
                "diff": "--- a/skills/a.txt\n+++ b/skills/a.txt\n@@ -1 +1 @@\n-base\n+left\n",
                "changed_units": ["skills/a.txt"],
            }), manifest)
            grandchild = adapter.build_candidate(child, diagnosis_for({
                "family": "capability",
                "diff": "--- a/skills/a.txt\n+++ b/skills/a.txt\n@@ -1 +1 @@\n-left\n+grandchild\n",
                "changed_units": ["skills/a.txt"],
            }), manifest)
            sibling = adapter.build_candidate(seed, diagnosis_for({
                "family": "capability",
                "diff": "--- a/skills/b.txt\n+++ b/skills/b.txt\n@@ -1 +1 @@\n-base-b\n+sibling\n",
                "changed_units": ["skills/b.txt"],
            }), manifest)
            graph = {candidate.candidate_id: candidate for candidate in (seed, child, grandchild, sibling)}
            composed = adapter.compose(grandchild, sibling, candidates_by_id=graph, campaign=manifest)
            graph[composed.candidate_id] = composed
            verification = adapter.verify(composed, manifest, candidates_by_id=graph)
            self.assertTrue(verification["verified"], verification)


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

    def test_malformed_eof_is_reported_without_mutation_and_resume_recovers(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = EventStore(pathlib.Path(td))
            store.append("op-1", "campaign.prepared", {"sha256": HEX})
            suffix = b'{"torn":'
            with store.events_path.open("ab") as fh:
                fh.write(suffix)
            before = store.events_path.read_bytes()
            events, tail = store.read_with_recovery()
            self.assertEqual(len(events), 1)
            self.assertEqual(tail["byte_count"], len(suffix))
            self.assertEqual(store.events_path.read_bytes(), before)
            projection, reported = store.project_with_recovery()
            self.assertTrue(reported and reported["sha256"] == tail["sha256"])
            self.assertEqual(projection["event_count"], 1)
            recovered = store.recover_tail()
            self.assertEqual(recovered["type"], "event-store.tail-recovered")
            self.assertEqual(store.read_all()[-1]["payload"], {"byte_count": len(suffix), "sha256": tail["sha256"]})

    def test_unterminated_valid_event_is_a_recoverable_eof_tail(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = EventStore(pathlib.Path(td))
            store.append("op-1", "campaign.prepared", {"sha256": HEX})
            raw = store.events_path.read_bytes()
            self.assertTrue(raw.endswith(b"\n"))
            store.events_path.write_bytes(raw[:-1])
            before = store.events_path.read_bytes()
            with self.assertRaisesRegex(EventStoreError, "unterminated"):
                store.read_all()
            events, tail = store.read_with_recovery()
            self.assertEqual(events, [])
            self.assertEqual(tail["byte_count"], len(before))
            self.assertTrue(tail["repairable"])
            self.assertEqual(store.events_path.read_bytes(), before)
            recovered = store.recover_tail()
            self.assertEqual(recovered["type"], "event-store.tail-recovered")
            recovered_events = store.read_all()
            self.assertEqual(recovered_events[0]["operation_id"], "op-1")
            self.assertEqual(recovered_events[-1]["payload"]["byte_count"], len(before))

    def test_tail_recovery_refuses_a_run_owned_by_another_campaign_writer(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            store = EventStore(root)
            store.append("op-1", "campaign.prepared", {"sha256": HEX})
            with store.events_path.open("ab") as fh:
                fh.write(b'{"torn":')
            ready = root / "ready"
            holder = subprocess.Popen([
                sys.executable, "-c", (
                    "import pathlib,sys,time\n"
                    "from optimizer.v2.events import EventStore\n"
                    "root=pathlib.Path(sys.argv[1]); ready=pathlib.Path(sys.argv[2])\n"
                    "store=EventStore(root, create=False)\n"
                    "with store.campaign_lock():\n"
                    "    ready.write_text('ready'); time.sleep(2)\n"
                ), str(root), str(ready),
            ], cwd=pathlib.Path(__file__).resolve().parents[3])
            try:
                deadline = time.time() + 2
                while not ready.exists() and time.time() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), "campaign lock holder did not start")
                with self.assertRaisesRegex(EventStoreError, "another optimizer writer"):
                    store.recover_tail()
            finally:
                holder.terminate()
                holder.wait(timeout=5)

    def test_midstream_corruption_is_fatal_and_projection_failure_is_rebuildable(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            store = EventStore(pathlib.Path(td))
            store.append("op-1", "campaign.prepared", {"sha256": HEX})
            store.events_path.write_bytes(store.events_path.read_bytes() + b'{"bad":1}\n' + store.events_path.read_bytes())
            with self.assertRaisesRegex(EventStoreError, "line 2"):
                store.read_with_recovery()
        with tempfile.TemporaryDirectory() as td:
            store = EventStore(pathlib.Path(td))
            original = store.write_projections
            store.write_projections = lambda _projection: (_ for _ in ()).throw(OSError("projection down"))
            event = store.append("op-1", "campaign.prepared", {"sha256": HEX})
            self.assertEqual(event["operation_id"], "op-1")
            self.assertTrue(store.projection_dirty_path.exists())
            store.write_projections = original
            self.assertEqual(store.project()["event_count"], 1)
            self.assertFalse(store.projection_dirty_path.exists())

    def test_cli_status_inspect_and_replay_report_tail_without_mutating(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            manifest_path = pathlib.Path(__file__).resolve().parents[1] / "examples" / "campaign.json"
            manifest = load_campaign(manifest_path)
            run_root = pathlib.Path(td) / "runs"
            run_dir = run_root / f"{manifest.campaign_id}-{manifest.sha256[:12]}"
            store = EventStore(run_dir)
            store.append("op-1", "campaign.prepared", {"sha256": manifest.sha256})
            with store.events_path.open("ab") as fh:
                fh.write(b'{"torn":')
            before = store.events_path.read_bytes()
            for command in ("status", "inspect", "replay"):
                result = subprocess.run(
                    ["python3", "-m", "optimizer.v2.cli", command, "--manifest", str(manifest_path), "--run-root", str(run_root)],
                    cwd=manifest_path.parents[3], capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                projection = json.loads(result.stdout)
                self.assertTrue(projection["event_store"]["malformed_eof"])
                self.assertEqual(projection["event_store"]["recovery"], "resume-only")
                self.assertEqual(store.events_path.read_bytes(), before)

    def test_run_has_one_nonblocking_writer(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            first = EventStore(pathlib.Path(td))
            second = EventStore(pathlib.Path(td))
            with first.campaign_lock():
                with self.assertRaisesRegex(EventStoreError, "another optimizer writer"):
                    with second.campaign_lock():
                        pass


class EngineTests(unittest.TestCase):
    def test_provider_results_are_typed_and_bounded_before_recording(self) -> None:
        malformed = FakeProvider().session("diagnose_patch", {
            "accepted_candidate_ids": ["seed"]
        }, operation_id="typed-test")
        malformed["alternatives_considered"] = "not-a-list"
        with self.assertRaisesRegex(ValueError, "malformed diagnose_patch fields"):
            _validate_session("diagnose_patch", malformed)
        oversized = FakeProvider().session("reflect", {"classification": {"fixed": 1}}, operation_id="bounded-test")
        oversized["lesson"] = "x" * 70_000
        with self.assertRaisesRegex(ValueError, "oversized reflect"):
            _validate_session("reflect", oversized)

    def test_session_v2_rejects_legacy_evolution_actions(self) -> None:
        with self.assertRaisesRegex(ValueError, "malformed evolve fields"):
            _validate_session("evolve", {
                "schema": "pi.optimizer-session/v2", "kind": "evolve",
                "strategy": "x", "action": "revert", "selected_parent_ids": ["seed"],
            })

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
            encoded_evidence = json.dumps(provider.evidence_seen)
            self.assertNotIn('"observations"', encoded_evidence)
            self.assertNotIn('"score"', encoded_evidence)
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
            evolves = [payload for payload in provider.evidence_seen if payload.get("schema") == "pi.optimizer-evolution-input/v2"]
            self.assertEqual(len(evolves), 2)
            self.assertTrue(evolves[1]["previous_reflection"])
            self.assertTrue(evolves[1]["positive_lessons"])
            self.assertNotIn('"observations"', json.dumps(evolves[1]))

    def test_selecting_an_earlier_accepted_ancestor_is_the_revert_path(self) -> None:
        class AncestorProvider(FakeProvider):
            def session(self, kind, payload, *, operation_id):
                if kind == "evolve":
                    count = self.calls_by_kind.get(kind, 0)
                    self.calls_by_kind[kind] = count + 1
                    self.evidence_seen.append(json.loads(json.dumps(payload)))
                    parent_id = payload["accepted_candidate_ids"][-1] if count == 0 else payload["accepted_candidate_ids"][0]
                    return {"schema": "pi.optimizer-session/v2", "kind": kind, "strategy": "return-to-seed", "action": "mutate", "selected_parent_ids": [parent_id]}
                return super().session(kind, payload, operation_id=operation_id)
        with tempfile.TemporaryDirectory() as td:
            raw = campaign_dict(); raw["limits"]["iterations"] = 2
            manifest = load_campaign(raw); provider = AncestorProvider()
            result = CampaignEngine(manifest, EventStore(pathlib.Path(td)), FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), provider).run(approve_sha=manifest.sha256)
            self.assertEqual(result["status"], "complete")
            candidates = [event["payload"] for event in EventStore(pathlib.Path(td)).read_all() if event["type"] == "candidate.recorded"]
            self.assertGreaterEqual(len(candidates), 3)
            self.assertEqual(candidates[2]["parent_ids"], [candidates[0]["candidate_id"]])

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
            provider = Malformed(); store = EventStore(pathlib.Path(td))
            result = CampaignEngine(manifest, store, FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), provider).run(approve_sha=manifest.sha256)
            self.assertEqual(result["status"], "execution_error")
            self.assertTrue((pathlib.Path(td) / "review-packet.json").is_file())
            calls = dict(provider.calls_by_kind)
            resumed = CampaignEngine(manifest, store, FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), provider).run(approve_sha=manifest.sha256)
            self.assertEqual(resumed, result); self.assertEqual(provider.calls_by_kind, calls)

    def test_uninformative_calibration_and_rollout_inflation_stop_fail_closed(self) -> None:
        class Uninformative(FakeScenario):
            def calibrate(self, campaign, *, model): return {"status": "uninformative", "model": model, "selected_case_ids": []}
        with tempfile.TemporaryDirectory() as td:
            manifest = load_campaign(campaign_dict())
            result = CampaignEngine(manifest, EventStore(pathlib.Path(td)), Uninformative(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), FakeProvider()).run(approve_sha=manifest.sha256)
            self.assertEqual(result["status"], "uninformative_benchmark")
            self.assertTrue((pathlib.Path(td) / "review-packet.json").is_file())
        with tempfile.TemporaryDirectory() as td:
            raw = campaign_dict(); raw["limits"]["rollouts_per_candidate"] = 5
            manifest = load_campaign(raw)
            result = CampaignEngine(manifest, EventStore(pathlib.Path(td)), FakeScenario(BenchmarkPack.from_dict(benchmark_dict())), FakeSurface(), FakeProvider()).run(approve_sha=manifest.sha256)
            self.assertEqual(result["status"], "execution_error")
            self.assertTrue((pathlib.Path(td) / "review-packet.json").is_file())

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
    @staticmethod
    def _row(*, arm: str = "cand", session: str = "session-1", run: str = "run-1", config: str = "b" * 64,
             serving: str = "d" * 64) -> dict:
        return {
            "schema": "pi.eval-row/v4", "task": "t1", "model": "subject", "arm": arm,
            "run": run, "status": "complete", "score": 1, "authoritative": True,
            "gate_session_id": session, "harness": {"surface_sha256": "c" * 64},
            "config": {"sha256": config}, "experiment": {"manifest_sha256": HEX, "cell": f"cell-{arm}"},
            "execution": {"authoritative": True},
            "serving": {"stable": True, "pre": {"status": "complete", "full_sha256": serving}, "post": {"status": "complete", "full_sha256": serving}},
            "context": {"schema": "pi.context-telemetry/v4", "authenticated": True},
            "exposure": {"status": "control" if arm == "base" else "targeted"},
        }

    @staticmethod
    def _validity(row: dict, *, void: bool = False) -> dict:
        digest = hashlib.sha256(json.dumps(row, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        variant = ((row.get("prompt") or {}).get("variant")) or "canonical"
        key = f"{row['run']}:{row['model']}:None:{row['task']}:{row['arm']}:None:{variant}"
        return {"row_key": key, "row_sha256": digest, "void": void, "void_reasons": ["reward_hacking"] if void else []}

    def test_only_fresh_authoritative_bound_v4_rows_are_accepted(self) -> None:
        row = self._row(); validity = self._validity(row)
        accepted = validate_gate_evidence([row], [validity], campaign_sha256=HEX, config_sha256="b" * 64, surface_sha256="c" * 64)
        self.assertEqual(accepted, [row])
        broken = dict(row, authoritative=False)
        with self.assertRaises(PiGateEvidenceError):
            validate_gate_evidence([broken], [validity], campaign_sha256=HEX, config_sha256="b" * 64, surface_sha256="c" * 64)

    def test_paired_rows_bind_distinct_configs_cells_and_parent_sessions(self) -> None:
        base = self._row(arm="base", session="session-base", config="a" * 64)
        cand = self._row(arm="cand", session="session-cand", config="b" * 64)
        accepted = validate_gate_evidence(
            [base, cand], [self._validity(base), self._validity(cand)], campaign_sha256=HEX,
            config_sha256={"base": "a" * 64, "cand": "b" * 64}, surface_sha256="c" * 64,
            experiment_cells={"base": "cell-base", "cand": "cell-cand"},
        )
        self.assertEqual(len(accepted), 2)
        duplicate = dict(cand, gate_session_id="session-base")
        with self.assertRaisesRegex(PiGateEvidenceError, "duplicate-gate-session"):
            validate_gate_evidence([base, duplicate], [self._validity(base), self._validity(duplicate)], campaign_sha256=HEX, config_sha256={"base": "a" * 64, "cand": "b" * 64}, surface_sha256="c" * 64, experiment_cells={"base": "cell-base", "cand": "cell-cand"})

    def test_voided_reward_hacking_and_cross_invocation_rows_are_rejected(self) -> None:
        row = self._row()
        with self.assertRaisesRegex(PiGateEvidenceError, "trial-validity"):
            validate_gate_evidence([row], [self._validity(row, void=True)], campaign_sha256=HEX, config_sha256="b" * 64, surface_sha256="c" * 64)
        other = self._row(arm="base", session="session-2", run="run-2")
        with self.assertRaisesRegex(PiGateEvidenceError, "multiple invocations"):
            validate_gate_evidence([row, other], [self._validity(row), self._validity(other)], campaign_sha256=HEX, config_sha256="b" * 64, surface_sha256="c" * 64)
        changed_serving = self._row(arm="base", session="session-3", serving="f" * 64)
        with self.assertRaisesRegex(PiGateEvidenceError, "multiple serving identities"):
            validate_gate_evidence([row, changed_serving], [self._validity(row), self._validity(changed_serving)], campaign_sha256=HEX, config_sha256="b" * 64, surface_sha256="c" * 64)

    def test_gate_files_must_be_fresh_and_complete(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            results = pathlib.Path(td) / "rows.jsonl"; sidecar = pathlib.Path(str(results) + ".validity.jsonl")
            results.write_text('{"row":1}\n', encoding="utf-8"); sidecar.write_text('{"verdict":1}\n', encoding="utf-8")
            before = min(results.stat().st_mtime_ns, sidecar.stat().st_mtime_ns)
            rows, verdicts = load_fresh_gate_evidence(results, not_before_ns=before)
            self.assertEqual((len(rows), len(verdicts)), (1, 1))
            with self.assertRaisesRegex(PiGateEvidenceError, "stale"):
                load_fresh_gate_evidence(results, not_before_ns=max(results.stat().st_mtime_ns, sidecar.stat().st_mtime_ns) + 1)
            link = pathlib.Path(td) / "linked.jsonl"; link.symlink_to(results)
            pathlib.Path(str(link) + ".validity.jsonl").symlink_to(sidecar)
            with self.assertRaisesRegex(PiGateEvidenceError, "not a file"):
                load_fresh_gate_evidence(link, not_before_ns=before)

    def test_trusted_gate_dry_contract_remains_offline_and_characterized(self) -> None:
        gate = pathlib.Path(__file__).resolve().parents[2] / "real_gate.sh"
        completed = subprocess.run([str(gate), "--dry"], cwd=gate.parent, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=20)
        self.assertEqual(completed.returncode, 0)
        self.assertIn("== real_gate DRY ==", completed.stdout)
        self.assertIn("would run", completed.stdout)
        self.assertNotIn("\nrows ->", completed.stdout)

    def test_interrupted_gate_attempt_refuses_duplicate_model_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td); baseline = root / "baseline.json"
            baseline.write_text('{"prompt_variant":"A","format":"md","scaffold":"none"}\n', encoding="utf-8")
            raw = campaign_dict(); raw["permitted_surface_families"] = ["configuration"]
            raw["provenance"]["config_sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
            campaign = load_campaign(raw); pack = BenchmarkPack.from_dict(benchmark_dict())
            validator = pathlib.Path(__file__).resolve().parents[2] / "prompt-lab" / "config.py"
            surface = ConfigSurfaceAdapter(baseline, root / "snapshots", validator)
            case_tasks = {case.case_id: case.case_id for split in pack.splits.values() for case in split}
            scenario = PiGateScenario(pathlib.Path(__file__).resolve().parents[2], pack, surface, root / "run", {
                "case_tasks": case_tasks, "model_control": "llama", "gate_network": "endpoint",
                "llama_endpoint": {"scheme": "http", "host": "loopback", "port": 8080}, "model_registry_sha256": "e" * 64,
            }, campaign)
            scenario._bind_serving_identity({"provider": "fake", "model": "subject"}, "d" * 64)
            self.assertEqual((root / "run" / "serving-contract.json").stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(PiGateEvidenceError, "changed across campaign"):
                scenario._bind_serving_identity({"provider": "fake", "model": "subject"}, "f" * 64)
            operation_id = "interrupted-evaluation"
            attempt = scenario.evidence_root / hashlib.sha256(operation_id.encode()).hexdigest()[:16]
            attempt.mkdir(mode=0o700); (attempt / "attempt.started").write_text("{}\n")
            with self.assertRaisesRegex(PiGateEvidenceError, "refusing duplicate model sessions"):
                scenario._invoke(campaign, parent=surface.seed_candidate(campaign), candidate=None, split="train", model={"provider": "fake", "model": "subject"}, seeds=(1,), operation_id=operation_id)

    def test_pi_gate_calibration_delegates_to_six_row_admission_rule(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td); baseline = root / "baseline.json"
            baseline.write_text('{"prompt_variant":"A","format":"md","scaffold":"none"}\n', encoding="utf-8")
            raw = campaign_dict(); raw["permitted_surface_families"] = ["configuration"]
            raw["provenance"]["config_sha256"] = hashlib.sha256(baseline.read_bytes()).hexdigest()
            campaign = load_campaign(raw); pack = BenchmarkPack.from_dict(benchmark_dict())
            surface = ConfigSurfaceAdapter(baseline, root / "snapshots", pathlib.Path(__file__).resolve().parents[2] / "prompt-lab" / "config.py")
            case_tasks = {case.case_id: case.case_id for split in pack.splits.values() for case in split}
            scenario = PiGateScenario(pathlib.Path(__file__).resolve().parents[2], pack, surface, root / "run", {
                "case_tasks": case_tasks, "model_control": "llama", "gate_network": "endpoint",
                "llama_endpoint": {"scheme": "http", "host": "loopback", "port": 8080}, "model_registry_sha256": "e" * 64,
                "calibration_repetitions": 6,
            }, campaign)
            def synthetic(_campaign, *, split, seeds, **_kwargs):
                mapping = [{"task": case.case_id, "case_id": case.case_id} for case in pack.splits[split]]
                rows = [{"task": case.case_id, "score": int(fixed == 8), "subscores": {"fixed": fixed, "total": 8}} for case in pack.splits[split] for fixed in (1, 2, 3, 4, 5, 6)]
                return rows, mapping
            scenario._invoke = synthetic
            result = scenario.calibrate(campaign, model=campaign.subject_model)
            self.assertEqual(result["status"], "informative")
            self.assertTrue(all(value["verdict"] == "ADMITTED" for value in result["admission"].values()))
            scenario.config["calibration_repetitions"] = 2
            def insufficient(_campaign, *, split, seeds, **_kwargs):
                mapping = [{"task": case.case_id, "case_id": case.case_id} for case in pack.splits[split]]
                return ([{"task": case.case_id, "score": 0, "subscores": {"fixed": fixed, "total": 8}} for case in pack.splits[split] for fixed in (2, 5)], mapping)
            scenario._invoke = insufficient
            self.assertEqual(scenario.calibrate(campaign, model=campaign.subject_model)["status"], "uninformative")


if __name__ == "__main__":
    unittest.main()
