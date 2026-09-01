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

    def build_candidate(self, parent: Candidate, diagnosis: dict, campaign) -> Candidate:
        diagnosis_patch = diagnosis.get("mutation") if isinstance(diagnosis, dict) else None
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
            hypothesis=diagnosis["root_cause_hypothesis"],
            predicted_mechanism=f"Address the diagnosed cause through {diagnosis['target_surface']}",
            expected_exposure=diagnosis["expected_exposure"], diff=diagnosis_patch["diff"],
            changed_units=paths, provenance={"parent": parent.candidate_id, "falsifier": diagnosis["falsifier"], "rollback_condition": diagnosis["rollback_condition"]},
        )

    def describe_materialized(self, candidate: Candidate, *, candidates_by_id: dict[str, Candidate] | None = None) -> dict:
        return {
            "candidate_id": candidate.candidate_id,
            "parent_ids": list(candidate.parent_ids),
            "changed_units": list(candidate.changed_units),
            "materialization": "full-parent-chain",
        }

    def compose(self, left: Candidate, right: Candidate, *, candidates_by_id: dict[str, Candidate], campaign) -> Candidate:
        from .candidates import compose_candidates
        return compose_candidates(left, right, accepted_ids=set(candidates_by_id), candidates_by_id=candidates_by_id)

    def _apply_chain(self, workspace: pathlib.Path, candidate: Candidate,
                     candidates_by_id: dict[str, Candidate] | None, seen: set[str]) -> None:
        if candidate.candidate_id in seen:
            raise CandidateError("candidate ancestry cycle")
        seen.add(candidate.candidate_id)
        if candidate.mutation_family == "composition":
            patch_path = workspace / ".optimizer-candidate.patch"
            patch_path.write_text(candidate.diff, encoding="utf-8")
            check = subprocess.run(["git", "apply", "--check", str(patch_path)], cwd=workspace, capture_output=True, text=True)
            if check.returncode:
                raise CandidateError("composition diff does not apply to baseline")
            applied = subprocess.run(["git", "apply", str(patch_path)], cwd=workspace, capture_output=True, text=True)
            if applied.returncode:
                raise CandidateError("composition diff failed to apply")
            return
        for parent_id in candidate.parent_ids:
            parent = candidates_by_id.get(parent_id) if candidates_by_id else None
            if parent is None:
                raise CandidateError("candidate parent is unavailable for materialization")
            self._apply_chain(workspace, parent, candidates_by_id, seen)
        if candidate.mutation_family == "seed":
            return
        patch_path = workspace / f".optimizer-{candidate.candidate_id.removeprefix('sha256:')}.patch"
        patch_path.write_text(candidate.diff, encoding="utf-8")
        check = subprocess.run(["git", "apply", "--check", str(patch_path)], cwd=workspace, capture_output=True, text=True)
        if check.returncode:
            raise CandidateError("ancestor materialization diff does not apply")
        applied = subprocess.run(["git", "apply", str(patch_path)], cwd=workspace, capture_output=True, text=True)
        if applied.returncode:
            raise CandidateError("ancestor materialization diff failed to apply")

    def verify(self, candidate: Candidate, campaign, *, candidates_by_id: dict[str, Candidate] | None = None) -> dict:
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
            try:
                self._apply_chain(workspace, candidate, candidates_by_id, set())
            except CandidateError as exc:
                return {"verified": False, "reason": str(exc), "diff_sha256": candidate.diff_sha256}
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
                 validator_path: pathlib.Path, allowed_keys: tuple[str, ...] | None = None,
                 behavior_keys: tuple[str, ...] | None = None):
        self.baseline_path = baseline_path.resolve()
        self.snapshot_root = snapshot_root.resolve()
        self.validator_path = validator_path.resolve()
        self.allowed_keys = frozenset(allowed_keys or self._allowed_keys)
        if not self.allowed_keys or self.allowed_keys - self._allowed_keys:
            raise CandidateError("configuration allowed_keys contains an unsupported key")
        self.behavior_keys = frozenset(behavior_keys or self.allowed_keys)
        if not self.behavior_keys or self.behavior_keys - self.allowed_keys:
            raise CandidateError("configuration behavior_keys must be a non-empty subset of allowed_keys")
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
            if path.is_symlink():
                raise CandidateError("candidate config snapshot must not be a symlink")
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
        if path.is_symlink():
            raise CandidateError("candidate config snapshot must not be a symlink")
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise CandidateError("candidate config snapshot is missing") from exc
        expected = candidate.provenance.get("materialized_config_sha256")
        if not isinstance(expected, str) or self._digest(data) != expected:
            raise CandidateError("candidate config snapshot does not match immutable provenance")
        return path

    def describe_materialized(self, candidate: Candidate, *, candidates_by_id: dict[str, Candidate] | None = None) -> dict:
        path = self.materialize(candidate)
        value = json.loads(path.read_text(encoding="utf-8"))
        return {
            "candidate_id": candidate.candidate_id,
            "materialized_config_sha256": candidate.provenance.get("materialized_config_sha256"),
            "keys": sorted(value),
            "parent_ids": list(candidate.parent_ids),
        }

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

    def build_candidate(self, parent: Candidate, diagnosis: dict, campaign) -> Candidate:
        diagnosis_patch = diagnosis.get("mutation") if isinstance(diagnosis, dict) else None
        if not isinstance(diagnosis_patch, dict) or set(diagnosis_patch) != {"family", "diff", "changed_units"}:
            raise CandidateError("configuration mutation must contain exactly family, diff, and changed_units")
        if diagnosis_patch["family"] != self.family or self.family not in campaign.permitted_surface_families:
            raise CandidateError("configuration mutation targets an unauthorized family")
        try:
            patch = json.loads(diagnosis_patch["diff"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise CandidateError("configuration diff must be a JSON merge-patch object") from exc
        if not isinstance(patch, dict) or not patch or set(patch) - self.allowed_keys:
            raise CandidateError("configuration merge patch is empty or contains unsupported keys")
        declared = tuple(sorted(diagnosis_patch["changed_units"])) if isinstance(diagnosis_patch["changed_units"], list) else ()
        actual = tuple(sorted(f"config.{key}" for key in patch))
        if declared != actual:
            raise CandidateError("declared changed units do not match configuration merge patch")
        parent_value = json.loads(self.materialize(parent).read_text(encoding="utf-8"))
        merged = self._merge(parent_value, patch)
        if not isinstance(merged, dict):
            raise CandidateError("configuration merge patch did not produce an object")
        changed_behavior = {key for key in self.behavior_keys if parent_value.get(key) != merged.get(key)}
        if not changed_behavior:
            raise CandidateError("configuration merge patch does not change an authorized behavioral key")
        data = self._canonical(merged)
        if len(data) > 32_768:
            raise CandidateError("materialized configuration exceeds 32 KiB")
        digest = self._digest(data)
        candidate = Candidate.create(
            parent_ids=(parent.candidate_id,), mutation_family=self.family,
            hypothesis=diagnosis["root_cause_hypothesis"],
            predicted_mechanism=f"Address the diagnosed cause through {diagnosis['target_surface']}",
            expected_exposure=diagnosis["expected_exposure"],
            diff=json.dumps(patch, sort_keys=True, separators=(",", ":")), changed_units=actual,
            provenance={"parent": parent.candidate_id, "materialized_config_sha256": digest,
                        "falsifier": diagnosis["falsifier"], "rollback_condition": diagnosis["rollback_condition"]},
        )
        self._write_snapshot(candidate, data)
        return candidate

    def compose(self, left: Candidate, right: Candidate, *, candidates_by_id: dict[str, Candidate], campaign) -> Candidate:
        from .candidates import compose_candidates
        compose_candidates(left, right, accepted_ids=set(candidates_by_id), candidates_by_id=candidates_by_id)
        left_value = json.loads(self.materialize(left).read_text(encoding="utf-8"))
        right_value = json.loads(self.materialize(right).read_text(encoding="utf-8"))
        def ancestors(candidate: Candidate) -> set[str]:
            result = {candidate.candidate_id}
            for parent_id in candidate.parent_ids:
                parent = candidates_by_id.get(parent_id)
                if parent is not None:
                    result.update(ancestors(parent))
            return result
        common = ancestors(left) & ancestors(right)
        common_id = next((candidate_id for candidate_id in common if candidate_id in candidates_by_id and candidates_by_id[candidate_id].mutation_family == "seed"), None)
        if common_id is None:
            common_id = next((candidate_id for candidate_id in common if candidate_id in candidates_by_id), None)
        if common_id is None or common_id not in candidates_by_id:
            raise CandidateError("composition parents must share a materialized baseline")
        baseline = json.loads(self.materialize(candidates_by_id[common_id]).read_text(encoding="utf-8"))
        merged = dict(baseline)
        for key in sorted(set(left_value) | set(right_value) | set(baseline)):
            l_changed = left_value.get(key) != baseline.get(key)
            r_changed = right_value.get(key) != baseline.get(key)
            if l_changed and r_changed and left_value.get(key) != right_value.get(key):
                raise CandidateError(f"composition changed-unit conflict: config.{key}")
            if l_changed:
                if key in left_value: merged[key] = left_value[key]
                else: merged.pop(key, None)
            if r_changed:
                if key in right_value: merged[key] = right_value[key]
                else: merged.pop(key, None)
        changed = tuple(sorted(f"config.{key}" for key in merged if merged.get(key) != baseline.get(key)))
        changed += tuple(sorted(f"config.{key}" for key in baseline if key not in merged))
        if not changed:
            raise CandidateError("composition produces no changed configuration units")
        patch = {key: merged[key] for key in sorted(merged) if merged.get(key) != baseline.get(key)}
        data = self._canonical(merged)
        candidate = Candidate.create(
            parent_ids=(left.candidate_id, right.candidate_id), mutation_family="composition",
            hypothesis=f"Compose accepted hypotheses: {left.hypothesis}; {right.hypothesis}",
            predicted_mechanism=f"{left.predicted_mechanism}; {right.predicted_mechanism}",
            expected_exposure=f"{left.expected_exposure}; {right.expected_exposure}",
            diff=json.dumps(patch, sort_keys=True, separators=(",", ":")), changed_units=changed,
            provenance={"composition": [left.candidate_id, right.candidate_id], "materialized_config_sha256": self._digest(data)},
        )
        self._write_snapshot(candidate, data)
        return candidate

    def verify(self, candidate: Candidate, campaign, *, candidates_by_id: dict[str, Candidate] | None = None) -> dict:
        if candidate.mutation_family not in ("seed", self.family, "composition"):
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
