#!/usr/bin/env python3
"""Resumable, single-slot calibration and screening for one remote model."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request


LAB = Path(__file__).resolve().parent
OPT = LAB.parent
RESULTS = LAB / "results"
REAL_GATE = OPT / "real_gate.sh"
OVERLAY = Path(os.environ.get("REAL_GATE_RUNS", str(Path.home() / ".pi" / "real-gate-runs"))) / "batch-overlays"
DEFAULT_MANIFEST = LAB / "configs" / "qwopus35-4b-mtp-legacy-signal.json"
ENDPOINT_ENV = "LLAMA_URL"


class BatchError(RuntimeError):
    pass


def load_manifest(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "pi.screen-batch/v1":
        raise BatchError("manifest must use pi.screen-batch/v1")
    if data.get("provider") != "remote-llamacpp" or data.get("model") != "qwopus35-4b-mtp":
        raise BatchError("manifest is not locked to remote Qwopus 4B")
    if data.get("calibration_reps") != 6 or data.get("pilot_reps") != 2 or data.get("screen_reps") != 6:
        raise BatchError("manifest reps must be 6/2/6")
    if data.get("eligible_passes") != [2, 3, 4]:
        raise BatchError("manifest must use the strict 30-70% calibration band")
    if set(data.get("candidates", {})) != {"c2", "c7", "c21", "c24"}:
        raise BatchError("manifest candidate roster is not c2/c7/c21/c24")
    for candidate, spec in data["candidates"].items():
        config = LAB / "configs" / spec["config"]
        if not config.is_file():
            raise BatchError(f"missing candidate config for {candidate}: {spec['config']}")
    if "endpoint" in data:
        raise BatchError("manifest must not hardcode an endpoint; set the "
                         f"{ENDPOINT_ENV} environment variable instead")
    return data


def endpoint_for(manifest: dict) -> str:
    """Private box addresses stay out of this public repo — resolve them at run time."""
    name = manifest.get("endpoint_env") or ENDPOINT_ENV
    url = os.environ.get(name, "").strip()
    if not url:
        raise BatchError(f"{name} is not set; export the serving endpoint for "
                         f"{manifest['model']} before running a batch")
    return url


def manifest_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def get_json(url: str) -> dict:
    request = urllib.request.Request(url)
    key = os.environ.get("LLAMA_API_KEY")
    if key:
        request.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            value = json.loads(response.read())
    except (OSError, ValueError, urllib.error.URLError) as exc:
        raise BatchError(f"endpoint preflight failed: {type(exc).__name__}") from exc
    if not isinstance(value, dict):
        raise BatchError("endpoint returned a non-object response")
    return value


def get_health(url: str) -> None:
    request = urllib.request.Request(url)
    key = os.environ.get("LLAMA_API_KEY")
    if key:
        request.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status < 200 or response.status >= 300:
                raise BatchError(f"endpoint health returned HTTP {response.status}")
    except BatchError:
        raise
    except (OSError, urllib.error.URLError) as exc:
        raise BatchError(f"endpoint preflight failed: {type(exc).__name__}") from exc


def preflight(manifest: dict) -> dict:
    endpoint = endpoint_for(manifest).rstrip("/")
    get_health(endpoint + "/health")
    models = get_json(endpoint + "/v1/models")
    entries = models.get("data") or []
    selected = next((item for item in entries if item.get("id") == manifest["model"]), None)
    if selected is None:
        raise BatchError(f"selected model {manifest['model']} is absent from endpoint catalog")
    status = (selected.get("status") or {}).get("value")
    if status and status not in {"loaded", "running", "available", "unloaded"}:
        raise BatchError(f"selected model {manifest['model']} is not stably serving: {status}")
    return {"model": manifest["model"], "endpoint_entries": len(entries), "selected_status": status}


def overlay_dir(manifest: dict) -> Path:
    name = manifest["name"]
    return OVERLAY / name


def ensure_overlay(manifest: dict) -> tuple[Path, str]:
    from agent_overlay import create
    source = Path(os.environ.get("PI_LIVE_AGENT_DIR", str(Path.home() / ".pi" / "agent")))
    destination = overlay_dir(manifest)
    if destination.exists():
        models = destination / "models.json"
        if not models.is_file():
            raise BatchError(f"existing overlay is incomplete: {destination}")
        overlay = json.loads(models.read_text(encoding="utf-8"))
        provider_cfg = (overlay.get("providers") or {}).get(manifest["provider"])
        if not isinstance(provider_cfg, dict) or manifest["model"] not in {m.get("id") for m in provider_cfg.get("models", [])}:
            raise BatchError(f"selected model {manifest['model']} is absent from existing run-private registry")
        return destination, hashlib.sha256(models.read_bytes()).hexdigest()
    result = create(source, destination, manifest["provider"])
    overlay = json.loads((destination / "models.json").read_text(encoding="utf-8"))
    provider_cfg = (overlay.get("providers") or {}).get(manifest["provider"])
    if not isinstance(provider_cfg, dict) or manifest["model"] not in {m.get("id") for m in provider_cfg.get("models", [])}:
        raise BatchError(f"selected model {manifest['model']} is absent from run-private registry")
    return destination, result["models_sha256"]


def result_file(gen: str) -> Path:
    if not gen.replace("-", "").replace("_", "").replace(".", "").isalnum():
        raise BatchError(f"unsafe generation name: {gen}")
    return RESULTS / f"{gen}.jsonl"


def rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def complete(path: Path, arm: str, task: str, reps: int) -> bool:
    selected = [row for row in rows(path) if row.get("task") == task and row.get("pattern") == arm]
    return len(selected) == reps and sorted(row.get("rep") for row in selected) == list(range(1, reps + 1))


def run_gate(manifest_path: Path, manifest: dict, gen: str, *, task: str, arm: str, reps: int,
             candidate: str | None = None, exact: bool = False, stage: str) -> None:
    output = result_file(gen)
    # Every arm this cell owes must be complete before the cell is skipped. Testing
    # "cand" first and OR-ing let a cand-complete/base-partial cell resume as done.
    required_arms = ("base", "cand") if arm == "both" else (arm,)
    if all(complete(output, one, task, reps) for one in required_arms):
        print(f"resume: {gen}/{task} already complete")
        return
    overlay, model_hash = ensure_overlay(manifest)
    cfg = LAB / "configs" / manifest["baseline"]
    cand_cfg = LAB / "configs" / manifest["candidates"][candidate]["config"] if candidate else cfg
    env = os.environ.copy()
    env.update({
        "GEN": gen,
        "BASE": str(cfg),
        "CAND": str(cand_cfg),
        "N": str(reps),
        "ARM": arm,
        "PI_PROVIDER": manifest["provider"],
        "PI_MODEL": manifest["model"],
        ENDPOINT_ENV: endpoint_for(manifest),
        "GATE_NETWORK": "endpoint",
        "MODEL_CONTROL": "llama",
        "EXPLORATORY": "1",
        # Each generation is exactly one task/arm cell. A partial file is
        # restarted from rep 1 and atomically replaces that cell, preventing
        # duplicate repetitions while preserving completed sibling cells.
        "RESULTS_MODE": "truncate",
        "PI_CODING_AGENT_DIR": str(overlay),
        "AGENT_MODELS_SHA256": model_hash,
        "EXPERIMENT_MANIFEST": str(manifest_path),
        "EXPERIMENT_MANIFEST_SHA256": manifest_hash(manifest_path),
        "EXPERIMENT_BASE_CELL": f"{stage}/base",
        "EXPERIMENT_CAND_CELL": f"{stage}/{candidate or 'base'}",
    })
    if exact:
        env["REQUIRE_EXACT_USAGE"] = "1"
    args = [str(REAL_GATE), "--exploratory", "--arm", arm, task]
    if arm == "base":
        args.append("--calibrate")
    subprocess.run(args, cwd=OPT, env=env, check=True)


def calibration(manifest_path: Path, manifest: dict) -> dict[str, float]:
    rates: dict[str, float] = {}
    for task in manifest["calibration_tasks"]:
        if task == "path-near-miss" and not (OPT / "real-gate-fixtures" / "manifests" / "path-near-miss.json").is_file():
            print("calibration: path-near-miss not built yet; skipping")
            continue
        gen = f"{manifest['name']}-cal-{task}"
        run_gate(manifest_path, manifest, gen, task=task, arm="base", reps=manifest["calibration_reps"], stage="calibration")
        selected = [row for row in rows(result_file(gen)) if row.get("pattern") == "base" and row.get("task") == task]
        if len(selected) != manifest["calibration_reps"]:
            raise BatchError(f"incomplete calibration rows for {task}")
        rates[task] = sum(int(row.get("score", 0)) for row in selected) / len(selected)
        print(f"calibration: {task} {sum(int(row.get('score', 0)) for row in selected)}/{len(selected)}")
    return rates


def recorded_calibration(manifest: dict) -> dict[str, float]:
    """Read only completed calibration cells; never launch work for reporting."""
    rates: dict[str, float] = {}
    for task in manifest["calibration_tasks"]:
        path = result_file(f"{manifest['name']}-cal-{task}")
        selected = [row for row in rows(path) if row.get("pattern") == "base" and row.get("task") == task]
        if len(selected) == manifest["calibration_reps"]:
            rates[task] = sum(int(row.get("score", 0)) for row in selected) / len(selected)
    return rates


def eligible_tasks(manifest: dict, rates: dict[str, float], candidate: str) -> list[str]:
    allowed = set(manifest["eligible_passes"])
    def admitted_for_screen(task: str) -> bool:
        # path-near-miss is deliberately calibration-only until a human approves it.
        if task != "path-near-miss":
            return True
        path = OPT / "real-gate-fixtures" / "manifests" / f"{task}.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return False
        return bool((data.get("admission") or {}).get("approved"))
    return [task for task in manifest["candidates"][candidate]["priority"]
            if task in rates and round(rates[task] * manifest["calibration_reps"]) in allowed
            and admitted_for_screen(task)][:manifest["max_tasks_per_candidate"]]


def pilot(manifest_path: Path, manifest: dict, rates: dict[str, float]) -> dict[str, list[str]]:
    selected: dict[str, list[str]] = {}
    for candidate, spec in manifest["candidates"].items():
        tasks = eligible_tasks(manifest, rates, candidate)
        selected[candidate] = tasks
        if not spec["pilot"]:
            continue
        for task in tasks:
            gen = f"{manifest['name']}-{candidate}-pilot-{task}"
            run_gate(manifest_path, manifest, gen, task=task, arm="cand", reps=manifest["pilot_reps"], candidate=candidate, exact=True, stage="pilot")
            target = sum(row.get("exposure", {}).get("status") == "targeted" for row in rows(result_file(gen)))
            if target < 1:
                print(f"pilot: {candidate}/{task} UNEXPOSED")
    return selected


def screen(manifest_path: Path, manifest: dict, selected: dict[str, list[str]]) -> None:
    for candidate, tasks in selected.items():
        for task in tasks:
            gen = f"{manifest['name']}-{candidate}-screen-{task}"
            run_gate(manifest_path, manifest, gen, task=task, arm="both", reps=manifest["screen_reps"], candidate=candidate, exact=True, stage="screen")


def screen_disposition(candidate: str, base: list[dict], cand: list[dict]) -> str:
    """Classify one fresh paired task; labels are screening dispositions only."""
    if len(base) != 6 or len(cand) != 6:
        return "INCOMPLETE_COST"
    if not all(row.get("usage", {}).get("exact") is True for row in base + cand):
        return "INCOMPLETE_COST"
    targeted = sum(row.get("exposure", {}).get("status") == "targeted" for row in cand)
    if targeted < 3 and candidate != "c2":
        return "UNEXPOSED"
    delta = sum(row.get("score", 0) for row in cand) - sum(row.get("score", 0) for row in base)
    unverified = sum(row.get("exposure", {}).get("counts", {}).get("verify-gate/unverified-end", 0) for row in cand)
    if delta <= -2 or (candidate == "c7" and unverified >= 2):
        return "SAFETY_HOLD"
    if delta >= 2:
        return "PROMOTE_TO_LOCAL_CONFIRMATION"
    return "PARK_EXPOSED_NO_SIGNAL"


def report(manifest: dict, selected: dict[str, list[str]]) -> None:
    print("# exploratory Qwopus 4B screen")
    for candidate, tasks in selected.items():
        for task in tasks:
            path = result_file(f"{manifest['name']}-{candidate}-screen-{task}")
            data = rows(path)
            base = [row for row in data if row.get("pattern") == "base"]
            cand = [row for row in data if row.get("pattern") == "cand"]
            disposition = screen_disposition(candidate, base, cand)
            if disposition == "INCOMPLETE_COST":
                print(f"{candidate}/{task}: INCOMPLETE_COST")
                continue
            targeted = sum(row.get("exposure", {}).get("status") == "targeted" for row in cand)
            delta = sum(row["score"] for row in cand) - sum(row["score"] for row in base)
            print(f"{candidate}/{task}: {disposition} delta={delta:+d}/6 targeted={targeted}/6")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["preflight", "calibrate", "screen", "report"])
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    manifest = load_manifest(manifest_path)
    if args.command == "preflight":
        from usage_probe import probe
        details = preflight(manifest)
        usage = probe(endpoint_for(manifest), manifest["model"])
        overlay_path, overlay_hash = ensure_overlay(manifest)
        details = {**details, "overlay": {"agent_dir": str(overlay_path), "models_sha256": overlay_hash}}
        if usage.get("supported"):
            catalog_after = get_json(endpoint_for(manifest).rstrip("/") + "/v1/models")
            selected_after = next((item for item in catalog_after.get("data") or []
                                   if item.get("id") == manifest["model"]), {})
            status_after = (selected_after.get("status") or {}).get("value")
            if status_after and status_after not in {"loaded", "running", "available"}:
                usage = {**usage, "supported": False, "reason": f"model_not_stably_serving:{status_after}"}
        print(json.dumps({**details, "usage": usage}, sort_keys=True))
        raise SystemExit(0 if usage.get("supported") else 2)
    if args.command == "report":
        rates = recorded_calibration(manifest)
        selected = {candidate: eligible_tasks(manifest, rates, candidate)
                    for candidate in manifest["candidates"]}
        report(manifest, selected)
        return
    rates = calibration(manifest_path, manifest)
    if args.command == "calibrate":
        print(json.dumps(rates, sort_keys=True))
        return
    selected = pilot(manifest_path, manifest, rates)
    if args.command == "screen":
        screen(manifest_path, manifest, selected)
    report(manifest, selected)


if __name__ == "__main__":
    main()
