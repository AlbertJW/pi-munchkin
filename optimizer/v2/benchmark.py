from __future__ import annotations

import dataclasses
import hashlib
import json
import pathlib
import re
from typing import Any


SCHEMA = "pi.optimizer-benchmark-pack/v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _strict(value: Any, name: str, fields: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError(f"{name} must contain exactly: {', '.join(sorted(fields))}")
    return value


@dataclasses.dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    fixture_sha256: str
    admission_receipt_sha256: str


@dataclasses.dataclass(frozen=True)
class BenchmarkPack:
    pack_id: str
    revision: str
    metric: str
    splits: dict[str, tuple[BenchmarkCase, ...]]
    sha256: str

    @classmethod
    def from_dict(cls, raw: dict) -> "BenchmarkPack":
        obj = _strict(raw, "benchmark pack", {"schema", "pack_id", "revision", "metric", "splits"})
        if obj["schema"] != SCHEMA:
            raise ValueError(f"benchmark schema must be {SCHEMA}")
        for field in ("pack_id", "revision", "metric"):
            if not isinstance(obj[field], str) or not obj[field]:
                raise ValueError(f"benchmark {field} must be non-empty")
        split_obj = _strict(obj["splits"], "benchmark splits", {"train", "development", "test"})
        parsed: dict[str, tuple[BenchmarkCase, ...]] = {}
        seen: set[str] = set()
        for split, values in split_obj.items():
            if not isinstance(values, list) or not values:
                raise ValueError(f"benchmark split {split} must be non-empty")
            cases = []
            for index, value in enumerate(values):
                case = _strict(value, f"{split}[{index}]", {"id", "fixture_sha256", "admission_receipt_sha256"})
                if not isinstance(case["id"], str) or not case["id"]:
                    raise ValueError("benchmark case id must be non-empty")
                if case["id"] in seen:
                    raise ValueError("benchmark train, development, and test splits must be disjoint")
                seen.add(case["id"])
                for field in ("fixture_sha256", "admission_receipt_sha256"):
                    if not isinstance(case[field], str) or not HEX64.fullmatch(case[field]):
                        raise ValueError(f"benchmark {field} must be a SHA-256")
                cases.append(BenchmarkCase(case["id"], case["fixture_sha256"], case["admission_receipt_sha256"]))
            parsed[split] = tuple(cases)
        digest = hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return cls(obj["pack_id"], obj["revision"], obj["metric"], parsed, digest)

    @classmethod
    def load(cls, path: str | pathlib.Path) -> "BenchmarkPack":
        return cls.from_dict(json.loads(pathlib.Path(path).read_text(encoding="utf-8")))

