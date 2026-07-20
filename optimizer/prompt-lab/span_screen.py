#!/usr/bin/env python3
"""Run one receipt-checked span-tools off/on screen on approved bigdata."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any, Callable


LAB = Path(__file__).resolve().parent
OPTIMIZER = LAB.parent
RESULTS = LAB / "results"
DEFAULT_MANIFEST = LAB / "configs" / "span-screen.json"
REAL_GATE = OPTIMIZER / "real_gate.sh"
FLEET_REPORT = LAB / "fleet_report.py"
PARENT_ENV_ALLOWLIST = {
    "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR",
    "PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME", "PI_MODEL", "PI_PROVIDER", "DD",
    "PI_TIMEOUT", "HEALTH_WAIT", "REAL_GATE_RUNS", "PI_MEM_CAP_GB",
}
EXPECTED_EXECUTION = {
    "GATE_NETWORK": "endpoint", "MODEL_CONTROL": "llama",
    "LLAMA_URL": "http://127.0.0.1:8080", "INTERLEAVE": "on", "SANDBOX": "on",
    "SPAN_TOOLS": "off", "TRAJECTORY": "off", "HELDOUT": "",
    "RESULTS_MODE": "truncate", "FLEET_ALPHA": "0.05",
}
TRAJECTORY_METRICS = ["turns", "tool_calls", "tool_errors", "reads", "unique_reads",
                      "repeat_calls", "repeat_reads", "tool_result_chars",
                      "first_mutation_turn", "compactions", "search_spans", "read_span"]
EXPECTED_METRICS = ["pass_rate", "all_k_reliability", *TRAJECTORY_METRICS,
                    "span_receipt_success", "in_tok", "out_tok", "token_usage_exact"]


class ScreenError(ValueError):
    pass


class ScreenIneligible(ScreenError):
    pass


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ScreenError(f"invalid JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ScreenError(f"{path} must contain an object")
    return value


def _contained(root: Path, relative: Any) -> Path:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ScreenError("config paths must be non-empty and relative")
    root = root.resolve()
    try:
        path = (root / relative).resolve(strict=True)
        path.relative_to(root)
    except (OSError, ValueError) as exc:
        raise ScreenError(f"config path escapes or does not exist: {relative}") from exc
    if not path.is_file() or path.suffix != ".json":
        raise ScreenError(f"config is not a JSON file: {relative}")
    return path


def _config_module():
    spec = importlib.util.spec_from_file_location("prompt_lab_config", LAB / "config.py")
    if spec is None or spec.loader is None:
        raise ScreenError("cannot load config validator")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    path = path.resolve(strict=True)
    raw = path.read_bytes()
    manifest = _json(path)
    fields = {"schema", "name", "hypothesis", "defaults", "metrics", "rollback", "provenance", "cells"}
    if manifest.get("schema") != "pi.span-screen/v1" or set(manifest) != fields:
        raise ScreenError("manifest must use the exact pi.span-screen/v1 contract")
    defaults = manifest.get("defaults") or {}
    if set(defaults) != {"task", "reps", "gen_prefix", "execution"}:
        raise ScreenError("manifest defaults use unsupported fields")
    if defaults.get("task") != "bigdata" or defaults.get("reps") != 6:
        raise ScreenError("span screen is fixed to approved bigdata at n=6")
    if defaults.get("execution") != EXPECTED_EXECUTION:
        raise ScreenError("span screen requires interleaved loopback execution at alpha=0.05")
    if manifest.get("metrics") != EXPECTED_METRICS:
        raise ScreenError("manifest metrics must exactly match the aggregate SPAN report")
    provenance = manifest.get("provenance") or {}
    if set(provenance) != {"harness_surface_sha256", "harness_hash_blocker"}:
        raise ScreenError("manifest provenance fields are invalid")
    if provenance["harness_surface_sha256"] is not None or not provenance["harness_hash_blocker"]:
        raise ScreenError("loaded-harness hash must remain an explicit blocker")

    cells = manifest.get("cells")
    if not isinstance(cells, list) or len(cells) != 2:
        raise ScreenError("screen requires exactly base/off and cand/on cells")
    validator = _config_module(); normalized = []
    expected = [("span-off", "base", {}), ("span-on", "cand", {"SPAN_TOOLS": "on"})]
    for cell, (cell_id, arm, expected_env) in zip(cells, expected):
        if set(cell) != {"id", "arm", "config"} or (cell["id"], cell["arm"]) != (cell_id, arm):
            raise ScreenError("screen cells must be ordered span-off/base then span-on/cand")
        cfg_path = _contained(path.parent, cell["config"])
        cfg_bytes = cfg_path.read_bytes(); cfg = _json(cfg_path)
        unknown = set(cfg) - {"name", "prediction", "prompt_variant", "format", "scaffold", "thresholds"}
        if unknown or (cfg.get("prompt_variant"), cfg.get("format"), cfg.get("scaffold")) != ("A", "md", "none"):
            raise ScreenError(f"unsafe config shape for {cell_id}")
        try:
            declared = validator.config_env(cfg)
        except (TypeError, ValueError) as exc:
            raise ScreenError(f"invalid config for {cell_id}: {exc}") from exc
        if declared != expected_env:
            raise ScreenError(f"{cell_id} declared env must be exactly {expected_env}")
        normalized.append({**cell, "config_path": cfg_path,
                           "config_sha256": hashlib.sha256(cfg_bytes).hexdigest(), "declared_env": declared})
    return {**manifest, "manifest_path": path, "manifest_sha256": hashlib.sha256(raw).hexdigest(), "cells": normalized}


def result_paths(gen: str) -> tuple[Path, Path, Path]:
    if not gen or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for ch in gen):
        raise ScreenError("GEN may contain only letters, digits, dot, underscore, and hyphen")
    root = RESULTS.resolve()
    paths = (root / f"{gen}.jsonl", root / f"{gen}-FLEET.md", root / f"{gen}-SPAN.md")
    for path in paths:
        try: path.resolve().relative_to(root)
        except ValueError as exc: raise ScreenError("result/report path escapes results directory") from exc
    return paths


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        try: os.unlink(temporary)
        except OSError: pass
        raise


def _load_result_rows(result_path: Path) -> list[dict[str, Any]]:
    root = RESULTS.resolve()
    try:
        resolved = result_path.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        raise ScreenError("result file is missing or escapes results directory") from exc
    if not resolved.is_file():
        raise ScreenError("result path is not a regular file")
    rows = []
    for line_number, line in enumerate(resolved.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip(): continue
        try: row = json.loads(line)
        except json.JSONDecodeError as exc: raise ScreenError(f"invalid result JSON on line {line_number}") from exc
        if not isinstance(row, dict): raise ScreenError(f"result line {line_number} is not an object")
        rows.append(row)
    return rows


def mechanism_report(rows: list[dict[str, Any]], manifest: dict[str, Any]) -> tuple[str, bool]:
    reasons = []
    by_arm = {arm: [] for arm in ("base", "cand")}
    contracts = set()
    for index, row in enumerate(rows):
        arm = row.get("pattern")
        if arm not in by_arm:
            reasons.append(f"row {index}: unsupported arm")
            continue
        by_arm[arm].append(row)
        if row.get("arm") != arm: reasons.append(f"{arm}: row arm does not match pattern")
        if row.get("schema") != "pi.eval-row/v2": reasons.append(f"{arm}: non-v2 row")
        if row.get("task") != "bigdata" or row.get("split") != "val" or (row.get("prompt") or {}).get("variant") != "canonical":
            reasons.append(f"{arm}: row is not canonical bigdata val evidence")
        if row.get("authoritative") is not True or row.get("status") != "complete":
            reasons.append(f"{arm}: row is non-authoritative or incomplete")
        context = row.get("context") or {}
        if (context.get("schema") != "pi.context-telemetry/v1" or
                context.get("authenticated") is not True or
                not isinstance(context.get("session_key"), str) or
                not isinstance(context.get("events"), int) or context.get("events", 0) < 1 or
                not isinstance(context.get("config"), dict)):
            reasons.append(f"{arm}: missing authenticated context telemetry")
        if type(row.get("score")) is not int or row.get("score") not in (0, 1):
            reasons.append(f"{arm}: score is not binary")
        execution = row.get("execution") or {}; serving = row.get("serving") or {}
        pre, post = serving.get("pre") or {}, serving.get("post") or {}
        if not execution.get("provider") or not execution.get("endpoint_identity_sha256"):
            reasons.append(f"{arm}: unresolved provider/endpoint identity")
        if serving.get("stable") is not True or pre.get("status") != "complete" or post.get("status") != "complete":
            reasons.append(f"{arm}: serving identity is incomplete or unstable")
        contracts.add((row.get("model"), execution.get("provider"), execution.get("endpoint_identity_sha256"),
                       row.get("run"), pre.get("fingerprint_sha256"), post.get("fingerprint_sha256"),
                       json.dumps(row.get("fixture") or {}, sort_keys=True)))
        trajectory = row.get("trajectory") or {}
        for metric in TRAJECTORY_METRICS:
            if type(trajectory.get(metric)) is not int or trajectory[metric] < 0:
                reasons.append(f"{arm}: malformed trajectory metric {metric}")
    if len(contracts) != 1 or any(not value for value in next(iter(contracts), ())):
        reasons.append("rows do not share one resolved model/provider/serving/run contract")
    expected = manifest["defaults"]["reps"]
    for arm in ("base", "cand"):
        if len(by_arm[arm]) != expected:
            reasons.append(f"{arm} row count {len(by_arm[arm])} != {expected}")
        reps = [r.get("rep") for r in by_arm[arm]]
        repetitions = [r.get("repetition") for r in by_arm[arm]]
        if (any(type(value) is not int for value in reps + repetitions) or reps != repetitions or
                sorted(reps) != list(range(1, expected + 1))):
            reasons.append(f"{arm} reps must be exactly 1..{expected} without duplicates or gaps")
    totals = {}
    cells = {cell["arm"]: cell for cell in manifest["cells"]}
    for arm, arm_rows in by_arm.items():
        totals[arm] = {
            "rows": len(arm_rows),
            "search_spans": sum((r.get("trajectory") or {}).get("search_spans", 0) for r in arm_rows),
            "read_span": sum((r.get("trajectory") or {}).get("read_span", 0) for r in arm_rows),
            "receipts": sum(r.get("span_receipt_success") is True for r in arm_rows),
        }
        expected_cell = cells[arm]
        for row in arm_rows:
            if (row.get("experiment") or {}).get("manifest_sha256") != manifest["manifest_sha256"]:
                reasons.append(f"{arm} manifest provenance drift")
            if (row.get("experiment") or {}).get("cell") != expected_cell["id"]:
                reasons.append(f"{arm} cell provenance drift")
            binding = row.get("config") or {}
            if binding.get("sha256") != expected_cell["config_sha256"] or binding.get("declared_env") != expected_cell["declared_env"]:
                reasons.append(f"{arm} config provenance drift")
            harness = row.get("harness") or {}
            if harness.get("surface_sha256") is not None or not harness.get("hash_blocker"):
                reasons.append(f"{arm} loaded-harness provenance was falsely claimed or omitted")
            if arm == "base" and row.get("span_receipt_success") is not False:
                reasons.append("baseline span_receipt_success must be exactly false")
    if totals["cand"]["search_spans"] + totals["cand"]["read_span"] == 0:
        reasons.append("candidate has zero span-tool exposure")
    if totals["cand"]["receipts"] != len(by_arm["cand"]):
        reasons.append("candidate rows lack exhaustive receipt-backed bigdata scans")
    if totals["base"]["search_spans"] + totals["base"]["read_span"] or totals["base"]["receipts"]:
        reasons.append("baseline unexpectedly exposed span treatment")
    reasons = list(dict.fromkeys(reasons))
    eligible = not reasons
    status = "ELIGIBLE — SAME-RUN SCREEN ONLY" if eligible else "INELIGIBLE"
    lines = [f"# span-tools mechanism report — {status}", "",
             "## Treatment compliance", "",
             "| arm | rows | search_spans | read_span | exhaustive receipts |",
             "|---|---:|---:|---:|---:|",
             f"| base | {totals['base']['rows']} | {totals['base']['search_spans']} | {totals['base']['read_span']} | {totals['base']['receipts']} |",
             f"| cand | {totals['cand']['rows']} | {totals['cand']['search_spans']} | {totals['cand']['read_span']} | {totals['cand']['receipts']} |", "",
             "## Aggregate metrics", "",
             "| metric | base | cand |", "|---|---:|---:|"]
    def aggregate(arm, metric):
        arm_rows = by_arm[arm]
        if metric == "pass_rate":
            return f"{sum(r.get('score') == 1 for r in arm_rows)}/{len(arm_rows)} ({sum(r.get('score') == 1 for r in arm_rows)/len(arm_rows):.0%})" if arm_rows else "unavailable"
        if metric == "all_k_reliability":
            return f"all-{len(arm_rows)}: {'pass' if arm_rows and all(r.get('score') == 1 for r in arm_rows) else 'fail'}" if arm_rows else "unavailable"
        if metric == "span_receipt_success":
            return f"{sum(r.get('span_receipt_success') is True for r in arm_rows)}/{len(arm_rows)}" if arm_rows else "unavailable"
        if metric in TRAJECTORY_METRICS:
            values = [(r.get("trajectory") or {}).get(metric) for r in arm_rows]
            return f"total {sum(values)}; mean {sum(values)/len(values):.2f}" if values and all(type(v) is int for v in values) else "unavailable"
        if metric in ("in_tok", "out_tok"):
            if not arm_rows or not all((r.get("usage") or {}).get("exact") is True for r in arm_rows): return "unavailable (usage not exact)"
            values = [r.get(metric) for r in arm_rows]
            return f"total {sum(values)}; mean {sum(values)/len(values):.2f}" if all(type(v) is int for v in values) else "unavailable"
        if metric == "token_usage_exact":
            return f"{sum((r.get('usage') or {}).get('exact') is True for r in arm_rows)}/{len(arm_rows)}" if arm_rows else "unavailable"
        return "unavailable"
    for metric in manifest["metrics"]:
        lines.append(f"| {metric} | {aggregate('base', metric)} | {aggregate('cand', metric)} |")
    lines += ["", "## REPRODUCIBILITY BLOCKER", "",
              manifest["provenance"]["harness_hash_blocker"],
              "An eligible result is a same-run screen only. Fresh confirmation is required after live/package parity and loaded-surface identity are proven.", ""]
    if reasons: lines += ["## Reasons", ""] + [f"- {reason}" for reason in reasons]
    else: lines += ["Treatment exposure, exhaustive receipts, config binding, and experiment provenance passed."]
    return "\n".join(lines) + "\n", eligible


def execute(manifest: dict[str, Any], gen: str, dry: bool,
            run_command: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run) -> bool:
    if os.environ.get("LLAMA_API_KEY") or os.environ.get("PI_GATE_PASSTHROUGH_ENV"):
        raise ScreenError("authoritative span screen refuses credentialed endpoints and credential passthrough")
    parent = {key: os.environ[key] for key in PARENT_ENV_ALLOWLIST if key in os.environ}
    if not parent.get("HOME") or not parent.get("PATH"):
        raise ScreenError("HOME and PATH are required")
    result_path, fleet_path, mechanism_path = result_paths(gen)
    cells = {cell["arm"]: cell for cell in manifest["cells"]}
    declared = {**manifest["defaults"]["execution"], "GEN": gen, "N": "6",
                "BASE": str(cells["base"]["config_path"]), "CAND": str(cells["cand"]["config_path"]),
                "EXPERIMENT_MANIFEST": str(manifest["manifest_path"]),
                "EXPERIMENT_MANIFEST_SHA256": manifest["manifest_sha256"],
                "EXPERIMENT_BASE_CELL": cells["base"]["id"], "EXPERIMENT_CAND_CELL": cells["cand"]["id"]}
    child = {**parent, **declared}
    gate = [str(REAL_GATE), "bigdata"]
    report = [sys.executable, str(FLEET_REPORT), gen, "--baseline", "base", "--candidate", "cand"]
    print(f"gate: {REAL_GATE} bigdata (GEN={gen}, n=6, span off/on, interleaved)")
    print(f"fleet report: {fleet_path}")
    print(f"mechanism report: {mechanism_path}")
    if dry: return True
    # Remove any adoption-looking stale verdict before the expensive gate starts.
    _atomic_write(fleet_path, "# fleet_report — PENDING MECHANISM VALIDATION\n\nNo adoption verdict is available.\n")
    run_command(gate, cwd=OPTIMIZER, env=child, check=True)
    try:
        rows = _load_result_rows(result_path)
    except ScreenError as exc:
        text = ("# span-tools mechanism report — INELIGIBLE\n\n## Reasons\n\n"
                f"- {exc}\n")
        _atomic_write(mechanism_path, text)
        _atomic_write(fleet_path, "# fleet_report — INELIGIBLE\n\nMechanism evidence failed; no adoption verdict was computed.\n")
        raise ScreenIneligible(f"screen is INELIGIBLE; see {mechanism_path}") from exc
    text, eligible = mechanism_report(rows, manifest)
    _atomic_write(mechanism_path, text)
    print(text, end="")
    if not eligible:
        _atomic_write(fleet_path, "# fleet_report — INELIGIBLE\n\nMechanism evidence failed; no adoption verdict was computed.\n")
        raise ScreenIneligible(f"screen is INELIGIBLE; see {mechanism_path}")
    # The mechanism contract above requires one stable model across every row.
    # Bind fleet_report's daily-driver gate to that measured model instead of its
    # historical qwen36 fallback (which falsely rejected screens on other small
    # models when PI_MODEL was resolved by the endpoint at runtime).
    report_env = {**child, "FLEET_DD": rows[0]["model"]}
    run_command(report, cwd=OPTIMIZER, env=report_env, check=True)
    return True


def selftest() -> None:
    manifest = load_manifest(); result_paths("span-selftest")
    assert manifest["defaults"]["reps"] == 6
    assert manifest["defaults"]["execution"]["FLEET_ALPHA"] == "0.05"
    print("span_screen selftest: OK (single A/B; config binding; paths; environment contract)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--gen", help="unique GEN (default: UTC timestamp plus pid)")
    parser.add_argument("--dry", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    if args.selftest: selftest(); return 0
    try:
        manifest = load_manifest(args.manifest)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        gen = args.gen or f"{manifest['defaults']['gen_prefix']}-{stamp}-{os.getpid()}"
        execute(manifest, gen, args.dry)
    except ScreenIneligible as exc:
        print(f"span_screen: {exc}", file=sys.stderr); return 3
    except (ScreenError, OSError, subprocess.CalledProcessError) as exc:
        print(f"span_screen: {exc}", file=sys.stderr); return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
