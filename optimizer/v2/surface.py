from __future__ import annotations

import hashlib
import os
import pathlib
import re
import shutil
import subprocess
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
