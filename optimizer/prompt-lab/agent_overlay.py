#!/usr/bin/env python3
"""Create a run-private Pi agent directory with an exact-usage model overlay."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def create(source: Path, dest: Path, provider: str) -> dict:
    source = source.expanduser().resolve()
    dest = dest.expanduser().resolve()
    if not (source / "models.json").is_file():
        raise ValueError(f"source agent directory has no models.json: {source}")
    dest.mkdir(parents=True, exist_ok=False)
    models = json.loads((source / "models.json").read_text(encoding="utf-8"))
    provider_cfg = models.get("providers", {}).get(provider)
    if not isinstance(provider_cfg, dict):
        raise ValueError(f"provider not found in models.json: {provider}")
    compat = provider_cfg.setdefault("compat", {})
    compat["supportsUsageInStreaming"] = True
    (dest / "models.json").write_text(json.dumps(models, indent=2) + "\n", encoding="utf-8")
    model_hash = sha256(dest / "models.json")

    for name in ("settings.json", "models-store.json"):
        path = source / name
        if path.is_file():
            shutil.copy2(path, dest / name)
    for name in ("sessions", "telemetry"):
        (dest / name).mkdir()
    for entry in source.iterdir():
        target = dest / entry.name
        if target.exists() or entry.name in {"models.json", "settings.json", "models-store.json", "sessions", "telemetry"}:
            continue
        target.symlink_to(entry, target_is_directory=entry.is_dir())
    return {"agent_dir": str(dest), "models_sha256": model_hash, "provider": provider}


def selftest() -> None:
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        source = Path(td) / "source"; source.mkdir()
        (source / "models.json").write_text(json.dumps({"providers": {"p": {"compat": {"supportsUsageInStreaming": False}}}}))
        (source / "settings.json").write_text("{}")
        (source / "extensions").mkdir(); (source / "extensions" / "x.ts").write_text("export {};\n")
        result = create(source, Path(td) / "overlay", "p")
        assert result["models_sha256"]
        assert json.loads((Path(result["agent_dir"]) / "models.json").read_text())["providers"]["p"]["compat"]["supportsUsageInStreaming"] is True
        assert (Path(result["agent_dir"]) / "extensions").is_symlink()
        assert (Path(result["agent_dir"]) / "sessions").is_dir()
    print("agent_overlay selftest: OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path)
    parser.add_argument("--dest", type=Path)
    parser.add_argument("--provider")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
    elif not args.source or not args.dest or not args.provider:
        parser.error("--source, --dest, and --provider are required")
    else:
        print(json.dumps(create(args.source, args.dest, args.provider), sort_keys=True))
