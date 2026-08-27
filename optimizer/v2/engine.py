from __future__ import annotations

import json
import hashlib
import os
import pathlib
import tempfile
import time
from collections.abc import Callable
from typing import Any

from .candidates import Candidate, compose_candidates
from .events import EventStore
from .policies import accept_training_candidate, matched_classification, score
from .ports import require_plugin


SESSION_SCHEMA = "pi.optimizer-session-result/v1"


class InjectedCrash(RuntimeError):
    pass


class CampaignBudgetExhausted(RuntimeError):
    pass


def _validate_session(kind: str, value: Any) -> dict:
    if not isinstance(value, dict) or value.get("schema") != SESSION_SCHEMA or value.get("kind") != kind:
        raise ValueError(f"optimizer provider returned malformed {kind} result")
    common = {"schema", "kind"}
    fields = {
        "evolve": common | {"strategy", "action", "selected_parent_ids"},
        "diagnose_patch": common | {
            "root_cause_hypothesis", "alternatives_considered", "target_surface",
            "expected_exposure", "primary_metric", "falsifier", "rollback_condition", "mutation",
        },
        "reflect": common | {"lesson", "stochasticity_check", "classification"},
    }
    if kind not in fields or set(value) != fields[kind]:
        raise ValueError(f"optimizer provider returned unknown fields for {kind}")
    return value


def _guard_margin(evaluation: dict, guards: tuple[dict, ...]) -> float:
    margins = []
    for guard in guards:
        value = evaluation.get("guards", {}).get(guard["metric"])
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return float("-inf")
        margins.append(guard["threshold"] - value if guard["direction"] == "at_most" else value - guard["threshold"])
    return min(margins)


