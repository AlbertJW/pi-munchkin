#!/usr/bin/env python3
"""Fail-closed fixture admission for pi.fixture/v1 manifests."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "real-gate-fixtures"
MANIFESTS = FIXTURES / "manifests"
PACKETS = FIXTURES / "review-packets"
RUNS = 3


class AdmissionError(RuntimeError):
    pass


def utcnow():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def sha256(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def manifest_path(task):
    path = MANIFESTS / f"{task}.json"
    if not path.is_file():
        raise AdmissionError(f"unknown fixture: {task}")
    return path


def load_manifest(task):
    path = manifest_path(task)
    data = json.loads(path.read_text(encoding="utf-8"))
    validate_contract(data)
    return path, data


def validate_contract(m):
    required = ("schema", "task_id", "cohort_id", "fixture_version", "timestamps",
                "prompts", "fixture", "tests", "patches", "sufficiency",
                "one_shot", "admission", "artifacts")
    missing = [key for key in required if key not in m]
    if missing or m.get("schema") != "pi.fixture/v1":
        raise AdmissionError(f"invalid manifest: missing={missing} schema={m.get('schema')}")
    variants = m["prompts"].get("perturbations", [])
    if len(variants) != 3 or any(not p.get("text") or not p.get("sha256") for p in variants):
        raise AdmissionError("manifest needs exactly three hashed prompt perturbations")
    if not m["sufficiency"] or any(not x.get("assertion") or not x.get("prompt_evidence") for x in m["sufficiency"]):
        raise AdmissionError("every hidden assertion needs prompt sufficiency evidence")
    if not m["patches"].get("gold") or not m["patches"].get("shortcut_mutants"):
        raise AdmissionError("gold and shortcut-mutant patches are required")


def safe_root(relative):
    path = (ROOT / relative).resolve()
    if ROOT not in path.parents and path != ROOT:
        raise AdmissionError(f"artifact escapes repository: {relative}")
    return path


def artifact_drift(m):
    errors = []
    for item in m["artifacts"]:
        path = safe_root(item["path"])
        if not path.is_file():
            errors.append(f"missing:{item['path']}")
        elif sha256(path) != item["sha256"]:
            errors.append(f"hash:{item['path']}")
    return errors


def copytree(src, dst):
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", ".git", ".DS_Store"))


def stage(m, temp_root: Path):
    work = temp_root / "work"
    copytree(safe_root(m["fixture"]["root"]), work)
    for item in m["fixture"].get("stage_copy", []):
        src = safe_root(item["source"])
        dst = work / item["dest"]
        if not dst.resolve().is_relative_to(work.resolve()):
            raise AdmissionError(f"stage destination escapes workdir: {item['dest']}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    return work


def apply_patch(work, relative):
    patch = safe_root(relative)
    proc = subprocess.run(["patch", "-p1", "--batch", "--forward", "-i", str(patch)],
                          cwd=work, text=True, capture_output=True, timeout=30)
    if proc.returncode:
        raise AdmissionError(f"patch failed {relative}: {proc.stdout}{proc.stderr}")


def install_overlays(work, overlays):
    for item in overlays:
        src = safe_root(item["source"])
        dst = work / item["dest"]
        if not dst.resolve().is_relative_to(work.resolve()):
            raise AdmissionError(f"test destination escapes workdir: {item['dest']}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def run_state(m, patch, suite):
    outcomes = []
    spec = m["tests"][suite]
    for _ in range(RUNS):
        with tempfile.TemporaryDirectory(prefix=f"pi-admit-{m['task_id']}-") as td:
            work = stage(m, Path(td))
            if patch:
                apply_patch(work, patch)
            install_overlays(work, spec.get("overlays", []))
            proc = subprocess.run(spec["command"], cwd=work, text=True, capture_output=True,
                                  timeout=spec.get("timeout_seconds", 60), env={**os.environ, "CI": "1"})
            passed = proc.returncode == 0
            outcomes.append({"passed": passed, "returncode": proc.returncode,
                             "output_tail": "" if passed else (proc.stdout + proc.stderr)[-600:]})
    return outcomes


def all_pass(rows):
    return len(rows) == RUNS and all(row["passed"] for row in rows)


def all_fail(rows):
    return len(rows) == RUNS and all(not row["passed"] for row in rows)


def check_one(task, write=True):
    path, m = load_manifest(task)
    drift = artifact_drift(m)
    result = {"checked_at": iso(utcnow()), "runs_per_state": RUNS, "hash_drift": drift, "states": {}, "passed": False}
    if not drift:
        result["states"]["pristine_pass_to_pass"] = run_state(m, None, "pass_to_pass")
        result["states"]["pristine_fail_to_pass"] = run_state(m, None, "fail_to_pass")
        gold = m["patches"]["gold"]
        result["states"]["gold_pass_to_pass"] = run_state(m, gold, "pass_to_pass")
        result["states"]["gold_fail_to_pass"] = run_state(m, gold, "fail_to_pass")
        mutant_ok = True
        for mutant in m["patches"]["shortcut_mutants"]:
            p2p = run_state(m, mutant, "pass_to_pass")
            f2p = run_state(m, mutant, "fail_to_pass")
            result["states"][f"mutant:{Path(mutant).stem}"] = {"pass_to_pass": p2p, "fail_to_pass": f2p}
            mutant_ok = mutant_ok and all_fail(f2p)
        result["passed"] = (all_pass(result["states"]["pristine_pass_to_pass"])
                            and all_fail(result["states"]["pristine_fail_to_pass"])
                            and all_pass(result["states"]["gold_pass_to_pass"])
                            and all_pass(result["states"]["gold_fail_to_pass"])
                            and mutant_ok)
    m["admission"]["automated"] = result
    if write:
        path.write_text(json.dumps(m, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return result


def review_packet(task):
    _, m = load_manifest(task)
    lines = [f"# Fixture review: {task}", "", f"- Schema: `{m['schema']}`",
             f"- Cohort: `{m['cohort_id']}`", f"- Version: `{m['fixture_version']}`",
             f"- Expires: `{m['timestamps'].get('expires_at') or 'set on approval'}`", "",
             "## Canonical prompt", "", m["prompts"]["canonical"]["text"], "",
             "## Hidden expectation sufficiency", ""]
    for item in m["sufficiency"]:
        lines += [f"- **{item['assertion']}** — {item['prompt_evidence']}"]
    lines += ["", "## Equivalent perturbations", ""]
    for item in m["prompts"]["perturbations"]:
        lines += [f"### {item['id']}", "", item["text"], ""]
    auto = m["admission"].get("automated") or {}
    lines += ["## Automated admission", "", f"- Passed: `{auto.get('passed', False)}`",
              f"- Checked: `{auto.get('checked_at', 'not run')}`", "", "## Human decision", "",
              f"- Reviewer: `{m['admission'].get('reviewer') or 'pending'}`",
              f"- Approved: `{m['admission'].get('approved', False)}`", ""]
    PACKETS.mkdir(parents=True, exist_ok=True)
    out = PACKETS / f"{task}.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


def approve(task, reviewer):
    path, m = load_manifest(task)
    auto = m["admission"].get("automated") or {}
    if m["admission"].get("expired_at"):
        raise AdmissionError("expired fixtures are historical and cannot be reactivated; create a new version")
    if not auto.get("passed"):
        raise AdmissionError("automated admission has not passed")
    if artifact_drift(m):
        raise AdmissionError("artifact hash drift after automated admission")
    now = utcnow()
    m["timestamps"]["admitted_at"] = iso(now)
    m["timestamps"]["expires_at"] = iso(now + dt.timedelta(days=90))
    m["admission"].update({"approved": True, "reviewer": reviewer, "reviewed_at": iso(now),
                           "approved_prompt_hashes": [v["sha256"] for v in m["prompts"]["perturbations"]]})
    path.write_text(json.dumps(m, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def authoritative(m, now=None):
    now = now or utcnow()
    try:
        expiry = dt.datetime.fromisoformat(m["timestamps"]["expires_at"].replace("Z", "+00:00"))
    except (TypeError, ValueError, AttributeError):
        return False, "missing expiry"
    checks = ((m["admission"].get("automated", {}).get("passed"), "automation not passed"),
              (m["admission"].get("approved"), "human approval missing"),
              (not artifact_drift(m), "artifact hash drift"),
              (expiry > now, "fixture expired"))
    for ok, reason in checks:
        if not ok:
            return False, reason
    return True, "authoritative"


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check"); check.add_argument("task", nargs="?"); check.add_argument("--all", action="store_true")
    packet = sub.add_parser("review-packet"); packet.add_argument("task")
    approval = sub.add_parser("approve"); approval.add_argument("task"); approval.add_argument("--reviewer", required=True)
    args = ap.parse_args()
    try:
        if args.command == "check":
            tasks = sorted(p.stem for p in MANIFESTS.glob("*.json")) if args.all else [args.task]
            if not tasks or tasks == [None]:
                raise AdmissionError("provide <task> or --all")
            failed = False
            for task in tasks:
                result = check_one(task)
                print(f"{task}: {'PASS' if result['passed'] else 'FAIL'}")
                failed |= not result["passed"]
            raise SystemExit(1 if failed else 0)
        if args.command == "review-packet":
            print(review_packet(args.task))
        elif args.command == "approve":
            approve(args.task, args.reviewer); print(f"{args.task}: approved by {args.reviewer}")
    except AdmissionError as exc:
        raise SystemExit(f"fixture_admission: {exc}")


if __name__ == "__main__":
    main()
