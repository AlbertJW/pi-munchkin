from __future__ import annotations

import dataclasses
import hashlib
import json
from typing import Any


SCHEMA = "pi.optimizer-candidate/v1"


class CandidateError(ValueError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


@dataclasses.dataclass(frozen=True)
class Candidate:
    candidate_id: str
    parent_ids: tuple[str, ...]
    mutation_family: str
    hypothesis: str
    predicted_mechanism: str
    expected_exposure: str
    diff: str
    diff_sha256: str
    changed_units: tuple[str, ...]
    provenance: dict

    @classmethod
    def create(cls, *, parent_ids: tuple[str, ...], mutation_family: str,
               hypothesis: str, predicted_mechanism: str, expected_exposure: str,
               diff: str, changed_units: tuple[str, ...], provenance: dict) -> "Candidate":
        if not mutation_family or not hypothesis or not predicted_mechanism or not expected_exposure:
            raise CandidateError("candidate causal fields must be non-empty")
        if not isinstance(diff, str):
            raise CandidateError("candidate diff must be text")
        if not changed_units or len(changed_units) != len(set(changed_units)):
            raise CandidateError("candidate changed units must be non-empty and unique")
        body = {
            "schema": SCHEMA, "parent_ids": list(parent_ids), "mutation_family": mutation_family,
            "hypothesis": hypothesis, "predicted_mechanism": predicted_mechanism,
            "expected_exposure": expected_exposure, "diff_sha256": hashlib.sha256(diff.encode()).hexdigest(),
            "changed_units": list(changed_units), "provenance": provenance,
        }
        candidate_id = "sha256:" + hashlib.sha256(_canonical(body)).hexdigest()
        return cls(candidate_id, parent_ids, mutation_family, hypothesis, predicted_mechanism,
                   expected_exposure, diff, body["diff_sha256"], changed_units, dict(provenance))

    def to_dict(self) -> dict:
        return {
            "schema": SCHEMA, "candidate_id": self.candidate_id, "parent_ids": list(self.parent_ids),
            "mutation_family": self.mutation_family, "hypothesis": self.hypothesis,
            "predicted_mechanism": self.predicted_mechanism, "expected_exposure": self.expected_exposure,
            "diff": self.diff, "diff_sha256": self.diff_sha256,
            "changed_units": list(self.changed_units), "provenance": self.provenance,
        }

    def card(self, *, train: dict | None = None, development_validated: bool = False,
             accepted_lessons: tuple[str, ...] = ()) -> dict:
        """Return a bounded evolution card; never expose mutation text or traces."""
        disposition = "not-evaluated"
        if isinstance(train, dict):
            disposition = "accepted" if train.get("accepted") is True else "rejected"
        return {
            "candidate_id": self.candidate_id,
            "parent_ids": list(self.parent_ids),
            "mutation_family": self.mutation_family,
            "hypothesis": self.hypothesis[:1024],
            "predicted_mechanism": self.predicted_mechanism[:1024],
            "expected_exposure": self.expected_exposure[:1024],
            "changed_units": list(self.changed_units),
            "verified_diff_sha256": self.diff_sha256,
            "train_disposition": disposition,
            "development_validated": bool(development_validated),
            "accepted_lessons": list(accepted_lessons)[:8],
        }

    @classmethod
    def from_dict(cls, value: dict) -> "Candidate":
        candidate = cls.create(
            parent_ids=tuple(value["parent_ids"]), mutation_family=value["mutation_family"],
            hypothesis=value["hypothesis"], predicted_mechanism=value["predicted_mechanism"],
            expected_exposure=value["expected_exposure"], diff=value["diff"],
            changed_units=tuple(value["changed_units"]), provenance=value["provenance"],
        )
        if candidate.candidate_id != value.get("candidate_id") or candidate.diff_sha256 != value.get("diff_sha256"):
            raise CandidateError("candidate content address does not match content")
        return candidate


def _transitive_units(candidate: Candidate, candidates_by_id: dict[str, Candidate] | None) -> set[str]:
    units = set(candidate.changed_units)
    if candidates_by_id is None:
        return units
    for parent_id in candidate.parent_ids:
        parent = candidates_by_id.get(parent_id)
        if parent is not None:
            units.update(_transitive_units(parent, candidates_by_id))
    return units


def _ancestors(candidate: Candidate, candidates_by_id: dict[str, Candidate]) -> set[str]:
    result = {candidate.candidate_id}
    for parent_id in candidate.parent_ids:
        parent = candidates_by_id.get(parent_id)
        if parent is not None:
            result.update(_ancestors(parent, candidates_by_id))
    return result


def _branch_units(candidate: Candidate, candidates_by_id: dict[str, Candidate], shared: set[str]) -> set[str]:
    units = set() if candidate.candidate_id in shared else set(candidate.changed_units)
    for parent_id in candidate.parent_ids:
        parent = candidates_by_id.get(parent_id)
        if parent is not None:
            units.update(_branch_units(parent, candidates_by_id, shared))
    return units


def compose_candidates(left: Candidate, right: Candidate, *, accepted_ids: set[str],
                       candidates_by_id: dict[str, Candidate] | None = None) -> Candidate:
    if left.candidate_id not in accepted_ids or right.candidate_id not in accepted_ids:
        raise CandidateError("composition parents must both be accepted candidates")
    if candidates_by_id is not None and not (_ancestors(left, candidates_by_id) & _ancestors(right, candidates_by_id)):
        raise CandidateError("composition parents must share a common baseline")
    if candidates_by_id is None:
        conflicts = set(left.changed_units) & set(right.changed_units)
    else:
        shared = _ancestors(left, candidates_by_id) & _ancestors(right, candidates_by_id)
        conflicts = _branch_units(left, candidates_by_id, shared) & _branch_units(right, candidates_by_id, shared)
    if conflicts:
        raise CandidateError(f"composition changed-unit conflict: {', '.join(sorted(conflicts))}")
    return Candidate.create(
        parent_ids=(left.candidate_id, right.candidate_id), mutation_family="composition",
        hypothesis=f"Compose accepted hypotheses: {left.hypothesis}; {right.hypothesis}",
        predicted_mechanism=f"{left.predicted_mechanism}; {right.predicted_mechanism}",
        expected_exposure=f"{left.expected_exposure}; {right.expected_exposure}",
        diff=left.diff + "\n" + right.diff,
        changed_units=tuple(sorted(set(left.changed_units) | set(right.changed_units))),
        provenance={"composition": [left.candidate_id, right.candidate_id]},
    )
