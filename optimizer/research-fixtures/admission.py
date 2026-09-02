#!/usr/bin/env python3
"""Fail-closed admission for the planner's research-shaped fixture slate.

Research fixtures are deliberately a different contract from coding fixtures.
They describe a question, the independent evidence families it is expected to
touch, and a bounded local oracle.  They never carry answer text, quotes, or
model output.  Admission proves only that the screen has a stable instrument;
it is not a calibration or quality result.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import tempfile
from urllib.parse import urlparse


ROOT = pathlib.Path(__file__).resolve().parent
MANIFESTS = ROOT / "manifests"
ORACLE_ROOT = ROOT / "oracles"
SCHEMA = "pi.research-fixture/v1"
ADMISSION_SCHEMA = "pi.research-fixture-admission/v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
KINDS = {"comparative", "contested", "multi_part", "fact_lookup"}


class AdmissionError(ValueError):
    pass


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def _strict(value: object, name: str, required: set[str], optional: set[str] = frozenset()) -> dict:
    if not isinstance(value, dict):
        raise AdmissionError(f"{name} must be an object")
    unknown = set(value) - required - set(optional)
    missing = required - set(value)
    if unknown:
        raise AdmissionError(f"{name} has unknown field(s): {', '.join(sorted(unknown))}")
    if missing:
        raise AdmissionError(f"{name} is missing field(s): {', '.join(sorted(missing))}")
    return value


def _text(value: object, name: str, *, max_chars: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > max_chars:
        raise AdmissionError(f"{name} must be a non-empty string of at most {max_chars} characters")
    return value


def _id(value: object, name: str) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise AdmissionError(f"{name} must be a safe identifier")
    return value


def _sha(value: object, name: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise AdmissionError(f"{name} must be a resolved lowercase SHA-256")
    return value


def _positive_int(value: object, name: str, *, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= maximum:
        raise AdmissionError(f"{name} must be an integer in 1..{maximum}")
    return value


def _timestamp(value: object, name: str) -> None:
    if not isinstance(value, str):
        raise AdmissionError(f"{name} must be ISO-8601")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AdmissionError(f"{name} must be ISO-8601") from exc
    if parsed.tzinfo is None:
        raise AdmissionError(f"{name} must include a timezone")


def _source_url(value: object, name: str) -> str:
    url = _text(value, name, max_chars=512)
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise AdmissionError(f"{name} must be an https URL without credentials")
    if parsed.query or parsed.fragment:
        raise AdmissionError(f"{name} must not contain a query or fragment")
    return url


def _oracle_path(value: object, manifest_path: pathlib.Path | None) -> pathlib.Path:
    raw = _text(value, "oracle.entrypoint", max_chars=256)
    path = pathlib.Path(raw)
    if path.is_absolute():
        resolved = path.resolve()
    else:
        resolved = ((manifest_path.parent if manifest_path else ROOT) / path).resolve()
    root = ORACLE_ROOT.resolve()
    if not resolved.is_file() or resolved.is_symlink() or root not in resolved.parents:
        raise AdmissionError("oracle.entrypoint must be a regular file under research-fixtures/oracles")
    if not resolved.stat().st_mode & 0o111:
        raise AdmissionError("oracle.entrypoint must be executable")
    return resolved


def validate_manifest(raw: dict, *, manifest_path: pathlib.Path | None = None) -> dict:
    obj = _strict(raw, "research fixture", {
        "schema", "fixture_id", "revision", "kind", "prompt", "source_time_cutoff",
        "evidence_families", "required_claims", "negative_control", "oracle", "provenance",
    })
    if obj["schema"] != SCHEMA:
        raise AdmissionError(f"schema must be {SCHEMA}")
    fixture_id = _id(obj["fixture_id"], "fixture_id")
    _text(obj["revision"], "revision", max_chars=64)
    if obj["kind"] not in KINDS:
        raise AdmissionError("kind must be comparative, contested, multi_part, or fact_lookup")

    prompt = _strict(obj["prompt"], "prompt", {"text", "sha256"})
    prompt_text = _text(prompt["text"], "prompt.text", max_chars=6000)
    if _sha(prompt["sha256"], "prompt.sha256") != hashlib.sha256(prompt_text.encode("utf-8")).hexdigest():
        raise AdmissionError("prompt.sha256 does not match prompt.text")
    _timestamp(obj["source_time_cutoff"], "source_time_cutoff")

    families = obj["evidence_families"]
    if not isinstance(families, list) or not 2 <= len(families) <= 3:
        raise AdmissionError("evidence_families must contain 2..3 independent families")
    family_ids: set[str] = set()
    for index, family in enumerate(families):
        item = _strict(family, f"evidence_families[{index}]", {"id", "role", "source_refs"})
        family_id = _id(item["id"], f"evidence_families[{index}].id")
        if family_id in family_ids:
            raise AdmissionError("evidence family ids must be unique")
        family_ids.add(family_id)
        if item["role"] not in {"primary", "counter", "context"}:
            raise AdmissionError(f"evidence_families[{index}].role is invalid")
        refs = item["source_refs"]
        if not isinstance(refs, list) or not 1 <= len(refs) <= 4:
            raise AdmissionError(f"evidence_families[{index}].source_refs must contain 1..4 references")
        ref_ids: set[str] = set()
        for ref_index, ref in enumerate(refs):
            source = _strict(ref, f"evidence_families[{index}].source_refs[{ref_index}]", {"id", "url", "publisher"})
            source_id = _id(source["id"], "source_refs.id")
            if source_id in ref_ids:
                raise AdmissionError("source ids must be unique within an evidence family")
            ref_ids.add(source_id)
            _source_url(source["url"], "source_refs.url")
            _text(source["publisher"], "source_refs.publisher", max_chars=120)

    claims = obj["required_claims"]
    if not isinstance(claims, list) or not 2 <= len(claims) <= 8:
        raise AdmissionError("required_claims must contain 2..8 claim obligations")
    claim_ids: set[str] = set()
    for index, claim in enumerate(claims):
        item = _strict(claim, f"required_claims[{index}]", {"id", "evidence_family", "grading_rule"})
        claim_id = _id(item["id"], f"required_claims[{index}].id")
        if claim_id in claim_ids:
            raise AdmissionError("required claim ids must be unique")
        claim_ids.add(claim_id)
        if item["evidence_family"] not in family_ids:
            raise AdmissionError(f"required_claims[{index}].evidence_family is not declared")
        _text(item["grading_rule"], f"required_claims[{index}].grading_rule", max_chars=160)

    negative = _strict(obj["negative_control"], "negative_control", {"text", "sha256", "expected_plan_start", "max_source_reads"})
    negative_text = _text(negative["text"], "negative_control.text", max_chars=2000)
    if _sha(negative["sha256"], "negative_control.sha256") != hashlib.sha256(negative_text.encode("utf-8")).hexdigest():
        raise AdmissionError("negative_control.sha256 does not match negative_control.text")
    if negative["expected_plan_start"] is not False:
        raise AdmissionError("negative_control.expected_plan_start must be false")
    _positive_int(negative["max_source_reads"], "negative_control.max_source_reads", maximum=5)

    oracle = _strict(obj["oracle"], "oracle", {"schema", "entrypoint", "query_budget", "timeout_ms", "output_cap_bytes"})
    if oracle["schema"] != "pi.research-oracle/v1":
        raise AdmissionError("oracle.schema must be pi.research-oracle/v1")
    _oracle_path(oracle["entrypoint"], manifest_path)
    _positive_int(oracle["query_budget"], "oracle.query_budget", maximum=128)
    _positive_int(oracle["timeout_ms"], "oracle.timeout_ms", maximum=10_000)
    _positive_int(oracle["output_cap_bytes"], "oracle.output_cap_bytes", maximum=16_384)

    provenance = _strict(obj["provenance"], "provenance", {"authoring_timestamp", "model_snapshot_boundary", "contamination_canary_hash"})
    _timestamp(provenance["authoring_timestamp"], "provenance.authoring_timestamp")
    _text(provenance["model_snapshot_boundary"], "provenance.model_snapshot_boundary", max_chars=160)
    _sha(provenance["contamination_canary_hash"], "provenance.contamination_canary_hash")
    return obj


def load_manifest(path: pathlib.Path) -> tuple[dict, str]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AdmissionError(f"cannot read {path}: {exc}") from exc
    obj = validate_manifest(raw, manifest_path=path)
    return obj, digest(obj)


def admission_receipt(obj: dict, manifest_sha256: str) -> dict:
    return {
        "schema": ADMISSION_SCHEMA,
        "status": "structural_pass",
        "manifest_sha256": manifest_sha256,
        "automated": {"passed": True, "rule": "research-fixture-structural-v1"},
        "reviewed_at": "2026-09-02T00:00:00Z",
        "reviewer": "automation",
    }


def check_slate() -> list[dict]:
    records = []
    for path in sorted(MANIFESTS.glob("*.json")):
        obj, manifest_sha = load_manifest(path)
        records.append({"fixture_id": obj["fixture_id"], "kind": obj["kind"], "manifest_sha256": manifest_sha, "admission": admission_receipt(obj, manifest_sha)})
    if len(records) < 3:
        raise AdmissionError("research planner screen requires at least three fixtures")
    kinds = {record["kind"] for record in records}
    required = {"comparative", "contested", "multi_part"}
    if not required.issubset(kinds):
        raise AdmissionError("slate must include comparative, contested, and multi_part fixtures")
    ids = [record["fixture_id"] for record in records]
    if len(ids) != len(set(ids)):
        raise AdmissionError("fixture ids must be unique")
    return records


def selftest() -> None:
    records = check_slate()
    assert len(records) >= 3
    assert all(record["admission"]["status"] == "structural_pass" for record in records)
    assert all(record["admission"]["reviewer"] == "automation" for record in records)
    fixture, _ = load_manifest(MANIFESTS / "comparative.json")
    broken = json.loads(json.dumps(fixture))
    broken["prompt"]["sha256"] = "0" * 64
    try:
        validate_manifest(broken, manifest_path=MANIFESTS / "comparative.json")
    except AdmissionError:
        pass
    else:
        raise AssertionError("prompt hash drift must be rejected")
    broken = json.loads(json.dumps(fixture)); broken["surprise"] = True
    try:
        validate_manifest(broken, manifest_path=MANIFESTS / "comparative.json")
    except AdmissionError:
        pass
    else:
        raise AssertionError("unknown manifest fields must be rejected")
    print(f"research-fixture admission selftest: OK ({len(records)} fixtures, no inference)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research-fixtures/admission.py")
    parser.add_argument("--selftest", action="store_true")
    modes = parser.add_subparsers(dest="command")
    check = modes.add_parser("check"); check.add_argument("--manifest")
    args = parser.parse_args(argv)
    try:
        if args.selftest:
            selftest(); return 0
        if args.command != "check":
            parser.error("choose check or --selftest")
        if args.manifest:
            obj, manifest_sha = load_manifest(pathlib.Path(args.manifest).resolve())
            print(json.dumps({"fixture_id": obj["fixture_id"], "kind": obj["kind"], "manifest_sha256": manifest_sha, "admission": admission_receipt(obj, manifest_sha)}, sort_keys=True))
        else:
            print(json.dumps(check_slate(), sort_keys=True))
        return 0
    except AdmissionError as exc:
        print(f"research-fixture admission: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
