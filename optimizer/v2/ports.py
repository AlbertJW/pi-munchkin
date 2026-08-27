from __future__ import annotations

from typing import Any, Protocol

from .benchmark import BenchmarkPack
from .candidates import Candidate
from .manifest import Campaign


class ScenarioAdapter(Protocol):
    plugin_name: str
    benchmark: BenchmarkPack

    def calibrate(self, campaign: Campaign, *, model: dict) -> dict: ...
    def evaluate(self, candidate: Candidate, *, split: str, model: dict, seeds: tuple[int, ...], operation_id: str) -> dict: ...
    def evaluate_pair(self, parent: Candidate, candidate: Candidate, *, model: dict, seeds: tuple[int, ...], operation_id: str) -> dict: ...
    def diagnosis_evidence(self, parent: dict, candidate: dict | None = None) -> dict: ...


class SurfaceAdapter(Protocol):
    plugin_name: str

    def seed_candidate(self, campaign: Campaign) -> Candidate: ...
    def build_candidate(self, parent: Candidate, diagnosis_patch: dict, campaign: Campaign) -> Candidate: ...
    def verify(self, candidate: Candidate, campaign: Campaign) -> dict: ...


class OptimizerProvider(Protocol):
    plugin_name: str

    def session(self, kind: str, payload: dict, *, operation_id: str) -> dict: ...


def require_plugin(actual: Any, expected: str, boundary: str) -> None:
    if getattr(actual, "plugin_name", None) != expected:
        raise ValueError(f"unknown or mismatched {boundary} plugin: expected {expected!r}")
