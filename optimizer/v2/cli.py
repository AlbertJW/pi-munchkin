from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import tempfile

from .benchmark import BenchmarkPack
from .engine import CampaignEngine
from .events import EventStore
from .fake import FakeProvider, FakeScenario, FakeSurface
from .manifest import Campaign, ManifestError, load_campaign
from .provider import ArtifactProvider, OpenAICompatibleProvider
from .surface import PatchSurfaceAdapter


def _default_run_root() -> pathlib.Path:
    override = os.environ.get("PI_OPTIMIZER_V2_RUN_ROOT")
    return pathlib.Path(override).expanduser() if override else pathlib.Path("~/.pi/optimizer-v2/runs").expanduser()


def _run_dir(root: pathlib.Path, campaign: Campaign) -> pathlib.Path:
    return root.resolve() / f"{campaign.campaign_id}-{campaign.sha256[:12]}"


def _assert_run_root_outside_git(root: pathlib.Path) -> pathlib.Path:
    resolved = root.expanduser().resolve()
    repository = pathlib.Path(__file__).resolve().parents[2]
    if resolved == repository or repository in resolved.parents:
        raise ValueError("optimizer run root must be outside Git ancestry")
    return resolved


def _load_pack(manifest_path: pathlib.Path, campaign: Campaign) -> BenchmarkPack:
    pack_path = pathlib.Path(campaign.benchmark["manifest"])
    if not pack_path.is_absolute():
        pack_path = manifest_path.resolve().parent / pack_path
    pack = BenchmarkPack.load(pack_path)
    if pack.pack_id != campaign.benchmark["pack_id"] or pack.revision != campaign.benchmark["revision"] or pack.metric != campaign.primary_metric["name"]:
        raise ValueError("benchmark pack identity or metric does not match the campaign")
    return pack


def _components(campaign: Campaign, pack: BenchmarkPack, manifest_path: pathlib.Path, run_dir: pathlib.Path):
    if campaign.benchmark["plugin"] != "fake":
        raise ValueError("unknown live scenario plugin; Pi gate artifacts are inspection-only until a campaign explicitly wires their materialization")
    scenario = FakeScenario(pack)
    provider_plugin = campaign.optimizer_provider["plugin"]
    if provider_plugin == "fake":
        provider = FakeProvider()
    elif provider_plugin == "artifact-json":
        root = campaign.optimizer_provider["config"].get("artifact_root")
        if not isinstance(root, str) or not root:
            raise ValueError("artifact-json provider requires artifact_root")
        path = pathlib.Path(root); path = path if path.is_absolute() else manifest_path.parent / path
        provider = ArtifactProvider(path)
    elif provider_plugin == "openai-compatible":
        provider = OpenAICompatibleProvider(campaign.optimizer_provider["config"])
    else:
        raise ValueError(f"unknown optimizer provider plugin: {provider_plugin}")
    surface_plugin = campaign.surface_adapter["plugin"]
    if surface_plugin == "fake":
        surface = FakeSurface()
    elif surface_plugin == "pi-harness-patch":
        config = campaign.surface_adapter["config"]
        if set(config) != {"source_root", "family_allowlists", "verification_commands"}:
            raise ValueError("pi-harness-patch config must contain source_root, family_allowlists, and verification_commands")
        source = pathlib.Path(config["source_root"]); source = source if source.is_absolute() else manifest_path.parent / source
        allowlists = {key: tuple(value) for key, value in config["family_allowlists"].items()}
        commands = {key: tuple(tuple(command) for command in value) for key, value in config["verification_commands"].items()}
        surface = PatchSurfaceAdapter(source, run_dir / "workspaces", allowlists, commands)
    else:
        raise ValueError(f"unknown surface adapter plugin: {surface_plugin}")
    return scenario, surface, provider


