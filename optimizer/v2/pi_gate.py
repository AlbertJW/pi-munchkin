from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import os
import re


class PiGateEvidenceError(ValueError):
    pass


def _row_digest(row: dict) -> str:
    return hashlib.sha256(json.dumps(row, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _row_key(row: dict) -> str:
    variant = ((row.get("prompt") or {}).get("variant")) or "canonical"
    return ":".join(str(row.get(field)) for field in ("run", "model", "split", "task")) + \
        f":{row.get('pattern') or row.get('arm')}:{row.get('rep')}:{re.sub(r'[^A-Za-z0-9._-]', '-', variant)}"


def validate_gate_evidence(rows: list[dict], validity_records: list[dict], *, campaign_sha256: str,
                           config_sha256: str, surface_sha256: str) -> list[dict]:
    verdicts = {record.get("row_key"): record for record in validity_records if isinstance(record, dict)}
    if not rows:
        raise PiGateEvidenceError("Pi gate produced no rows")
    if len(verdicts) != len(validity_records) or len(validity_records) != len(rows):
        raise PiGateEvidenceError("trial-validity sidecar is incomplete or contains duplicate/extra rows")
    accepted = []
    sessions = set()
    for index, row in enumerate(rows):
        errors = []
        if row.get("schema") != "pi.eval-row/v4": errors.append("schema")
        if row.get("authoritative") is not True or row.get("status") != "complete": errors.append("row-authority")
        if (row.get("execution") or {}).get("authoritative") is not True: errors.append("execution-authority")
        if (row.get("harness") or {}).get("surface_sha256") != surface_sha256: errors.append("surface-binding")
        if (row.get("config") or {}).get("sha256") != config_sha256: errors.append("config-binding")
        if (row.get("experiment") or {}).get("manifest_sha256") != campaign_sha256: errors.append("campaign-binding")
        serving = row.get("serving") or {}; pre = serving.get("pre") or {}; post = serving.get("post") or {}
        if serving.get("stable") is not True or pre.get("status") != "complete" or post.get("status") != "complete" or pre.get("full_sha256") != post.get("full_sha256"):
            errors.append("serving-identity")
        context = row.get("context") or {}
        if context.get("schema") != "pi.context-telemetry/v4" or context.get("authenticated") is not True: errors.append("telemetry-authentication")
        if (row.get("exposure") or {}).get("status") not in ("exposed", "not-targeted"):
            errors.append("exposure")
        key = _row_key(row)
        verdict = verdicts.get(key)
        if verdict is None or verdict.get("row_sha256") != _row_digest(row) or verdict.get("void") is not False:
            errors.append("trial-validity")
        session = row.get("gate_session_id")
        if not isinstance(session, str) or not session: errors.append("gate-session")
        else: sessions.add(session)
        if errors:
            raise PiGateEvidenceError(f"gate row {index} is non-authoritative: {', '.join(errors)}")
        accepted.append(row)
    if len(sessions) != 1:
        raise PiGateEvidenceError("gate rows span multiple parent sessions")
    return accepted


def load_fresh_gate_evidence(results_path: pathlib.Path, *, not_before_ns: int) -> tuple[list[dict], list[dict]]:
    results_path = results_path.resolve()
    sidecar = pathlib.Path(str(results_path) + ".validity.jsonl")
    for path in (results_path, sidecar):
        try:
            stat = path.stat()
        except OSError as exc:
            raise PiGateEvidenceError(f"missing gate evidence: {path.name}") from exc
        if stat.st_mtime_ns < not_before_ns:
            raise PiGateEvidenceError(f"stale gate evidence: {path.name}")
        if not path.is_file():
            raise PiGateEvidenceError(f"gate evidence is not a file: {path.name}")
    def read_jsonl(path: pathlib.Path) -> list[dict]:
        records = []
        try:
            with path.open(encoding="utf-8") as fh:
                for number, line in enumerate(fh, 1):
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise ValueError("record is not an object")
                    records.append(value)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            raise PiGateEvidenceError(f"invalid {path.name}: {exc}") from exc
        return records
    return read_jsonl(results_path), read_jsonl(sidecar)


class PiGateScenario:
    """Initial V2 bridge to the trusted Bash evaluator.

    Actual execution is intentionally explicit. Offline verification calls only
    :meth:`dry`, while campaigns call :meth:`run_gate` after approval.
    """

    plugin_name = "pi-gate"

    def __init__(self, optimizer_root: pathlib.Path):
        self.optimizer_root = optimizer_root.resolve()
        self.real_gate = self.optimizer_root / "real_gate.sh"

    def dry(self) -> str:
        completed = subprocess.run([str(self.real_gate), "--dry"], cwd=self.optimizer_root, check=True, capture_output=True, text=True)
        return completed.stdout

    def run_gate(self, arguments: list[str], *, timeout_seconds: int, stdin=None) -> subprocess.CompletedProcess:
        return subprocess.run([str(self.real_gate), *arguments], cwd=self.optimizer_root, stdin=stdin, check=False, capture_output=True, text=True, timeout=timeout_seconds)
