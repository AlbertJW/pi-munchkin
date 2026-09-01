from __future__ import annotations

import copy

from .benchmark import BenchmarkPack
from .candidates import Candidate


class FakeProvider:
    plugin_name = "fake"

    def __init__(self) -> None:
        self.calls_by_kind: dict[str, int] = {}
        self.evidence_seen: list[dict] = []

    def session(self, kind: str, payload: dict, *, operation_id: str) -> dict:
        self.calls_by_kind[kind] = self.calls_by_kind.get(kind, 0) + 1
        self.evidence_seen.append(copy.deepcopy(payload))
        if kind == "evolve":
            return {"schema": "pi.optimizer-session/v2", "kind": kind, "strategy": "capability-first", "action": "mutate", "selected_parent_ids": [payload["accepted_candidate_ids"][-1]]}
        if kind == "diagnose_patch":
            return {
                "schema": "pi.optimizer-session/v2", "kind": kind,
                "root_cause_hypothesis": "The seed lacks the bounded capability needed by one admitted case.",
                "alternatives_considered": ["steering-only change"], "target_surface": "capability",
                "expected_exposure": "fake-capability-used", "primary_metric": "task_success",
                "falsifier": "no paired fixes", "rollback_condition": "any guard regression",
                "mutation": {"family": "capability", "diff": "--- seed\n+++ candidate\n@@\n-disabled\n+enabled\n", "changed_units": ["skills/fake-capability"]},
            }
        if kind == "reflect":
            return {
                "schema": "pi.optimizer-session/v2", "kind": kind,
                "lesson": "The bounded capability fixed the exposed case without a matched regression.",
                "stochasticity_check": "identical seeded cells",
                "classification": payload["classification"],
            }
        raise ValueError(f"unsupported fake provider session: {kind}")


class FakeSurface:
    plugin_name = "fake"

    def seed_candidate(self, campaign) -> Candidate:
        return Candidate.create(
            parent_ids=(), mutation_family="seed", hypothesis="Current source surface",
            predicted_mechanism="baseline", expected_exposure="baseline",
            diff="seed", changed_units=("source-surface",),
            provenance={"source_sha256": campaign.provenance["source_sha256"]},
        )

    def build_candidate(self, parent: Candidate, diagnosis: dict, campaign) -> Candidate:
        diagnosis_patch = diagnosis.get("mutation") if isinstance(diagnosis, dict) else None
        required = {"family", "diff", "changed_units"}
        if not isinstance(diagnosis_patch, dict) or set(diagnosis_patch) != required:
            raise ValueError("provider mutation output is malformed")
        if diagnosis_patch["family"] not in campaign.permitted_surface_families:
            raise ValueError("provider mutation targets an unauthorized surface family")
        return Candidate.create(
            parent_ids=(parent.candidate_id,), mutation_family=diagnosis_patch["family"],
            hypothesis=diagnosis["root_cause_hypothesis"],
            predicted_mechanism=f"Address the diagnosed cause through {diagnosis['target_surface']}",
            expected_exposure=diagnosis["expected_exposure"],
            diff=diagnosis_patch["diff"], changed_units=tuple(diagnosis_patch["changed_units"]),
            provenance={"parent": parent.candidate_id, "falsifier": diagnosis["falsifier"], "rollback_condition": diagnosis["rollback_condition"]},
        )

    def verify(self, candidate: Candidate, campaign, *, candidates_by_id=None) -> dict:
        return {
            "verified": candidate.mutation_family in campaign.permitted_surface_families or candidate.mutation_family == "composition",
            "checks": ["path-allowlist", "synthetic-typecheck", "synthetic-tests"],
            "diff_sha256": candidate.diff_sha256, "changed_units": list(candidate.changed_units),
        }


class FakeScenario:
    plugin_name = "fake"

    def __init__(self, benchmark: BenchmarkPack) -> None:
        self.benchmark = benchmark

    def calibrate(self, campaign, *, model: dict) -> dict:
        selected = [case.case_id for split in ("train", "development") for case in self.benchmark.splits[split]]
        band = campaign.benchmark["discrimination_band"]
        return {"status": "informative", "model": model, "selected_case_ids": selected, "observed_rate": 0.5, "band": band}

    def evaluate(self, candidate: Candidate, *, split: str, model: dict, seeds: tuple[int, ...], operation_id: str) -> dict:
        if split == "test":
            raise ValueError("opaque test split cannot be evaluated during optimization")
        cases = self.benchmark.splits[split]
        improved = candidate.mutation_family != "seed"
        observations = []
        for case_index, case in enumerate(cases):
            for seed in seeds:
                baseline = 0 if case_index == 0 else 1
                observations.append({
                    "case_id": case.case_id, "seed": seed, "repetition": 0,
                    "score": 1 if improved else baseline,
                    "trace_index_sha256": case.fixture_sha256,
                    "outcome": "success" if (improved or baseline) else "failure",
                })
        return {
            "schema": "pi.optimizer-evaluation/v1", "split": split,
            "candidate_id": candidate.candidate_id, "model": model,
            "observations": observations, "guards": {"security_failures": 0},
            "mechanism_exposed": improved, "serving_identity_stable": True,
        }

    def evaluate_pair(self, parent: Candidate, candidate: Candidate, *, model: dict, seeds: tuple[int, ...], operation_id: str) -> dict:
        parent_eval = self.evaluate(parent, split="train", model=model, seeds=seeds, operation_id=operation_id + ":parent")
        candidate_eval = self.evaluate(candidate, split="train", model=model, seeds=seeds, operation_id=operation_id + ":candidate")
        arm_order = []
        for row in parent_eval["observations"]:
            parity = int(row["trace_index_sha256"][:2], 16) ^ row["seed"]
            arm_order.append({"case_id": row["case_id"], "seed": row["seed"], "repetition": row["repetition"], "order": ["candidate", "parent"] if parity & 1 else ["parent", "candidate"]})
        return {"schema": "pi.optimizer-paired-evaluation/v1", "parent": parent_eval, "candidate": candidate_eval, "arm_order": arm_order}

    def diagnosis_evidence(self, parent: dict, candidate: dict | None = None) -> dict:
        def bounded(evaluation: dict) -> list[dict]:
            return [{"case_id": row["case_id"], "outcome": row["outcome"], "trace_index_sha256": row["trace_index_sha256"]} for row in evaluation["observations"]]
        result = {"schema": "pi.optimizer-diagnosis-evidence/v1", "split": "train", "parent": bounded(parent)}
        if candidate is not None:
            result["candidate"] = bounded(candidate)
        return result
