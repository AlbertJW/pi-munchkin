from __future__ import annotations

import dataclasses
import hashlib
import json
import pathlib
import re
from typing import Any


SCHEMA = "pi.optimizer-campaign/v2"
HEX64 = re.compile(r"^[0-9a-f]{64}$")


class ManifestError(ValueError):
    pass


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _strict(value: Any, name: str, required: set[str], optional: set[str] = frozenset()) -> dict:
    if not isinstance(value, dict):
        raise ManifestError(f"{name} must be an object")
    unknown = set(value) - required - set(optional)
    missing = required - set(value)
    if unknown:
        raise ManifestError(f"{name} has unknown field(s): {', '.join(sorted(unknown))}")
    if missing:
        raise ManifestError(f"{name} is missing field(s): {', '.join(sorted(missing))}")
    return value


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ManifestError(f"{name} must be a non-empty string")
    return value


def _sha(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise ManifestError(f"{name} must be a resolved lowercase SHA-256")
    return value


def _positive_int(value: Any, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ManifestError(f"{name} must be a positive integer")
    return value


@dataclasses.dataclass(frozen=True)
class Campaign:
    raw: dict
    sha256: str
    schema: str
    campaign_id: str
    primary_metric: dict
    hard_guards: tuple[dict, ...]
    optimizer_provider: dict
    surface_adapter: dict
    subject_model: dict
    guard_models: tuple[dict, ...]
    benchmark: dict
    permitted_surface_families: tuple[str, ...]
    seeds: tuple[int, ...]
    limits: dict
    provenance: dict

    def to_dict(self) -> dict:
        return json.loads(canonical_json(self.raw))


def _model(value: Any, name: str) -> dict:
    obj = _strict(value, name, {"provider", "model"})
    _text(obj["provider"], f"{name}.provider")
    _text(obj["model"], f"{name}.model")
    return dict(obj)


def load_campaign(source: dict | str | pathlib.Path) -> Campaign:
    if isinstance(source, (str, pathlib.Path)):
        path = pathlib.Path(source)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ManifestError(f"cannot read campaign manifest: {exc}") from exc
    else:
        raw = json.loads(canonical_json(source))
    obj = _strict(raw, "campaign", {
        "schema", "campaign_id", "primary_metric", "hard_guards",
        "optimizer_provider", "surface_adapter", "subject_model", "guard_models", "benchmark",
        "permitted_surface_families", "seeds", "limits", "provenance",
    })
    if obj["schema"] != SCHEMA:
        raise ManifestError(f"schema must be {SCHEMA}")
    campaign_id = _text(obj["campaign_id"], "campaign_id")
    metric = _strict(obj["primary_metric"], "primary_metric", {"name", "direction", "kind", "paired_policy"})
    _text(metric["name"], "primary_metric.name")
    if metric["direction"] not in ("maximize", "minimize"):
        raise ManifestError("primary_metric.direction must be maximize or minimize")
    if metric["kind"] not in ("binary", "continuous"):
        raise ManifestError("primary_metric.kind must be binary or continuous")
    policy = _strict(metric["paired_policy"], "primary_metric.paired_policy", {"name"}, {"minimum_net_fixes", "alpha", "permutations"})
    _text(policy["name"], "primary_metric.paired_policy.name")
    guards = obj["hard_guards"]
    if not isinstance(guards, list) or not guards:
        raise ManifestError("hard_guards must be a non-empty list")
    for index, guard in enumerate(guards):
        guard = _strict(guard, f"hard_guards[{index}]", {"metric", "direction", "threshold"})
        _text(guard["metric"], f"hard_guards[{index}].metric")
        if guard["direction"] not in ("at_most", "at_least") or not isinstance(guard["threshold"], (int, float)) or isinstance(guard["threshold"], bool):
            raise ManifestError(f"hard_guards[{index}] is invalid")
    provider = _strict(obj["optimizer_provider"], "optimizer_provider", {"plugin", "config"})
    _text(provider["plugin"], "optimizer_provider.plugin")
    if not isinstance(provider["config"], dict):
        raise ManifestError("optimizer_provider.config must be an object")
    surface = _strict(obj["surface_adapter"], "surface_adapter", {"plugin", "config"})
    _text(surface["plugin"], "surface_adapter.plugin")
    if not isinstance(surface["config"], dict):
        raise ManifestError("surface_adapter.config must be an object")
    subject = _model(obj["subject_model"], "subject_model")
    if not isinstance(obj["guard_models"], list):
        raise ManifestError("guard_models must be a list")
    guard_models = tuple(_model(value, f"guard_models[{i}]") for i, value in enumerate(obj["guard_models"]))
    benchmark = _strict(obj["benchmark"], "benchmark", {"plugin", "pack_id", "revision", "manifest", "discrimination_band"}, {"adapter_config"})
    for field in ("plugin", "pack_id", "revision", "manifest"):
        _text(benchmark[field], f"benchmark.{field}")
    band = _strict(benchmark["discrimination_band"], "benchmark.discrimination_band", {"minimum", "maximum", "minimum_cases"})
    if not all(isinstance(band[field], (int, float)) and not isinstance(band[field], bool) for field in ("minimum", "maximum")):
        raise ManifestError("benchmark discrimination bounds must be numeric")
    if not 0 <= band["minimum"] < band["maximum"] <= 1:
        raise ManifestError("benchmark discrimination band must satisfy 0 <= minimum < maximum <= 1")
    _positive_int(band["minimum_cases"], "benchmark.discrimination_band.minimum_cases")
    if "adapter_config" in benchmark and not isinstance(benchmark["adapter_config"], dict):
        raise ManifestError("benchmark.adapter_config must be an object")
    families = obj["permitted_surface_families"]
    if not isinstance(families, list) or not families or len(families) != len(set(families)):
        raise ManifestError("permitted_surface_families must be a non-empty unique list")
    for index, family in enumerate(families):
        _text(family, f"permitted_surface_families[{index}]")
    seeds = obj["seeds"]
    if not isinstance(seeds, list) or not seeds or len(seeds) != len(set(seeds)) or any(not isinstance(seed, int) or isinstance(seed, bool) or seed < 0 for seed in seeds):
        raise ManifestError("seeds must be a non-empty unique list of non-negative integers")
    limits = _strict(obj["limits"], "limits", {"iterations", "rollouts_per_candidate", "provider_sessions", "wall_seconds", "case_timeout_seconds"})
    for field, value in limits.items():
        _positive_int(value, f"limits.{field}")
    provenance = _strict(obj["provenance"], "provenance", {"source_sha256", "config_sha256", "surface_sha256"})
    for field, value in provenance.items():
        _sha(value, f"provenance.{field}")
    digest = hashlib.sha256(canonical_json(obj)).hexdigest()
    return Campaign(
        raw=obj, sha256=digest, schema=SCHEMA, campaign_id=campaign_id,
        primary_metric=dict(metric), hard_guards=tuple(dict(value) for value in guards),
        optimizer_provider=dict(provider), surface_adapter=dict(surface), subject_model=subject, guard_models=guard_models,
        benchmark=dict(benchmark), permitted_surface_families=tuple(families),
        seeds=tuple(seeds), limits=dict(limits), provenance=dict(provenance),
    )