class CampaignEngine:
    def __init__(self, manifest, store: EventStore, scenario, surface, provider,
                 *, crash_after_transition: int | None = None):
        self.manifest = manifest
        self.store = store
        self.scenario = scenario
        self.surface = surface
        self.provider = provider
        self.crash_after_transition = crash_after_transition
        self.transitions = 0
        self.calibrated_cases: dict[str, set[str]] = {}
        require_plugin(provider, manifest.optimizer_provider["plugin"], "optimizer provider")
        require_plugin(scenario, manifest.benchmark["plugin"], "scenario")
        require_plugin(surface, manifest.surface_adapter["plugin"], "surface adapter")

    def _operation(self, operation_id: str, event_type: str, producer: Callable[[], dict]) -> dict:
        existing = self.store.find(operation_id)
        if existing is not None:
            if existing["type"] != event_type:
                raise ValueError(f"operation {operation_id} was previously recorded as {existing['type']}")
            return existing["payload"]
        if event_type not in ("campaign.prepared", "campaign.approved", "campaign.stopped", "campaign.completed"):
            approved = self.store.find("campaign:approve")
            started = (approved or {}).get("payload", {}).get("started_unix_ns")
            if isinstance(started, int) and time.time_ns() - started > self.manifest.limits["wall_seconds"] * 1_000_000_000:
                raise CampaignBudgetExhausted("campaign wall-clock budget exhausted")
        payload = producer()
        if not isinstance(payload, dict):
            raise ValueError(f"operation {operation_id} did not produce an object")
        self.store.append(operation_id, event_type, payload)
        self.transitions += 1
        if self.crash_after_transition == self.transitions:
            raise InjectedCrash(f"injected after durable transition {self.transitions}")
        return payload

    def _provider_session(self, kind: str, payload: dict, iteration: int) -> dict:
        operation_id = f"provider:{kind}:iteration-{iteration}"
        prior_sessions = sum(1 for event in self.store.read_all() if event["type"] == "provider.session")
        if self.store.find(operation_id) is None and prior_sessions >= self.manifest.limits["provider_sessions"]:
            raise ValueError("provider session budget exhausted")
        return self._operation(
            operation_id, "provider.session",
            lambda: _validate_session(kind, self.provider.session(kind, payload, operation_id=operation_id)),
        )

    def _evaluation(self, operation_id: str, candidate: Candidate, split: str, model: dict) -> dict:
        def produce() -> dict:
            result = self.scenario.evaluate(candidate, split=split, model=model, seeds=self.manifest.seeds, operation_id=operation_id)
            observations = result.get("observations") if isinstance(result, dict) else None
            if not isinstance(observations, list) or not observations:
                raise ValueError("scenario returned an empty or malformed evaluation")
            if split == "train" and len(observations) > self.manifest.limits["rollouts_per_candidate"]:
                raise ValueError("training rollout budget exceeded")
            if result.get("candidate_id") != candidate.candidate_id or result.get("split") != split or result.get("serving_identity_stable") is not True:
                raise ValueError("scenario evaluation identity is incomplete or unstable")
            model_key = json.dumps(model, sort_keys=True, separators=(",", ":"))
            allowed = self.calibrated_cases.get(model_key)
            if allowed is None or any(row.get("case_id") not in allowed for row in observations):
                raise ValueError("evaluation contains a case outside this model's calibrated band")
            return result
        return self._operation(operation_id, "evaluation.recorded", produce)

    def _candidate(self, operation_id: str, producer: Callable[[], Candidate]) -> Candidate:
        payload = self._operation(operation_id, "candidate.recorded", lambda: producer().to_dict())
        return Candidate.from_dict(payload)

    def _paired_evaluation(self, operation_id: str, parent: Candidate, candidate: Candidate) -> dict:
        def produce() -> dict:
            value = self.scenario.evaluate_pair(parent, candidate, model=self.manifest.subject_model, seeds=self.manifest.seeds, operation_id=operation_id)
            if not isinstance(value, dict) or value.get("schema") != "pi.optimizer-paired-evaluation/v1":
                raise ValueError("scenario returned a malformed paired evaluation")
            for name, expected in (("parent", parent), ("candidate", candidate)):
                evaluation = value.get(name) or {}
                if evaluation.get("candidate_id") != expected.candidate_id or evaluation.get("split") != "train" or evaluation.get("serving_identity_stable") is not True:
                    raise ValueError(f"paired {name} evaluation identity is incomplete or unstable")
                if len(evaluation.get("observations") or []) > self.manifest.limits["rollouts_per_candidate"]:
                    raise ValueError("paired training rollout budget exceeded")
                subject_key = json.dumps(self.manifest.subject_model, sort_keys=True, separators=(",", ":"))
                allowed = self.calibrated_cases.get(subject_key)
                if allowed is None or any(row.get("case_id") not in allowed for row in evaluation.get("observations") or []):
                    raise ValueError("paired evaluation contains a case outside the subject model's calibrated band")
            expected_cells = {(row["case_id"], row["seed"], row.get("repetition", 0)) for row in value["parent"]["observations"]}
            order_cells = {(row.get("case_id"), row.get("seed"), row.get("repetition", 0)) for row in value.get("arm_order") or []}
            if expected_cells != order_cells or any(sorted(row.get("order") or []) != ["candidate", "parent"] for row in value.get("arm_order") or []):
                raise ValueError("paired evaluation lacks a complete randomized arm-order ledger")
            return value
        return self._operation(operation_id, "evaluation.paired", produce)

    def _write_review_packet(self, result: dict, candidates: list[Candidate], development: dict[str, dict]) -> None:
        packet = {
            "schema": "pi.optimizer-review-packet/v1", "campaign_sha256": self.manifest.sha256,
            "result": result, "candidate_summaries": [
                {"candidate_id": candidate.candidate_id, "parents": list(candidate.parent_ids),
                 "mutation_family": candidate.mutation_family, "changed_units": list(candidate.changed_units),
                 "diff_sha256": candidate.diff_sha256, "verified_diff_bytes": len(candidate.diff.encode())}
                for candidate in candidates
            ],
            "development_scores": {candidate_id: score(evaluation) for candidate_id, evaluation in development.items()},
            "human_adoption_required": True,
        }
        target = self.store.run_root / "review-packet.json"
        fd, temporary = tempfile.mkstemp(prefix=".review-packet.", dir=self.store.run_root)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(packet, fh, sort_keys=True, separators=(",", ":"))
                fh.write("\n"); fh.flush(); os.fsync(fh.fileno())
            os.replace(temporary, target); os.chmod(target, 0o600)
        except Exception:
            try: os.unlink(temporary)
            except OSError: pass
            raise

    def run(self, *, approve_sha: str) -> dict:
        if approve_sha != self.manifest.sha256:
            raise ValueError("approval SHA does not match the resolved campaign")
        with self.store.campaign_lock():
            try:
                return self._run_approved(approve_sha)
            except CampaignBudgetExhausted:
                return self._operation("campaign:stop:wall-budget", "campaign.stopped", lambda: {
                    "status": "budget_exhausted", "reason": "campaign wall-clock budget exhausted",
                })

    def _run_approved(self, approve_sha: str) -> dict:
        prepared = self._operation("campaign:prepare", "campaign.prepared", lambda: {
            "schema": self.manifest.schema, "campaign_id": self.manifest.campaign_id,
            "sha256": self.manifest.sha256, "provenance": self.manifest.provenance,
            "benchmark": {"pack_id": self.manifest.benchmark["pack_id"], "revision": self.manifest.benchmark["revision"]},
        })
        if prepared["sha256"] != self.manifest.sha256:
            raise ValueError("resume manifest does not match the prepared campaign")
        self._operation("campaign:approve", "campaign.approved", lambda: {"approved_sha256": approve_sha, "scope": "one-campaign", "started_unix_ns": time.time_ns()})
        band = self.manifest.benchmark["discrimination_band"]
        pack_ids = {split: {case.case_id for case in self.scenario.benchmark.splits[split]} for split in ("train", "development", "test")}
        cohort = [self.manifest.subject_model, *self.manifest.guard_models]
        for model in cohort:
            model_key = json.dumps(model, sort_keys=True, separators=(",", ":"))
            model_id = hashlib.sha256(model_key.encode()).hexdigest()[:16]
            calibration = self._operation(f"calibration:{model_id}", "calibration.recorded", lambda model=model: self.scenario.calibrate(self.manifest, model=model))
            selected = set(calibration.get("selected_case_ids") or [])
            rate = calibration.get("observed_rate")
            informative = (
                calibration.get("status") == "informative" and calibration.get("model") == model and
                isinstance(rate, (int, float)) and not isinstance(rate, bool) and band["minimum"] <= rate <= band["maximum"] and
                not (selected & pack_ids["test"]) and selected <= (pack_ids["train"] | pack_ids["development"]) and
                len(selected & pack_ids["train"]) >= band["minimum_cases"] and len(selected & pack_ids["development"]) >= band["minimum_cases"])
            if not informative:
                return self._operation(f"campaign:stop:uninformative:{model_id}", "campaign.stopped", lambda model=model: {
                    "status": "uninformative_benchmark", "model": model,
                    "reason": "insufficient or out-of-band train/development cases for the declared model",
                })
            self.calibrated_cases[model_key] = selected

        seed = self._candidate("candidate:seed", lambda: self.surface.seed_candidate(self.manifest))
        seed_dev = self._evaluation("evaluation:seed:development:subject", seed, "development", self.manifest.subject_model)
        if _guard_margin(seed_dev, self.manifest.hard_guards) < 0:
            return self._operation("campaign:stop:seed-guard", "campaign.stopped", lambda: {"status": "invalid_seed", "reason": "seed candidate fails a hard development guard"})
        candidates_by_id = {seed.candidate_id: seed}
        accepted_ids = [seed.candidate_id]
        development = {seed.candidate_id: seed_dev}
        guard_results = []
        last_decision = {"accepted": False, "reason": "no iteration attempted"}
        last_reflection = None
        for iteration in range(1, self.manifest.limits["iterations"] + 1):
            evolution = self._provider_session("evolve", {
                "schema": "pi.optimizer-evolution-input/v1", "seed_candidate_id": seed.candidate_id,
                "permitted_surface_families": list(self.manifest.permitted_surface_families),
                "accepted_candidate_ids": list(accepted_ids),
            }, iteration)
            action, parent_ids = evolution["action"], evolution["selected_parent_ids"]
            if action not in ("select", "revert", "compose") or not isinstance(parent_ids, list) or not parent_ids or any(value not in accepted_ids for value in parent_ids):
                raise ValueError("evolution selected an invalid action or unknown parent")
            if action == "compose":
                if len(parent_ids) != 2:
                    raise ValueError("composition requires exactly two accepted parents")
                parent = candidates_by_id[parent_ids[0]]
                candidate = self._candidate(f"candidate:iteration-{iteration}", lambda: compose_candidates(parent, candidates_by_id[parent_ids[1]], accepted_ids=set(accepted_ids)))
            else:
                if len(parent_ids) != 1:
                    raise ValueError("selection and revert require exactly one parent")
                parent = candidates_by_id[parent_ids[0]]
                diagnostic = self._evaluation(f"evaluation:diagnostic-parent:iteration-{iteration}", parent, "train", self.manifest.subject_model)
                diagnosis = self._provider_session("diagnose_patch", {
                    "schema": "pi.optimizer-diagnosis-input/v1", "primary_metric": self.manifest.primary_metric,
                    "hard_guards": list(self.manifest.hard_guards), "evidence": self.scenario.diagnosis_evidence(diagnostic),
                    "permitted_surface_families": list(self.manifest.permitted_surface_families),
                }, iteration)
                if diagnosis["target_surface"] not in self.manifest.permitted_surface_families or diagnosis["primary_metric"] != self.manifest.primary_metric["name"]:
                    raise ValueError("diagnosis targets an unauthorized or mismatched metric/surface")
                if iteration == 1 and "capability" in self.manifest.permitted_surface_families and diagnosis["target_surface"] != "capability":
                    raise ValueError("first multi-surface intervention must explore capability before steering")
                candidate = self._candidate(f"candidate:iteration-{iteration}", lambda: self.surface.build_candidate(parent, diagnosis["mutation"], self.manifest))
            candidates_by_id[candidate.candidate_id] = candidate
            verification = self._operation(f"verification:iteration-{iteration}", "candidate.verified", lambda: {**self.surface.verify(candidate, self.manifest), "candidate_id": candidate.candidate_id})
            if verification.get("verified") is not True or verification.get("diff_sha256") != candidate.diff_sha256:
                last_decision = {"accepted": False, "reason": "mutation verification failed"}
                last_reflection = self._provider_session("reflect", {
                    "schema": "pi.optimizer-reflection-input/v1", "classification": {"not_evaluated": 1},
                    "stochasticity_check": "not evaluated: verification failed", "generalization_validated": False,
                    "candidate_id": candidate.candidate_id,
                }, iteration)
                continue
            pair = self._paired_evaluation(f"evaluation:paired:iteration-{iteration}", parent, candidate)
            parent_train, candidate_train = pair["parent"], pair["candidate"]
            last_decision = self._operation(f"decision:training:iteration-{iteration}", "candidate.training-decision", lambda: {**accept_training_candidate(parent_train, candidate_train, self.manifest), "candidate_id": candidate.candidate_id, "parent_id": parent.candidate_id})
            candidate_dev = None
            iteration_guards = []
            if last_decision["accepted"]:
                candidate_dev = self._evaluation(f"evaluation:candidate-{iteration}:development:subject", candidate, "development", self.manifest.subject_model)
                if _guard_margin(candidate_dev, self.manifest.hard_guards) < 0:
                    last_decision = {**last_decision, "accepted": False, "development_guard_failure": True}
            if last_decision["accepted"]:
                for index, model in enumerate(self.manifest.guard_models):
                    guard = self._evaluation(f"evaluation:candidate-{iteration}:development:guard-{index}", candidate, "development", model)
                    guard_failed = any(
                        (guard_def["direction"] == "at_most" and guard.get("guards", {}).get(guard_def["metric"], float("inf")) > guard_def["threshold"]) or
                        (guard_def["direction"] == "at_least" and guard.get("guards", {}).get(guard_def["metric"], float("-inf")) < guard_def["threshold"])
                        for guard_def in self.manifest.hard_guards)
                    iteration_guards.append({"model": model, "passed": not guard_failed})
                    if guard_failed:
                        last_decision = {**last_decision, "accepted": False, "guard_model_failure": model}
                        break
                guard_results.extend(iteration_guards)
            if last_decision["accepted"]:
                accepted_ids.append(candidate.candidate_id)
                development[candidate.candidate_id] = candidate_dev
            classification = matched_classification(parent_train, candidate_train)
            last_reflection = self._provider_session("reflect", {
                "schema": "pi.optimizer-reflection-input/v1", "classification": classification,
                "stochasticity_check": "matched case, seed, repetition, and randomized-arm ledger",
                "generalization_validated": bool(candidate_dev is not None), "candidate_id": candidate.candidate_id,
            }, iteration)

        candidates = [candidates_by_id[candidate_id] for candidate_id in accepted_ids]
        ranked = sorted(
            candidates,
            key=lambda value: (-score(development[value.candidate_id]), -_guard_margin(development[value.candidate_id], self.manifest.hard_guards), len(value.diff.encode()), value.candidate_id),
        )
        selected = ranked[0]
        result = self._operation("campaign:complete", "campaign.completed", lambda: {
            "status": "complete", "selected_candidate_id": selected.candidate_id,
            "selected_by": "development-primary-guard-margin-diff-id",
            "training_decision": last_decision, "guard_models": guard_results,
            "reflection_recorded": bool(last_reflection and last_reflection["kind"] == "reflect"),
            "deployment_performed": False, "human_review_required": True,
        })
        self._write_review_packet(result, list(candidates_by_id.values()), development)
        return result
