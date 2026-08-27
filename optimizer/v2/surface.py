from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

from .candidates import Candidate, CandidateError


DIFF_PATH = re.compile(r"^(?:---|\+\+\+)\s+(?:[ab]/)?([^\t\n]+)$", re.MULTILINE)


def _contained_relative(path_text: str) -> pathlib.PurePosixPath:
    path = pathlib.PurePosixPath(path_text)
    if path.is_absolute() or not path.parts or ".." in path.parts or "." in path.parts or path_text == "/dev/null":
        raise CandidateError(f"mutation path is not contained: {path_text}")
    return path


class PatchSurfaceAdapter:
    """Typed full-harness unified-diff adapter with isolated materialization."""

    plugin_name = "pi-harness-patch"

    def __init__(self, source_root: pathlib.Path, workspace_root: pathlib.Path,
                 family_allowlists: dict[str, tuple[str, ...]],
                 verification_commands: dict[str, tuple[tuple[str, ...], ...]] | None = None):
        self.source_root = source_root.resolve()
        self.workspace_root = workspace_root.resolve()
        self.workspace_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.workspace_root, 0o700)
        self.family_allowlists = family_allowlists
        self.verification_commands = verification_commands or {}

    def seed_candidate(self, campaign) -> Candidate:
        return Candidate.create(
            parent_ids=(), mutation_family="seed", hypothesis="Current source surface",
            predicted_mechanism="baseline", expected_exposure="baseline", diff="seed",
            changed_units=("source-surface",), provenance={"source_sha256": campaign.provenance["source_sha256"]},
        )

    def _paths(self, diff: str) -> tuple[str, ...]:
        paths = []
        for value in DIFF_PATH.findall(diff):
            if value == "/dev/null":
                continue
            paths.append(str(_contained_relative(value)))
        if not paths:
            raise CandidateError("mutation diff has no bounded file paths")
        return tuple(sorted(set(paths)))

    def build_candidate(self, parent: Candidate, diagnosis_patch: dict, campaign) -> Candidate:
        if not isinstance(diagnosis_patch, dict) or set(diagnosis_patch) != {"family", "diff", "changed_units"}:
            raise CandidateError("mutation must contain exactly family, diff, and changed_units")
        family = diagnosis_patch["family"]
        if family not in campaign.permitted_surface_families or family not in self.family_allowlists:
            raise CandidateError(f"unauthorized mutation family: {family}")
        paths = self._paths(diagnosis_patch["diff"])
        declared = tuple(sorted(str(_contained_relative(value)) for value in diagnosis_patch["changed_units"]))
        if paths != declared:
            raise CandidateError("declared changed units do not match verified diff paths")
        prefixes = self.family_allowlists[family]
        if any(not any(path == prefix.rstrip("/") or path.startswith(prefix.rstrip("/") + "/") for prefix in prefixes) for path in paths):
            raise CandidateError("mutation path is outside its typed-family allowlist")
        return Candidate.create(
            parent_ids=(parent.candidate_id,), mutation_family=family,
            hypothesis="Provider-proposed bounded mutation", predicted_mechanism="diagnosed mechanism",
            expected_exposure="declared exposure", diff=diagnosis_patch["diff"],
            changed_units=paths, provenance={"parent": parent.candidate_id},
        )

    def verify(self, candidate: Candidate, campaign) -> dict:
        if candidate.mutation_family not in self.family_allowlists and candidate.mutation_family != "composition":
            return {"verified": False, "reason": "unknown-family", "diff_sha256": candidate.diff_sha256}
        if candidate.mutation_family == "composition":
            if any(not any(unit == prefix.rstrip("/") or unit.startswith(prefix.rstrip("/") + "/") for prefixes in self.family_allowlists.values() for prefix in prefixes) for unit in candidate.changed_units):
                return {"verified": False, "reason": "composition-path-outside-allowlists", "diff_sha256": candidate.diff_sha256}
            commands = tuple(command for family in sorted(self.verification_commands) for command in self.verification_commands[family])
        else:
            commands = self.verification_commands.get(candidate.mutation_family, ())
        workspace = pathlib.Path(tempfile.mkdtemp(prefix="candidate-", dir=self.workspace_root))
        try:
            shutil.copytree(self.source_root, workspace, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git", ".lavish", "__pycache__"))
            patch_path = workspace / ".optimizer-candidate.patch"
            patch_path.write_text(candidate.diff, encoding="utf-8"); os.chmod(patch_path, 0o600)
            check = subprocess.run(["git", "apply", "--check", str(patch_path)], cwd=workspace, capture_output=True, text=True)
            if check.returncode:
                return {"verified": False, "reason": "diff-check-failed", "diff_sha256": candidate.diff_sha256}
            applied = subprocess.run(["git", "apply", str(patch_path)], cwd=workspace, capture_output=True, text=True)
            if applied.returncode:
                return {"verified": False, "reason": "diff-apply-failed", "diff_sha256": candidate.diff_sha256}
            checks = []
            for command in commands:
                completed = subprocess.run(list(command), cwd=workspace, capture_output=True, text=True, timeout=campaign.limits["case_timeout_seconds"])
                checks.append({"argv": list(command), "ok": completed.returncode == 0})
                if completed.returncode:
                    return {"verified": False, "reason": "verification-command-failed", "checks": checks, "diff_sha256": candidate.diff_sha256}
            return {"verified": True, "checks": checks, "diff_sha256": candidate.diff_sha256, "changed_units": list(candidate.changed_units)}
        finally:
            shutil.rmtree(workspace, ignore_errors=True)


class ConfigSurfaceAdapter:
    """Immutable JSON configuration surface for the trusted Pi gate.

    Provider output is a JSON merge patch over the current candidate.  Every
    accepted intermediate is stored under its candidate content address; the
    operational path is deliberately absent from candidate identity.
    """

    plugin_name = "pi-gate-config"
    family = "configuration"
    _allowed_keys = frozenset({
        "name", "prediction", "prompt_variant", "format", "scaffold", "optillm",
        "decoding", "thresholds", "messages", "exposure",
    })

    def __init__(self, baseline_path: pathlib.Path, snapshot_root: pathlib.Path,
                 validator_path: pathlib.Path):
        self.baseline_path = baseline_path.resolve()
        self.snapshot_root = snapshot_root.resolve()
        self.validator_path = validator_path.resolve()
        self.snapshot_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.snapshot_root, 0o700)

    @staticmethod
    def _digest(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def _canonical(value: dict) -> bytes:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n"

    @staticmethod
    def _merge(base: object, patch: object) -> object:
        if not isinstance(patch, dict):
            return patch
        result = dict(base) if isinstance(base, dict) else {}
        for key, value in patch.items():
            if value is None:
                result.pop(key, None)
            else:
                result[key] = ConfigSurfaceAdapter._merge(result.get(key), value)
        return result

    def _candidate_dir(self, candidate: Candidate) -> pathlib.Path:
        digest = candidate.candidate_id.removeprefix("sha256:")
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise CandidateError("candidate ID is not a content address")
        return self.snapshot_root / digest

    def _snapshot_path(self, candidate: Candidate) -> pathlib.Path:
        return self._candidate_dir(candidate) / "config.json"

    def _write_snapshot(self, candidate: Candidate, data: bytes) -> pathlib.Path:
        directory = self._candidate_dir(candidate)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory, 0o700)
        path = directory / "config.json"
        if path.exists():
            if path.read_bytes() != data:
                raise CandidateError("content-addressed config snapshot collision")
            return path
        fd, temporary = tempfile.mkstemp(prefix=".config.", dir=directory)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(data); fh.flush(); os.fsync(fh.fileno())
            os.replace(temporary, path); os.chmod(path, 0o600)
            directory_fd = os.open(directory, os.O_RDONLY)
            try: os.fsync(directory_fd)
            finally: os.close(directory_fd)
        except Exception:
            try: os.unlink(temporary)
            except OSError: pass
            raise
        return path

    def materialize(self, candidate: Candidate) -> pathlib.Path:
        path = self._snapshot_path(candidate)
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise CandidateError("candidate config snapshot is missing") from exc
        expected = candidate.provenance.get("materialized_config_sha256")
        if not isinstance(expected, str) or self._digest(data) != expected:
            raise CandidateError("candidate config snapshot does not match immutable provenance")
        return path

    def seed_candidate(self, campaign) -> Candidate:
        data = self.baseline_path.read_bytes()
        digest = self._digest(data)
        if digest != campaign.provenance["config_sha256"]:
            raise CandidateError("baseline config does not match campaign provenance")
        candidate = Candidate.create(
            parent_ids=(), mutation_family="seed", hypothesis="Current gate configuration",
            predicted_mechanism="baseline", expected_exposure="baseline", diff=data.decode("utf-8"),
            changed_units=("config",), provenance={
                "source_sha256": campaign.provenance["source_sha256"],
                "materialized_config_sha256": digest,
            },
        )
        self._write_snapshot(candidate, data)
        return candidate

    def build_candidate(self, parent: Candidate, diagnosis_patch: dict, campaign) -> Candidate:
        if not isinstance(diagnosis_patch, dict) or set(diagnosis_patch) != {"family", "diff", "changed_units"}:
            raise CandidateError("configuration mutation must contain exactly family, diff, and changed_units")
        if diagnosis_patch["family"] != self.family or self.family not in campaign.permitted_surface_families:
            raise CandidateError("configuration mutation targets an unauthorized family")
        try:
            patch = json.loads(diagnosis_patch["diff"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise CandidateError("configuration diff must be a JSON merge-patch object") from exc
        if not isinstance(patch, dict) or not patch or set(patch) - self._allowed_keys:
            raise CandidateError("configuration merge patch is empty or contains unsupported keys")
        declared = tuple(sorted(diagnosis_patch["changed_units"])) if isinstance(diagnosis_patch["changed_units"], list) else ()
        actual = tuple(sorted(f"config.{key}" for key in patch))
        if declared != actual:
            raise CandidateError("declared changed units do not match configuration merge patch")
        parent_value = json.loads(self.materialize(parent).read_text(encoding="utf-8"))
        merged = self._merge(parent_value, patch)
        if not isinstance(merged, dict):
            raise CandidateError("configuration merge patch did not produce an object")
        data = self._canonical(merged)
        digest = self._digest(data)
        candidate = Candidate.create(
            parent_ids=(parent.candidate_id,), mutation_family=self.family,
            hypothesis="Provider-proposed bounded configuration mutation",
            predicted_mechanism="diagnosed configuration mechanism",
            expected_exposure="declared configuration exposure",
            diff=json.dumps(patch, sort_keys=True, separators=(",", ":")), changed_units=actual,
            provenance={"parent": parent.candidate_id, "materialized_config_sha256": digest},
        )
        self._write_snapshot(candidate, data)
        return candidate

    def verify(self, candidate: Candidate, campaign) -> dict:
        if candidate.mutation_family not in ("seed", self.family):
            return {"verified": False, "reason": "unknown-family", "diff_sha256": candidate.diff_sha256}
        try:
            path = self.materialize(candidate)
        except CandidateError as exc:
            return {"verified": False, "reason": str(exc), "diff_sha256": candidate.diff_sha256}
        script = (
            "import importlib.util,pathlib,sys; p=pathlib.Path(sys.argv[1]); "
            "sys.path.insert(0,str(p.parent)); s=importlib.util.spec_from_file_location('pi_optimizer_config',p); "
            "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
            "import json; m.validate_config(json.load(open(sys.argv[2],encoding='utf-8')))"
        )
        completed = subprocess.run(
            [sys.executable, "-c", script, str(self.validator_path), str(path)],
            capture_output=True, text=True, timeout=campaign.limits["case_timeout_seconds"],
        )
        return {
            "verified": completed.returncode == 0,
            "reason": "ok" if completed.returncode == 0 else "config-validation-failed",
            "checks": [{"name": "prompt-lab-config-validation", "ok": completed.returncode == 0}],
            "diff_sha256": candidate.diff_sha256,
            "changed_units": list(candidate.changed_units),
            "materialized_config_sha256": candidate.provenance["materialized_config_sha256"],
        }
