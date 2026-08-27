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


def compose_candidates(left: Candidate, right: Candidate, *, accepted_ids: set[str]) -> Candidate:
    if left.candidate_id not in accepted_ids or right.candidate_id not in accepted_ids:
        raise CandidateError("composition parents must both be accepted candidates")
    conflicts = set(left.changed_units) & set(right.changed_units)
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

