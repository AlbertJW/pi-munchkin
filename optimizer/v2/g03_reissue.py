from __future__ import annotations

"""Reissue the G03 benchmark/preregistration pair for a new source surface.

This module deliberately performs no calibration, model execution, or gate
invocation.  It reads an existing, validated pack and preregistration, applies
only the explicitly supplied runtime identities, and publishes a new pair of
manifests atomically.  The original inputs are never edited in place.
"""

import argparse
import copy
import hashlib
import json
import os
import pathlib
import re
import tempfile
from typing import Any

try:
    from .baseline import BaselinePreregistration
    from .benchmark import BenchmarkPack
except ImportError:  # direct ``python optimizer/v2/g03_reissue.py --selftest``
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from optimizer.v2.baseline import BaselinePreregistration
    from optimizer.v2.benchmark import BenchmarkPack


HEX64 = re.compile(r"^[0-9a-f]{64}$")
REVISION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _sha(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise ValueError(f"{name} must be a lowercase SHA-256")
    return value


def _revision(value: Any) -> str:
    if not isinstance(value, str) or not REVISION.fullmatch(value):
        raise ValueError("revision must be 1..64 ASCII letters, digits, '.', '_' or '-'")
    return value


def _repo_root(value: str | pathlib.Path) -> pathlib.Path:
    root = pathlib.Path(value).expanduser().resolve()
    if not root.is_dir():
        raise ValueError("repository_root must be an existing directory")
    return root


def _reject_symlink_components(path: pathlib.Path, root: pathlib.Path, name: str) -> None:
    """Reject a path whose existing component is a symlink.

    Checking before ``resolve`` is important: resolving first would hide a
    symlink escape behind an apparently safe, in-repository destination.
    """

    try:
        relative = path.absolute().relative_to(root.absolute())
    except ValueError as exc:
        raise ValueError(f"{name} must be inside the repository") from exc
    current = root
    for component in relative.parts:
        current = current / component
        if current.is_symlink():
            raise ValueError(f"{name} must not traverse a symlink")


def _input_path(value: str | pathlib.Path, root: pathlib.Path, name: str) -> pathlib.Path:
    path = pathlib.Path(value).expanduser()
    _reject_symlink_components(path, root, name)
    resolved = path.resolve()
    if root not in resolved.parents or not resolved.is_file():
        raise ValueError(f"{name} must be a regular file inside the repository")
    return resolved


def _output_path(value: str | pathlib.Path, root: pathlib.Path, name: str) -> pathlib.Path:
    path = pathlib.Path(value).expanduser()
    _reject_symlink_components(path, root, name)
    resolved = path.resolve()
    if resolved == root or root not in resolved.parents:
        raise ValueError(f"{name} must be inside the repository")
    if resolved.exists() and (resolved.is_symlink() or not resolved.is_file()):
        raise ValueError(f"{name} must be a regular file destination")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    # The mkdir above may have created a path under a symlink that appeared
    # concurrently. Recheck all components before writing.
    _reject_symlink_components(resolved, root, name)
    return resolved


def _read_json(path: pathlib.Path, name: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {name}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{name} must contain a JSON object")
    return value


def _manifest_bytes(value: dict) -> bytes:
    # Keep output deterministic and human-reviewable.  Validators hash parsed
    # canonical values, while the returned pack hash is the actual file hash.
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _atomic_write(path: pathlib.Path, data: bytes) -> None:
    temporary: pathlib.Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.tmp-", dir=path.parent)
        temporary = pathlib.Path(temporary_name)
        try:
            os.fchmod(descriptor, 0o644)
            with os.fdopen(descriptor, "wb") as stream:
                descriptor = -1
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            temporary = None
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _new_preregistration_id(old: str, revision: str) -> str:
    suffix = f"reissue-{revision}"
    candidate = f"{old}-{suffix}"
    return candidate[:256]


def reissue(
    *,
    pack_path: str | pathlib.Path,
    preregistration_path: str | pathlib.Path,
    output_pack: str | pathlib.Path,
    output_preregistration: str | pathlib.Path,
    repository_root: str | pathlib.Path,
    source_sha256: str,
    surface_sha256: str,
    revision: str,
) -> dict:
    """Create a refreshed G03 pack/preregistration pair without inference."""

    root = _repo_root(repository_root)
    source_sha256 = _sha(source_sha256, "source_sha256")
    surface_sha256 = _sha(surface_sha256, "surface_sha256")
    revision = _revision(revision)
    pack_input = _input_path(pack_path, root, "pack_path")
    prereg_input = _input_path(preregistration_path, root, "preregistration_path")
    pack_output = _output_path(output_pack, root, "output_pack")
    prereg_output = _output_path(output_preregistration, root, "output_preregistration")
    if pack_output == prereg_output:
        raise ValueError("output_pack and output_preregistration must be distinct")
    if pack_output in (pack_input, prereg_input) or prereg_output in (pack_input, prereg_input):
        raise ValueError("outputs must not overwrite frozen inputs")

    pack_raw = _read_json(pack_input, "benchmark pack")
    prereg_raw = _read_json(prereg_input, "baseline preregistration")
    # Validate before changing anything so a stale or malformed source cannot
    # be republished under a fresh identity.
    original_pack = BenchmarkPack.from_dict(pack_raw)
    original_prereg = BaselinePreregistration.from_dict(prereg_raw)
    if original_prereg.pack_path != _relative_path(pack_input, root):
        raise ValueError("preregistration does not bind the supplied benchmark pack")
    if original_prereg.pack_sha256 != hashlib.sha256(pack_input.read_bytes()).hexdigest():
        raise ValueError("preregistration benchmark pack hash is stale")
    if original_pack.provenance is None:
        raise ValueError("benchmark pack provenance is required")

    new_pack = copy.deepcopy(pack_raw)
    new_pack["revision"] = revision
    new_pack["provenance"]["source_surface_sha256"] = source_sha256
    pack_bytes = _manifest_bytes(new_pack)
    pack_file_sha256 = hashlib.sha256(pack_bytes).hexdigest()
    # Validate the generated pack before publishing either output.
    validated_pack = BenchmarkPack.from_dict(new_pack)

    new_prereg = copy.deepcopy(prereg_raw)
    new_prereg["preregistration_id"] = _new_preregistration_id(
        str(new_prereg["preregistration_id"]), revision
    )
    new_prereg["benchmark_pack"]["path"] = _relative_path(pack_output, root)
    new_prereg["benchmark_pack"]["sha256"] = pack_file_sha256
    new_prereg["benchmark_pack"]["pack_id"] = validated_pack.pack_id
    new_prereg["benchmark_pack"]["revision"] = validated_pack.revision
    new_prereg["surface_identity"]["source_sha256"] = source_sha256
    new_prereg["surface_identity"]["surface_sha256"] = surface_sha256
    for arm in new_prereg["arms"].values():
        arm["surface_sha256"] = surface_sha256
    validated_prereg = BaselinePreregistration.from_dict(new_prereg)
    prereg_bytes = _manifest_bytes(new_prereg)
    prereg_file_sha256 = hashlib.sha256(prereg_bytes).hexdigest()

    # Publish only after both manifests have parsed and passed strict schema
    # validation. Each file is fsynced and the containing directory is synced.
    _atomic_write(pack_output, pack_bytes)
    _atomic_write(prereg_output, prereg_bytes)
    return {
        "schema": "pi.optimizer-g03-reissue/v1",
        "benchmark_pack_file_sha256": pack_file_sha256,
        "preregistration_file_sha256": prereg_file_sha256,
        "preregistration_sha256": validated_prereg.sha256,
        "benchmark_pack_path": _relative_path(pack_output, root),
        "preregistration_path": _relative_path(prereg_output, root),
        "source_sha256": source_sha256,
        "surface_sha256": surface_sha256,
        "model_execution": False,
    }


def _relative_path(path: pathlib.Path, root: pathlib.Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError as exc:
        raise ValueError("path must be repository-relative") from exc


def selftest() -> None:
    optimizer_root = pathlib.Path(__file__).resolve().parents[1]
    repository = optimizer_root.parent
    source_pack = optimizer_root / "v2/benchmarks/g03-representative-pilot-v1.json"
    source_prereg = optimizer_root / "v2/examples/g03-baseline-preregistration.json"
    with tempfile.TemporaryDirectory(prefix="g03-reissue-selftest-", dir=optimizer_root) as directory:
        target = pathlib.Path(directory)
        result = reissue(
            pack_path=source_pack,
            preregistration_path=source_prereg,
            output_pack=target / "pack.json",
            output_preregistration=target / "prereg.json",
            repository_root=repository,
            source_sha256="a" * 64,
            surface_sha256="b" * 64,
            revision="selftest.r1",
        )
        assert result["model_execution"] is False
        assert BenchmarkPack.load(target / "pack.json").revision == "selftest.r1"
        assert BaselinePreregistration.load(target / "prereg.json").raw["benchmark_pack"]["sha256"] == result["benchmark_pack_file_sha256"]
    print("g03 reissue selftest: PASS")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--selftest", action="store_true")
    mode.add_argument("--reissue", action="store_true")
    parser.add_argument("--pack-path")
    parser.add_argument("--preregistration-path")
    parser.add_argument("--output-pack")
    parser.add_argument("--output-preregistration")
    parser.add_argument("--repository-root", default=pathlib.Path(__file__).resolve().parents[2])
    parser.add_argument("--source-sha256")
    parser.add_argument("--surface-sha256")
    parser.add_argument("--revision")
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
        return 0
    required = {
        "--pack-path": args.pack_path,
        "--preregistration-path": args.preregistration_path,
        "--output-pack": args.output_pack,
        "--output-preregistration": args.output_preregistration,
        "--source-sha256": args.source_sha256,
        "--surface-sha256": args.surface_sha256,
        "--revision": args.revision,
    }
    missing = [name for name, value in required.items() if value is None]
    if missing:
        parser.error("--reissue requires " + ", ".join(missing))
    result = reissue(
        pack_path=args.pack_path,
        preregistration_path=args.preregistration_path,
        output_pack=args.output_pack,
        output_preregistration=args.output_preregistration,
        repository_root=args.repository_root,
        source_sha256=args.source_sha256,
        surface_sha256=args.surface_sha256,
        revision=args.revision,
    )
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