def _validate_plugin_names(campaign: Campaign) -> None:
    known = {
        "optimizer provider": ({"fake", "artifact-json", "openai-compatible"}, campaign.optimizer_provider["plugin"]),
        "scenario": ({"fake", "pi-gate"}, campaign.benchmark["plugin"]),
        "surface adapter": ({"fake", "pi-harness-patch"}, campaign.surface_adapter["plugin"]),
    }
    for boundary, (allowed, selected) in known.items():
        if selected not in allowed:
            raise ValueError(f"unknown {boundary} plugin: {selected}")


def _offline_selftest() -> dict:
    example_root = pathlib.Path(__file__).resolve().parent / "examples"
    campaign = load_campaign(example_root / "campaign.json")
    pack = BenchmarkPack.load(example_root / "benchmark.json")
    with tempfile.TemporaryDirectory() as td:
        result = CampaignEngine(campaign, EventStore(pathlib.Path(td)), FakeScenario(pack), FakeSurface(), FakeProvider()).run(approve_sha=campaign.sha256)
        if result.get("status") != "complete" or result.get("deployment_performed") is not False:
            raise ValueError("deterministic lifecycle selftest failed")
    return {"schema": "pi.optimizer-selftest/v1", "ok": True, "checks": ["strict-manifest", "durable-lifecycle", "review-only", "no-inference"]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m optimizer.v2.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "dry"):
        item = commands.add_parser(name); item.add_argument("--manifest", required=True)
    for name in ("run", "resume"):
        item = commands.add_parser(name); item.add_argument("--manifest", required=True); item.add_argument("--approve-sha", required=True); item.add_argument("--run-root")
    status = commands.add_parser("status"); status.add_argument("--manifest", required=True); status.add_argument("--run-root")
    inspect = commands.add_parser("inspect"); inspect.add_argument("--manifest", required=True); inspect.add_argument("--run-root")
    replay = commands.add_parser("replay"); replay.add_argument("--manifest", required=True); replay.add_argument("--run-root")
    commands.add_parser("selftest")
    args = parser.parse_args(argv)
    try:
        if args.command == "selftest":
            print(json.dumps(_offline_selftest(), sort_keys=True)); return 0
        manifest_path = pathlib.Path(args.manifest)
        campaign = load_campaign(manifest_path)
        pack = _load_pack(manifest_path, campaign)
        _validate_plugin_names(campaign)
        prepared = {"schema": campaign.schema, "campaign_id": campaign.campaign_id, "campaign_sha256": campaign.sha256, "benchmark_sha256": pack.sha256, "execution": False}
        if args.command in ("prepare", "dry"):
            if args.command == "dry":
                prepared["resolved_plugins"] = {"provider": campaign.optimizer_provider["plugin"], "scenario": campaign.benchmark["plugin"]}
            print(json.dumps(prepared, sort_keys=True)); return 0
        root = _assert_run_root_outside_git(pathlib.Path(args.run_root) if args.run_root else _default_run_root())
        if args.command in ("run", "resume") and args.approve_sha != campaign.sha256:
            raise ValueError("approval SHA does not match the resolved campaign")
        run_dir = _run_dir(root, campaign)
        if args.command == "run" and run_dir.exists():
            raise ValueError("campaign run already exists; use resume with the same approval SHA")
        store = EventStore(run_dir, create=args.command == "run")
        if args.command in ("status", "inspect", "replay"):
            if args.command == "replay":
                store.write_projections(store.project())
            print(json.dumps(store.project(), sort_keys=True)); return 0
        scenario, surface, provider = _components(campaign, pack, manifest_path.resolve(), store.run_root)
        result = CampaignEngine(campaign, store, scenario, surface, provider).run(approve_sha=args.approve_sha)
        print(json.dumps(result, sort_keys=True)); return 0
    except (ManifestError, ValueError, OSError) as exc:
        print(f"optimizer-v2: {exc}", file=sys.stderr); return 2


if __name__ == "__main__":
    raise SystemExit(main())
