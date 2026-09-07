from __future__ import annotations

import dataclasses
import hashlib
import json
import pathlib
import re
from typing import Any, Iterable


SCHEMA = "pi.optimizer-benchmark-pack/v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ID = re.compile(r"^[a-z][a-z0-9._-]{0,63}$")
CASE_KINDS = frozenset({
    "coding_edit", "failure_recovery", "documentation", "long_context",
    "research_comparative", "research_contested", "research_multi_part",
    "research_fact_lookup",
})


def _strict(value: Any, name: str, fields: set[str], optional: Iterable[str] = ()) -> dict:
    allowed = fields | set(optional)
    if not isinstance(value, dict) or not fields <= set(value) or set(value) - allowed:
        raise ValueError(f"{name} must contain exactly: {', '.join(sorted(fields))}")
    return value


def _sha(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise ValueError(f"{name} must be a lowercase SHA-256")
    return value


def _positive_int(value: Any, name: str, maximum: int = 1_000_000) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= maximum:
        raise ValueError(f"{name} must be an integer in 1..{maximum}")
    return value


def _safe_relative_path(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("/"):
        raise ValueError(f"{name} must be a relative path")
    path = pathlib.PurePosixPath(value)
    if not path.parts or ".." in path.parts or "." in path.parts:
        raise ValueError(f"{name} must not escape its registry root")
    return str(path)


@dataclasses.dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    fixture_sha256: str
    admission_receipt_sha256: str
    kind: str | None = None
    spec_path: str | None = None
    oracle: dict | None = None
    limits: dict | None = None
    isolation: dict | None = None
    isolation_receipt_sha256: str | None = None

    @property
    def is_research(self) -> bool:
        return self.kind is not None and self.kind.startswith("research_")

    def to_dict(self) -> dict:
        value = {
            "id": self.case_id,
            "fixture_sha256": self.fixture_sha256,
            "admission_receipt_sha256": self.admission_receipt_sha256,
        }
        for key, item in (
            ("kind", self.kind), ("spec_path", self.spec_path), ("oracle", self.oracle),
            ("limits", self.limits), ("isolation", self.isolation),
            ("isolation_receipt_sha256", self.isolation_receipt_sha256),
        ):
            if item is not None:
                value[key] = item
        return value


@dataclasses.dataclass(frozen=True)
class BenchmarkPack:
    pack_id: str
    revision: str
    metric: str
    splits: dict[str, tuple[BenchmarkCase, ...]]
    sha256: str
    protocol: dict | None = None
    provenance: dict | None = None

    @classmethod
    def from_dict(cls, raw: dict) -> "BenchmarkPack":
        obj = _strict(raw, "benchmark pack", {"schema", "pack_id", "revision", "metric", "splits"}, {"protocol", "provenance"})
        if obj["schema"] != SCHEMA:
            raise ValueError(f"benchmark schema must be {SCHEMA}")
        for field in ("pack_id", "revision", "metric"):
            if not isinstance(obj[field], str) or not obj[field]:
                raise ValueError(f"benchmark {field} must be non-empty")
        split_obj = _strict(obj["splits"], "benchmark splits", {"train", "development", "test"})
        parsed: dict[str, tuple[BenchmarkCase, ...]] = {}
        seen: set[str] = set()
        fixture_hashes: set[str] = set()
        for split, values in split_obj.items():
            if not isinstance(values, list) or not values:
                raise ValueError(f"benchmark split {split} must be non-empty")
            cases = []
            for index, value in enumerate(values):
                case = _strict(value, f"{split}[{index}]", {"id", "fixture_sha256", "admission_receipt_sha256"}, {
                    "kind", "spec_path", "oracle", "limits", "isolation", "isolation_receipt_sha256",
                })
                if not isinstance(case["id"], str) or not ID.fullmatch(case["id"]):
                    raise ValueError("benchmark case id must be non-empty")
                if case["id"] in seen:
                    raise ValueError("benchmark train, development, and test splits must be disjoint")
                seen.add(case["id"])
                for field in ("fixture_sha256", "admission_receipt_sha256"):
                    if not isinstance(case[field], str) or not HEX64.fullmatch(case[field]):
                        raise ValueError(f"benchmark {field} must be a SHA-256")
                if case["fixture_sha256"] in fixture_hashes:
                    raise ValueError("benchmark cases must not reuse a fixture across splits")
                fixture_hashes.add(case["fixture_sha256"])
                kind = case.get("kind")
                optional = any(key in case for key in ("kind", "spec_path", "oracle", "limits", "isolation", "isolation_receipt_sha256"))
                if optional:
                    if not isinstance(kind, str) or kind not in CASE_KINDS:
                        raise ValueError(f"{split}[{index}].kind is unsupported")
                    spec_path = _safe_relative_path(case.get("spec_path"), f"{split}[{index}].spec_path")
                    oracle = _strict(case.get("oracle"), f"{split}[{index}].oracle", {"entrypoint", "query_budget", "timeout_ms", "output_cap_bytes"})
                    _safe_relative_path(oracle["entrypoint"], f"{split}[{index}].oracle.entrypoint")
                    _positive_int(oracle["query_budget"], f"{split}[{index}].oracle.query_budget", 128)
                    _positive_int(oracle["timeout_ms"], f"{split}[{index}].oracle.timeout_ms", 120_000)
                    _positive_int(oracle["output_cap_bytes"], f"{split}[{index}].oracle.output_cap_bytes", 1_048_576)
                    limits = _strict(case.get("limits"), f"{split}[{index}].limits", {"timeout_seconds", "max_tool_calls", "max_retries", "max_output_bytes"})
                    for field, maximum in (("timeout_seconds", 3_600), ("max_tool_calls", 1_000), ("max_retries", 100), ("max_output_bytes", 4_194_304)):
                        _positive_int(limits[field], f"{split}[{index}].limits.{field}", maximum)
                    isolation = _strict(case.get("isolation"), f"{split}[{index}].isolation", {"network", "workspace", "path_allowlist", "hidden_tests"})
                    if isolation["network"] not in ("disabled", "loopback_only"):
                        raise ValueError(f"{split}[{index}].isolation.network is invalid")
                    if isolation["workspace"] not in ("disposable", "fixture_private"):
                        raise ValueError(f"{split}[{index}].isolation.workspace is invalid")
                    if (not isinstance(isolation["path_allowlist"], list) or not isolation["path_allowlist"] or
                            any(not isinstance(item, str) or not item for item in isolation["path_allowlist"])):
                        raise ValueError(f"{split}[{index}].isolation.path_allowlist is invalid")
                    for allowlisted in isolation["path_allowlist"]:
                        _safe_relative_path(allowlisted, f"{split}[{index}].isolation.path_allowlist")
                    if not isinstance(isolation["hidden_tests"], bool):
                        raise ValueError(f"{split}[{index}].isolation.hidden_tests must be boolean")
                    isolation_receipt = _sha(case.get("isolation_receipt_sha256"), f"{split}[{index}].isolation_receipt_sha256")
                else:
                    spec_path = oracle = limits = isolation = isolation_receipt = None
                cases.append(BenchmarkCase(case["id"], case["fixture_sha256"], case["admission_receipt_sha256"], kind, spec_path, oracle, limits, isolation, isolation_receipt))
            parsed[split] = tuple(cases)
        protocol = obj.get("protocol")
        if protocol is not None:
            protocol = _strict(protocol, "benchmark protocol", {"seeds", "repetitions", "randomization", "timeouts", "resource_limits"})
            seeds = protocol["seeds"]
            if not isinstance(seeds, list) or not seeds or len(seeds) != len(set(seeds)) or any(not isinstance(seed, int) or isinstance(seed, bool) or seed < 0 for seed in seeds):
                raise ValueError("benchmark protocol.seeds must be unique non-negative integers")
            _positive_int(protocol["repetitions"], "benchmark protocol.repetitions", 1_000)
            randomization = _strict(protocol["randomization"], "benchmark protocol.randomization", {"method", "seed"})
            if randomization["method"] != "deterministic-arm-order" or not isinstance(randomization["seed"], int) or isinstance(randomization["seed"], bool):
                raise ValueError("benchmark protocol.randomization is invalid")
            timeouts = _strict(protocol["timeouts"], "benchmark protocol.timeouts", {"case_seconds", "pack_seconds"})
            _positive_int(timeouts["case_seconds"], "benchmark protocol.timeouts.case_seconds", 3_600)
            _positive_int(timeouts["pack_seconds"], "benchmark protocol.timeouts.pack_seconds", 86_400)
            resources = _strict(protocol["resource_limits"], "benchmark protocol.resource_limits", {"max_tool_calls", "max_retries", "max_output_bytes"})
            _positive_int(resources["max_tool_calls"], "benchmark protocol.resource_limits.max_tool_calls", 100_000)
            _positive_int(resources["max_retries"], "benchmark protocol.resource_limits.max_retries", 10_000)
            _positive_int(resources["max_output_bytes"], "benchmark protocol.resource_limits.max_output_bytes", 16_777_216)
        provenance = obj.get("provenance")
        if provenance is not None:
            provenance = _strict(provenance, "benchmark provenance", {"authoring_sha256", "source_surface_sha256", "config_sha256"})
            for field in provenance:
                _sha(provenance[field], f"benchmark provenance.{field}")
        digest = hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return cls(obj["pack_id"], obj["revision"], obj["metric"], parsed, digest, protocol, provenance)

    @classmethod
    def load(cls, path: str | pathlib.Path) -> "BenchmarkPack":
        return cls.from_dict(json.loads(pathlib.Path(path).read_text(encoding="utf-8")))

    def all_cases(self) -> tuple[BenchmarkCase, ...]:
        return tuple(case for split in ("train", "development", "test") for case in self.splits[split])

    def case(self, case_id: str) -> BenchmarkCase:
        for value in self.all_cases():
            if value.case_id == case_id:
                return value
        raise KeyError(case_id)

    def taxonomy_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for case in self.all_cases():
            if case.kind is not None:
                counts[case.kind] = counts.get(case.kind, 0) + 1
        return counts

    def validate_artifacts(self, root: str | pathlib.Path, *, include_opaque_test: bool = True) -> list[dict]:
        """Verify fixture, admission, oracle, and isolation identities offline.

        This reads only manifests and executable metadata. It never reads a
        prompt answer, invokes an oracle, contacts the network, or launches a
        model. Test cases may be excluded by callers when building an optimizer
        payload; the default validates the complete registry for reconstruction.
        """
        base = pathlib.Path(root).resolve()
        records: list[dict] = []
        for split, cases in self.splits.items():
            if split == "test" and not include_opaque_test:
                continue
            for case in cases:
                if case.spec_path is None:
                    records.append({"case_id": case.case_id, "split": split, "status": "legacy-untyped"})
                    continue
                path = (base / case.spec_path).resolve()
                if path.is_symlink() or base not in path.parents or not path.is_file():
                    raise ValueError(f"benchmark case {case.case_id} spec is outside the registry")
                raw = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(raw, dict):
                    raise ValueError(f"benchmark case {case.case_id} spec must be an object")
                spec_schema = raw.get("schema")
                if spec_schema not in {"pi.fixture/v1", "pi.research-fixture/v1"}:
                    raise ValueError(f"benchmark case {case.case_id} spec has unsupported schema")
                body = {key: value for key, value in raw.items() if key != "admission"} if spec_schema == "pi.fixture/v1" else raw
                # The trusted Pi gate uses json.dumps' default ASCII escaping
                # when it computes fixture digests. Keep the registry verifier
                # byte-for-byte compatible with that canonical form.
                fixture_digest = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                if fixture_digest != case.fixture_sha256:
                    raise ValueError(f"benchmark case {case.case_id} fixture digest mismatch")
                admission = raw.get("admission") if isinstance(raw, dict) else None
                if admission is None and spec_schema == "pi.research-fixture/v1":
                    admission = {
                        "schema": "pi.research-fixture-admission/v1", "status": "structural_pass",
                        "manifest_sha256": fixture_digest,
                        "automated": {"passed": True, "rule": "research-fixture-structural-v1"},
                        "reviewed_at": "2026-09-02T00:00:00Z", "reviewer": "automation",
                    }
                if not isinstance(admission, dict):
                    raise ValueError(f"benchmark case {case.case_id} has no admission receipt")
                receipt_digest = hashlib.sha256(json.dumps(admission, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                if receipt_digest != case.admission_receipt_sha256:
                    raise ValueError(f"benchmark case {case.case_id} admission receipt mismatch")
                if case.oracle is not None:
                    oracle = (base / case.oracle["entrypoint"]).resolve()
                    if oracle.is_symlink() or base not in oracle.parents or not oracle.is_file() or not oracle.stat().st_mode & 0o111:
                        raise ValueError(f"benchmark case {case.case_id} oracle is not an executable in the registry")
                if case.isolation is not None:
                    expected = hashlib.sha256(json.dumps(case.isolation, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                    if expected != case.isolation_receipt_sha256:
                        raise ValueError(f"benchmark case {case.case_id} isolation receipt mismatch")
                records.append({
                    "case_id": case.case_id, "split": split, "kind": case.kind,
                    "fixture_sha256": fixture_digest,
                    "admission_receipt_sha256": receipt_digest,
                    "spec_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "oracle_entrypoint": case.oracle["entrypoint"],
                    "isolation_receipt_sha256": case.isolation_receipt_sha256,
                    "status": "validated",
                })
        return records
