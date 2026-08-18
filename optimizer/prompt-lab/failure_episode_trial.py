#!/usr/bin/env python3
"""Stage-gated, resumable Ling Tiny semantic-failure trial runner.

The runner schedules cells; real_gate remains the sole owner of execution,
sandboxing, telemetry authentication, grading, and eval-row construction.
No command automatically advances to the next stage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import statistics
import subprocess
import sys
import tempfile
from typing import Any
from urllib.parse import urlsplit

LAB = Path(__file__).resolve().parent
OPTIMIZER = LAB.parent
REPO = OPTIMIZER.parent
REAL_GATE = OPTIMIZER / "real_gate.sh"
CONFIG_ROOT = LAB / "configs"
BASE_CONFIG = CONFIG_ROOT / "baseline.json"
CAND_CONFIG = CONFIG_ROOT / "pending" / "semantic-loop-enforce.json"
STAGES = ("preflight", "calibrate", "power", "primary", "primary-report", "replication", "final-report")
SCHEMA = "pi.failure-episode-study/v1"
HASH = re.compile(r"^[0-9a-f]{64}$")
SAFE = re.compile(r"^[A-Za-z0-9._@+:/-]{1,200}$")
PARENT_ENV = {
    "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "SSH_AUTH_SOCK",
    "PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME", "PI_MODEL", "PI_PROVIDER", "DD",
    "PI_TIMEOUT", "HEALTH_WAIT", "PI_MEM_CAP_GB", "LLAMA_URL", "SERVING_FINGERPRINT_HELPER",
}


class StudyError(ValueError):
    pass


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, indent=2)
            handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path); os.chmod(path, 0o600)
    except Exception:
        try: os.unlink(temporary)
        except OSError: pass
        raise


def load_manifest(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    try: manifest = json.loads(raw)
    except json.JSONDecodeError as exc: raise StudyError("study manifest is not valid JSON") from exc
    expected = {"schema", "name", "model", "fixtures", "surface_sha256", "model_registry_sha256",
                "control_config_sha256", "candidate_config_sha256", "rendered_governor_sha256", "seed"}
    if not isinstance(manifest, dict) or set(manifest) != expected or manifest.get("schema") != SCHEMA:
        raise StudyError("study manifest has an unsupported shape")
    if not SAFE.fullmatch(str(manifest.get("name", ""))) or not SAFE.fullmatch(str(manifest.get("model", ""))):
        raise StudyError("study name and model must be bounded identifiers")
    fixtures = manifest.get("fixtures")
    if not isinstance(fixtures, list) or len(fixtures) < 2 or len(fixtures) > 12 or len(set(fixtures)) != len(fixtures):
        raise StudyError("study requires 2-12 distinct fixtures")
    if any(not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", item) for item in fixtures):
        raise StudyError("fixture identifiers are invalid")
    for field in ("surface_sha256", "model_registry_sha256", "control_config_sha256",
                  "candidate_config_sha256", "rendered_governor_sha256"):
        if not isinstance(manifest.get(field), str) or not HASH.fullmatch(manifest[field]):
            raise StudyError(f"{field} must be a SHA-256 digest")
    if sha(BASE_CONFIG.read_bytes()) != manifest["control_config_sha256"] or sha(CAND_CONFIG.read_bytes()) != manifest["candidate_config_sha256"]:
        raise StudyError("study config bytes differ from the frozen manifest")
    if not isinstance(manifest.get("seed"), int) or isinstance(manifest.get("seed"), bool) or not 0 <= manifest["seed"] < 2**63:
        raise StudyError("seed must be a non-negative 63-bit integer")
    serialized = json.dumps(manifest, sort_keys=True)
    if re.search(r"(?:https?://|ssh|endpoint|hostname|password|token|api.?key|/[Uu]sers/|/home/)", serialized, re.I):
        raise StudyError("study manifest contains a forbidden transport, path, or credential marker")
    return {**manifest, "manifest_path": path.resolve(), "manifest_sha256": sha(raw)}


def artifact_root(manifest: dict[str, Any]) -> Path:
    agent = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent"))
    return agent / "artifacts" / "failure-episode-studies" / manifest["manifest_sha256"]


def state_paths(manifest: dict[str, Any]) -> tuple[Path, Path]:
    root = artifact_root(manifest)
    return root / "state.json", root / "rows.jsonl"


def load_state(manifest: dict[str, Any]) -> dict[str, Any]:
    state_path, _ = state_paths(manifest)
    if not state_path.exists():
        return {"schema": SCHEMA, "manifest_sha256": manifest["manifest_sha256"], "completed": [], "power_n": None,
                "eligible_fixtures": [], "primary_passed": None, "replication_passed": None}
    try: state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc: raise StudyError("private study state is unreadable") from exc
    if state.get("schema") != SCHEMA or state.get("manifest_sha256") != manifest["manifest_sha256"]:
        raise StudyError("private study state does not match the manifest")
    return state


def save_state(manifest: dict[str, Any], state: dict[str, Any]) -> None:
    atomic_json(state_paths(manifest)[0], state)


def source_defaults() -> tuple[str, str]:
    prompt = (REPO / "harness/lib/active-tool-prompts.ts").read_text(encoding="utf-8")
    arbiter = (REPO / "harness/lib/control-proposal.ts").read_text(encoding="utf-8")
    pm = re.search(r'ACTIVE_TOOL_PROMPTS_DEFAULT[^=]*=\s*"(ambient|derived)"', prompt)
    am = re.search(r'CONTROL_ARBITER_DEFAULT[^=]*=\s*"(shadow|enforce)"', arbiter)
    if not pm or not am: raise StudyError("cannot resolve coherence defaults")
    return pm.group(1), am.group(1)


def safe_transport() -> None:
    if os.environ.get("LLAMA_API_KEY"):
        raise StudyError("powered Ling trials refuse inherited HTTP credentials")
    parsed = urlsplit(os.environ.get("LLAMA_URL", ""))
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "::1", "localhost") or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise StudyError("LLAMA_URL must be a credential-free loopback HTTP tunnel")
    helper = Path(os.environ.get("SERVING_FINGERPRINT_HELPER", ""))
    if not helper.is_absolute() or not helper.is_file() or not os.access(helper, os.X_OK):
        raise StudyError("SERVING_FINGERPRINT_HELPER must be an absolute executable private helper")


def preflight(manifest: dict[str, Any], state: dict[str, Any], *, probe: bool = True) -> None:
    safe_transport()
    if source_defaults() != ("derived", "enforce"):
        raise StudyError("coherence adoption is not active; Ling calibration is intentionally blocked")
    agent = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent"))
    models = agent / "models.json"
    registry_hash = sha(models.read_bytes()) if models.is_file() else ""
    if registry_hash != manifest["model_registry_sha256"]:
        raise StudyError("model registry hash does not match the frozen study manifest")
    for task in manifest["fixtures"]:
        subprocess.run([sys.executable, str(LAB / "eval_fixture.py"), "state", task], cwd=REPO,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    if probe:
        sys.path.insert(0, str(LAB)); import serving_fingerprint as sf
        fingerprint = sf.capture(os.environ["LLAMA_URL"], manifest["model"])
        if fingerprint["status"] != "complete": raise StudyError("serving fingerprint is incomplete")
    completed = set(state["completed"]); completed.add("preflight"); state["completed"] = sorted(completed)
    save_state(manifest, state)


def rows(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    _, path = state_paths(manifest)
    if not path.exists(): return []
    result = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip(): continue
        try: row = json.loads(line)
        except json.JSONDecodeError as exc: raise StudyError(f"private result row {number} is malformed") from exc
        result.append(row)
    return result


def validity_verdicts(manifest: dict[str, Any]) -> dict[str, Any]:
    sys.path.insert(0, str(LAB)); import trial_validity
    _, result_path = state_paths(manifest)
    return trial_validity.load_sidecar(result_path) or {}


def require_validity(row: dict[str, Any], verdicts: dict[str, Any]) -> None:
    sys.path.insert(0, str(LAB)); import trial_validity
    verdict = verdicts.get(trial_validity.row_key(row))
    if not isinstance(verdict, dict):
        raise StudyError("trial row has no validity verdict")
    criteria = verdict.get("criteria") or {}
    if verdict.get("void") is not False or (criteria.get("infra_valid") or {}).get("outcome") != "PASS":
        raise StudyError("trial row failed mandatory validity checks")
    if (criteria.get("reward_hacking") or {}).get("outcome") != "PASS":
        raise StudyError("trial row lacks affirmative reward-hacking clearance")


def validate_row(row: dict[str, Any], manifest: dict[str, Any], verdicts: dict[str, Any] | None = None) -> None:
    sys.path.insert(0, str(LAB)); import row_contract
    try:
        row_contract.validate_powered_row(row, require_complete=True)
    except ValueError as exc:
        raise StudyError(str(exc)) from exc
    if row.get("authoritative") is not True or row.get("status") != "complete" or (row.get("usage") or {}).get("exact") is not True:
        raise StudyError("trial row is non-authoritative, incomplete, or lacks exact usage")
    if (row.get("experiment") or {}).get("manifest_sha256") != manifest["manifest_sha256"]:
        raise StudyError("trial row is not bound to the study manifest")
    if (row.get("harness") or {}).get("surface_sha256") != manifest["surface_sha256"]:
        raise StudyError("trial row harness surface differs from the frozen study")
    if (row.get("execution") or {}).get("agent_models_sha256") != manifest["model_registry_sha256"]:
        raise StudyError("trial row model registry differs from the frozen study")
    config = row.get("config") or {}
    expected_config = manifest["control_config_sha256"] if row.get("arm") == "base" else manifest["candidate_config_sha256"]
    if config.get("sha256") != expected_config or config.get("rendered_governor_sha256") != manifest["rendered_governor_sha256"]:
        raise StudyError("trial row config or rendered governor differs from the frozen study")
    serving = row.get("serving") or {}; pre = serving.get("pre") or {}; post = serving.get("post") or {}
    if serving.get("stable") is not True or pre.get("full_sha256") != post.get("full_sha256"):
        raise StudyError("trial row serving fingerprint moved during execution")
    require_validity(row, verdicts if verdicts is not None else validity_verdicts(manifest))


def cell_key(stage: str, fixture: str, arm: str, repetition: int) -> str:
    return f"{stage}:{fixture}:{arm}:{repetition}"


def existing_cells(manifest: dict[str, Any]) -> set[str]:
    found = set()
    verdicts = validity_verdicts(manifest)
    for row in rows(manifest):
        validate_row(row, manifest, verdicts)
        cell = (row.get("experiment") or {}).get("cell", "")
        found.add(f"{cell}:{row.get('task')}:{row.get('arm')}:{row.get('repetition')}")
    return found


def run_cell(manifest: dict[str, Any], stage: str, fixture: str, arm: str, repetition: int) -> None:
    _, result_path = state_paths(manifest); result_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    env = {key: os.environ[key] for key in PARENT_ENV if key in os.environ}
    env.update({
        "GEN": f"ling-{stage}", "N": "1", "REP_START": str(repetition), "ARM": arm,
        "BASE": str(BASE_CONFIG), "CAND": str(CAND_CONFIG), "RESULTS": str(result_path), "RESULTS_MODE": "append",
        "REAL_GATE_RUNS": str(result_path.parent / "runs"), "GATE_NETWORK": "endpoint", "MODEL_CONTROL": "llama",
        "INTERLEAVE": "on", "SANDBOX": "on", "REQUIRE_EXACT_USAGE": "1", "PI_MODEL": manifest["model"],
        "EXPERIMENT_MANIFEST": str(manifest["manifest_path"]), "EXPERIMENT_MANIFEST_SHA256": manifest["manifest_sha256"],
        "EXPERIMENT_BASE_CELL": stage, "EXPERIMENT_CAND_CELL": stage,
    })
    before = len(rows(manifest))
    subprocess.run([str(REAL_GATE), fixture], cwd=OPTIMIZER, env=env, check=True)
    after_rows = rows(manifest)
    if len(after_rows) != before + 1: raise StudyError("gate cell did not append exactly one result row")
    validate_row(after_rows[-1], manifest, validity_verdicts(manifest))


def execute_cells(manifest: dict[str, Any], state: dict[str, Any], stage: str, fixtures: list[str], arms: list[str], reps: int) -> None:
    present = existing_cells(manifest)
    for fixture in fixtures:
        for repetition in range(1, reps + 1):
            order = arms if repetition % 2 else list(reversed(arms))
            for arm in order:
                key = cell_key(stage, fixture, arm, repetition)
                if key in present: continue
                run_cell(manifest, stage, fixture, arm, repetition); present.add(key)
    completed = set(state["completed"]); completed.add(stage); state["completed"] = sorted(completed)
    save_state(manifest, state)


def stage_rows(manifest: dict[str, Any], stage: str) -> list[dict[str, Any]]:
    selected = [row for row in rows(manifest) if (row.get("experiment") or {}).get("cell") == stage]
    verdicts = validity_verdicts(manifest)
    for row in selected: validate_row(row, manifest, verdicts)
    contracts = {(row["model"], row["serving"]["pre"]["semantic_sha256"],
                  row["serving"]["pre"]["performance_sha256"], row["serving"]["pre"]["full_sha256"])
                 for row in selected}
    if len(contracts) > 1: raise StudyError(f"{stage} rows span multiple serving contracts")
    return selected


def calibration(manifest: dict[str, Any], state: dict[str, Any]) -> list[str]:
    # Thresholds live in admission_rule.py (PREREG_FIXTURE_ADMISSION_2026-08.md);
    # this study needs core admission AND E1 episode eligibility — E1 is scoped
    # here (a semantic_failure_overrun study) rather than welded into general
    # admission, which was the 2026-08-13 scope error the prereg corrects.
    import admission_rule
    eligible, receipts = [], {}
    for fixture in manifest["fixtures"]:
        sample = [r for r in stage_rows(manifest, "calibrate") if r.get("task") == fixture and r.get("arm") == "base"]
        core = admission_rule.core_admission(sample)
        episodes = admission_rule.episode_eligibility(sample)
        receipts[fixture] = {"core": core, "episodes": episodes}
        if core["verdict"] == "ADMITTED" and episodes["eligible"]: eligible.append(fixture)
    state["eligible_fixtures"] = eligible; state["admission_receipts"] = receipts; save_state(manifest, state)
    if len(eligible) < 2: raise StudyError("fewer than two fixtures passed the preregistered admission rule (PREREG_FIXTURE_ADMISSION_2026-08.md)")
    return eligible


def percentile(values: list[float], q: float) -> float:
    values = sorted(values); index = (len(values) - 1) * q; low = math.floor(index); high = math.ceil(index)
    return values[low] if low == high else values[low] * (high - index) + values[high] * (index - low)


def bootstrap_ci(control: list[int], candidate: list[int], rng: random.Random, draws: int) -> tuple[float, float]:
    diffs = []
    for _ in range(draws):
        c = statistics.fmean(rng.choices(control, k=len(control)))
        t = statistics.fmean(rng.choices(candidate, k=len(candidate)))
        diffs.append(t - c)
    return percentile(diffs, .025), percentile(diffs, .975)


def power_for(sample: list[int], n: int, seed: int, simulations: int = 500, bootstraps: int = 1000) -> float:
    rng = random.Random(seed + n); successes = 0
    for _ in range(simulations):
        control = rng.choices(sample, k=n)
        candidate = [sum(rng.random() >= .30 for _ in range(value)) for value in control]
        _, high = bootstrap_ci(control, candidate, rng, bootstraps)
        successes += high < 0
    return successes / simulations


def choose_power(manifest: dict[str, Any], state: dict[str, Any], *, simulations: int = 500, bootstraps: int = 1000) -> int:
    eligible = calibration(manifest, state)
    sample = [((r.get("context") or {}).get("failure_episodes") or {}).get("semantic_failure_overrun", 0)
              for r in stage_rows(manifest, "calibrate") if r.get("task") in eligible]
    if not sample: raise StudyError("calibration contains no zero-inclusive overrun sample")
    powers = {n: power_for(sample, n, manifest["seed"], simulations, bootstraps) for n in (40, 48, 56, 64, 72, 80)}
    selected = next((n for n, value in powers.items() if value >= .80), None)
    state["power"] = {"simulations": simulations, "bootstrap_draws": bootstraps,
                      "estimated_power": {str(k): v for k, v in powers.items()}}
    state["power_n"] = selected
    completed = set(state["completed"]); completed.add("power"); state["completed"] = sorted(completed); save_state(manifest, state)
    if selected is None: raise StudyError("80 sessions per arm did not reach 80% power; redesign the fixture")
    return selected


def analyze(rows_: list[dict[str, Any]], seed: int, draws: int = 10000) -> dict[str, Any]:
    arms = {name: [row for row in rows_ if row.get("arm") == name] for name in ("base", "cand")}
    if not arms["base"] or len(arms["base"]) != len(arms["cand"]): raise StudyError("analysis arms are missing or unbalanced")
    metric = lambda row: ((row.get("context") or {}).get("failure_episodes") or {}).get("semantic_failure_overrun", 0)
    control = [metric(r) for r in arms["base"]]; candidate = [metric(r) for r in arms["cand"]]
    cmean, tmean = statistics.fmean(control), statistics.fmean(candidate)
    low, high = bootstrap_ci(control, candidate, random.Random(seed), draws)
    reduction = (cmean - tmean) / cmean if cmean else 0.0
    correctness_delta = statistics.fmean(r["score"] for r in arms["cand"]) - statistics.fmean(r["score"] for r in arms["base"])
    interventions = sum(sum(item.get("count", 0) for item in
                            (((r.get("context") or {}).get("failure_episodes") or {}).get("interventions") or [])) > 0
                        for r in arms["cand"])
    exposure = interventions / len(arms["cand"])
    token_control = [r["usage"]["input_tokens"] + r["usage"]["output_tokens"] for r in arms["base"]]
    token_candidate = [r["usage"]["input_tokens"] + r["usage"]["output_tokens"] for r in arms["cand"]]
    token_low, token_high = bootstrap_ci(token_control, token_candidate, random.Random(seed + 1), draws)
    passed = reduction >= .20 and high < 0 and correctness_delta >= -.05 and exposure >= .20 and token_low <= 0
    return {"rows_per_arm": len(control), "control_mean": cmean, "candidate_mean": tmean, "reduction": reduction,
            "difference_ci95": [low, high], "correctness_delta": correctness_delta, "candidate_exposure": exposure,
            "token_difference_ci95": [token_low, token_high], "passed": passed}


def write_report(manifest: dict[str, Any], stage: str, report: dict[str, Any]) -> None:
    path = artifact_root(manifest) / f"{stage}.json"
    atomic_json(path, {"schema": SCHEMA, "manifest_sha256": manifest["manifest_sha256"], "stage": stage, "result": report})


def require(state: dict[str, Any], stage: str) -> None:
    if stage not in state["completed"]: raise StudyError(f"required prior stage is incomplete: {stage}")


def selftest() -> None:
    assert percentile([0, 1, 2, 3], .5) == 1.5
    assert power_for([0, 1, 2, 3, 6], 20, 7, simulations=20, bootstraps=40) >= 0
    fake = lambda arm, overrun, score=1, interventions=0, tokens=10: {
        "arm": arm, "score": score, "usage": {"input_tokens": tokens, "output_tokens": 0},
        "context": {"failure_episodes": {"semantic_failure_overrun": overrun,
                                             "interventions": ([{"detector": "semantic", "tier": 1, "count": interventions}]
                                                               if interventions else [])}}}
    report = analyze([fake("base", 10), fake("base", 8), fake("cand", 2, interventions=1), fake("cand", 1, interventions=1)], 4, draws=200)
    assert report["reduction"] > .20 and report["candidate_exposure"] == 1
    validity_row = {"run": "g", "task": "t", "arm": "base", "rep": 1}
    validity_key = "g:t:base:1"
    clear = {"row_key": validity_key, "void": False, "criteria": {
        "infra_valid": {"outcome": "PASS"}, "reward_hacking": {"outcome": "PASS"}}}
    require_validity(validity_row, {validity_key: clear})
    for invalid in (
        {},
        {validity_key: clear | {"void": True}},
        {validity_key: clear | {"criteria": clear["criteria"] | {"reward_hacking": {"outcome": "NOT_APPLICABLE"}}}},
    ):
        try: require_validity(validity_row, invalid)
        except StudyError: pass
        else: raise AssertionError("missing, void, or inconclusive validity must refuse a powered row")
    digest = "a" * 64
    manifest = {
        "manifest_sha256": digest, "surface_sha256": digest,
        "model_registry_sha256": digest, "control_config_sha256": digest,
        "candidate_config_sha256": "b" * 64, "rendered_governor_sha256": digest,
    }
    episodes = {"complete": True, "settlement_summaries": 1, **{
        field: 0 for field in (
            "total_episodes", "total_failures", "longest_episode", "semantic_failure_overrun",
            "correlated_failure_overrun", "settled_without_recovery", "failures_after_second",
            "recovered_episodes", "recovery_calls_total", "recovery_calls_max",
        )
    }}
    powered = {
        "schema": "pi.eval-row/v3", "task": "t", "model": "m", "arm": "base", "run": "g",
        "pattern": "base", "rep": 1, "repetition": 1, "status": "complete", "score": 1,
        "authoritative": True, "usage": {"exact": True},
        "context": {"schema": "pi.context-telemetry/v3", "authenticated": True, "failure_episodes": episodes},
        "experiment": {"manifest_sha256": digest}, "harness": {"surface_sha256": digest},
        "execution": {"agent_models_sha256": digest},
        "config": {"sha256": digest, "rendered_governor_sha256": digest},
        "serving": {"stable": True, "pre": {"full_sha256": digest}, "post": {"full_sha256": digest}},
    }
    validate_row(powered, manifest, {validity_key: clear})
    powered_v4 = json.loads(json.dumps(powered))
    powered_v4["schema"] = "pi.eval-row/v4"
    powered_v4["context"]["schema"] = "pi.context-telemetry/v4"
    powered_v4["context"]["verification_frontier"] = {
        "complete": True, "settlement_summaries": 1, "protocol": "unknown",
        "recognized_gates": 0, "current_passed": None, "current_failed": None,
        "current_skipped": None, "current_total": None, "best_passed": None,
        "best_failed": None, "best_skipped": None, "best_total": None,
        "last_advanced": False, "plateau_streak": 0,
        "successful_mutation_epochs_since_advance": 0, "verification_plateau_overrun": 0,
    }
    validate_row(powered_v4, manifest, {validity_key: clear})
    powered_v4["context"]["verification_frontier"]["settlement_summaries"] = 0
    try: validate_row(powered_v4, manifest, {validity_key: clear})
    except StudyError: pass
    else: raise AssertionError("a v4 row without exactly one frontier settlement must be refused")
    try: validate_row(powered, manifest, {})
    except StudyError: pass
    else: raise AssertionError("a structurally valid powered row without validity must be refused")
    try: load_manifest(Path("/definitely/missing"))
    except OSError: pass
    else: raise AssertionError("missing manifests must fail")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td); helper = root / "helper"
        helper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8"); helper.chmod(0o700)
        previous = {key: os.environ.get(key) for key in ("LLAMA_URL", "SERVING_FINGERPRINT_HELPER", "LLAMA_API_KEY")}
        try:
            os.environ["LLAMA_URL"] = "http://" + ".".join(("127", "0", "0", "1")) + ":8123"
            os.environ["SERVING_FINGERPRINT_HELPER"] = str(helper)
            os.environ.pop("LLAMA_API_KEY", None); safe_transport()
            os.environ["LLAMA_API_KEY"] = "dummy-sentinel"
            try: safe_transport()
            except StudyError: pass
            else: raise AssertionError("HTTP credentials must be refused")
            os.environ.pop("LLAMA_API_KEY", None)
            os.environ["LLAMA_URL"] = "http://" + ".".join(("192", "0", "2", "1")) + ":8123"
            try: safe_transport()
            except StudyError: pass
            else: raise AssertionError("direct network endpoints must be refused")
            private = root / "private" / "state.json"; atomic_json(private, {"ok": True})
            assert private.stat().st_mode & 0o777 == 0o600 and private.parent.stat().st_mode & 0o777 == 0o700
        finally:
            for key, value in previous.items():
                if value is None: os.environ.pop(key, None)
                else: os.environ[key] = value
    print("failure_episode_trial selftest: OK")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", nargs="?", choices=STAGES)
    parser.add_argument("manifest", nargs="?", type=Path)
    parser.add_argument("--execute", action="store_true", help="authorize only this requested inference stage")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest: selftest(); return
    if args.manifest is None: raise SystemExit("manifest is required")
    try:
        manifest = load_manifest(args.manifest); state = load_state(manifest)
        if args.stage == "preflight": preflight(manifest, state); print("preflight complete; no later stage was started")
        elif args.stage == "calibrate":
            require(state, "preflight")
            if not args.execute: raise StudyError("calibrate requires explicit --execute approval")
            execute_cells(manifest, state, "calibrate", manifest["fixtures"], ["base"], 6)
            calibration(manifest, state); print("calibration complete; run power separately")
        elif args.stage == "power":
            require(state, "calibrate"); n = choose_power(manifest, state); print(f"powered n={n} per arm; no primary sessions started")
        elif args.stage == "primary":
            require(state, "power")
            if not args.execute: raise StudyError("primary requires explicit --execute approval")
            fixture = state["eligible_fixtures"][0]
            execute_cells(manifest, state, "primary", [fixture], ["base", "cand"], state["power_n"])
            print("primary execution complete; run primary-report separately")
        elif args.stage == "primary-report":
            require(state, "primary"); report = analyze(stage_rows(manifest, "primary"), manifest["seed"])
            write_report(manifest, "primary-report", report); state["primary_passed"] = report["passed"]
            state["completed"] = sorted(set(state["completed"]) | {"primary-report"}); save_state(manifest, state)
            print(json.dumps(report, sort_keys=True))
        elif args.stage == "replication":
            require(state, "primary-report")
            if state.get("primary_passed") is not True: raise StudyError("primary adoption criteria were not met")
            if not args.execute: raise StudyError("replication requires explicit --execute approval")
            fixture = state["eligible_fixtures"][1]
            execute_cells(manifest, state, "replication", [fixture], ["base", "cand"], state["power_n"])
            print("replication execution complete; run final-report separately")
        elif args.stage == "final-report":
            require(state, "replication"); primary = analyze(stage_rows(manifest, "primary"), manifest["seed"])
            replication = analyze(stage_rows(manifest, "replication"), manifest["seed"] + 2)
            final = {"primary": primary, "replication": replication,
                     "adoptable": (primary["passed"] and replication["reduction"] > 0 and
                                    replication["correctness_delta"] >= -.05 and
                                    replication["token_difference_ci95"][0] <= 0)}
            write_report(manifest, "final-report", final); state["replication_passed"] = final["adoptable"]
            state["completed"] = sorted(set(state["completed"]) | {"final-report"}); save_state(manifest, state)
            print(json.dumps(final, sort_keys=True))
    except (OSError, StudyError, subprocess.CalledProcessError, ValueError) as exc:
        raise SystemExit(f"failure-episode study refused: {exc}")


if __name__ == "__main__": main()
