#!/usr/bin/env python3
"""Fail-closed fixture admission and read-only verification for pi.fixture/v1+v2 manifests.

v2 (2026-08, the measurement reboot) adds the authoring-rubric fields the band
calibration showed were missing: a pre-registered difficulty crux, a findability
chain, shortcut-sharpness rationale, and an episode-variance expectation — plus a
deterministic behaviour-only lint over hidden overlays (source-reading assertions
are flagged for the human reviewer; Harbor's "never string-match source" rule).
v1 manifests stay valid for the existing cohort; new fixtures are authored as v2.
"""
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
OUTPUT_TAIL_BYTES = 2048


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


def verification_env(temp_root: Path):
    """Minimal deterministic environment for executable fixture commands."""
    home = temp_root / "home"
    scratch = temp_root / "tmp"
    home.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    env = {
        "CI": "1",
        "HOME": str(home),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "TMPDIR": str(scratch),
        "npm_config_cache": str(temp_root / "npm-cache"),
    }
    for key in ("LANG", "LC_ALL", "SYSTEMROOT", "WINDIR"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


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


SCHEMAS = ("pi.fixture/v1", "pi.fixture/v2")


def validate_contract(m):
    required = ("schema", "task_id", "cohort_id", "fixture_version", "timestamps",
                "prompts", "fixture", "tests", "patches", "sufficiency",
                "one_shot", "admission", "artifacts")
    missing = [key for key in required if key not in m]
    if missing or m.get("schema") not in SCHEMAS:
        raise AdmissionError(f"invalid manifest: missing={missing} schema={m.get('schema')}")
    if m["schema"] == "pi.fixture/v2":
        validate_v2_fields(m)
    variants = m["prompts"].get("perturbations", [])
    if len(variants) != 3 or any(not p.get("text") or not p.get("sha256") for p in variants):
        raise AdmissionError("manifest needs exactly three hashed prompt perturbations")
    if not m["sufficiency"] or any(not x.get("assertion") or not x.get("prompt_evidence") for x in m["sufficiency"]):
        raise AdmissionError("every hidden assertion needs prompt sufficiency evidence")
    if not m["patches"].get("gold") or not m["patches"].get("shortcut_mutants"):
        raise AdmissionError("gold and shortcut-mutant patches are required")
    pressure = m.get("context_pressure")
    if pressure:
        if pressure.get("schema") != "pi.context-pressure/v1":
            raise AdmissionError("invalid context-pressure contract")
        validation = safe_root(pressure.get("validation_root", ""))
        held_out = safe_root(pressure.get("held_out_root", ""))
        if (not validation.is_dir() or not held_out.is_dir() or validation == held_out
                or validation in held_out.parents or held_out in validation.parents):
            raise AdmissionError("context-pressure validation and held-out roots must exist and be disjoint")
        if pressure.get("roots_disjoint") is not True:
            raise AdmissionError("context-pressure contract must declare disjoint roots")
        if not pressure.get("generator_command") or not pressure.get("generated_artifacts"):
            raise AdmissionError("context-pressure generator and generated artifact hashes are required")


def validate_v2_fields(m):
    """The pi.fixture/v2 authoring-rubric contract (LING_COHORT_2026-08.md template,
    preregistered rule in PREREG_FIXTURE_ADMISSION_2026-08.md).

    difficulty_crux is the author's pre-data claim about what makes the fixture
    hard — written down so calibration can grade the CLAIM, not just the fixture.
    band_prediction is [low, high] on the graded_rate scale for the named tier.
    """
    crux = m.get("difficulty_crux") or {}
    for key in ("mechanism", "expected_failure", "band_prediction"):
        if not crux.get(key):
            raise AdmissionError(f"v2 manifest requires difficulty_crux.{key}")
    band = crux["band_prediction"]
    if (not isinstance(band, list) or len(band) != 2
            or not all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in band)
            or band[0] > band[1]):
        raise AdmissionError("difficulty_crux.band_prediction must be [low, high] within [0, 1]")
    findability = m.get("findability")
    if (not isinstance(findability, list) or not findability
            or any(not step.get("evidence_file") or not step.get("sentence_anchor") for step in findability)):
        raise AdmissionError("v2 manifest requires a findability chain: [{evidence_file, sentence_anchor}, ...]")
    sharpness = m.get("shortcut_sharpness") or {}
    if not sharpness.get("why_plausible"):
        raise AdmissionError("v2 manifest requires shortcut_sharpness.why_plausible")
    episode = m.get("episode_variance") or {}
    if not isinstance(episode.get("expected"), bool) or not episode.get("rationale"):
        raise AdmissionError("v2 manifest requires episode_variance{expected: bool, rationale}")


# Deterministic behaviour-only lint: a hidden/graded suite must assert observable
# behaviour, not source shape. These patterns catch a test that READS project
# source and then string/regex-asserts on it. Heuristic by design, so a hit is
# FLAGGED for the human reviewer (review packet + check output), never auto-failed —
# a legitimate data-file read must not brick admission, and a clever evasion is
# exactly what the human gate exists for.
OVERLAY_SOURCE_READ_PATTERNS = (
    "readFileSync", "readFile(", "fs.promises.readFile", "createReadStream",
)
OVERLAY_SHAPE_ASSERT_PATTERNS = (
    "assert.match", "assert.doesNotMatch", ".includes(", "indexOf(",
)


def overlay_lint(m):
    """Flag hidden-overlay tests that read files AND shape-assert on the result."""
    flags = []
    for suite in m.get("tests", {}).values():
        for item in suite.get("overlays", []):
            source = safe_root(item["source"])
            if not source.is_file():
                continue
            text = source.read_text(encoding="utf-8", errors="replace")
            reads = [p for p in OVERLAY_SOURCE_READ_PATTERNS if p in text]
            asserts = [p for p in OVERLAY_SHAPE_ASSERT_PATTERNS if p in text]
            if reads and asserts:
                flags.append({"overlay": item["source"], "reads": reads, "shape_asserts": asserts})
    return flags


def safe_root(relative):
    path = (ROOT / relative).resolve()
    if ROOT not in path.parents and path != ROOT:
        raise AdmissionError(f"artifact escapes repository: {relative}")
    return path


def manifest_digest(m):
    """Hash of everything the manifest defines — command, overlays, timeouts, grader,
    prompts, expiry. The admission block itself is excluded so recording automation
    evidence or the approval does not invalidate the approval."""
    body = {k: v for k, v in m.items() if k != "admission"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def manifest_drift(m):
    """An approval that no longer describes this manifest. Reported, never folded into
    `passed`: editing then re-checking then re-approving is the intended repair path."""
    stored = m["admission"].get("manifest_sha256")
    return bool(stored) and stored != manifest_digest(m)


def artifact_drift(m):
    errors = []
    for item in m["artifacts"]:
        path = safe_root(item["path"])
        if not path.is_file():
            errors.append(f"missing:{item['path']}")
        elif sha256(path) != item["sha256"]:
            errors.append(f"hash:{item['path']}")
    pressure = m.get("context_pressure")
    if pressure and not errors:
        try:
            with tempfile.TemporaryDirectory(prefix=f"pi-generated-{m['task_id']}-") as td:
                work = stage(m, Path(td))
                proc = subprocess.run(pressure["generator_command"], cwd=work, text=True,
                                      capture_output=True, timeout=60,
                                      env=verification_env(Path(td)))
                if proc.returncode:
                    errors.append(f"generated:command:{proc.returncode}")
                else:
                    for item in pressure["generated_artifacts"]:
                        generated = (work / item["path"]).resolve()
                        if not generated.is_relative_to(work.resolve()) or not generated.is_file():
                            errors.append(f"generated:missing:{item['path']}")
                        elif sha256(generated) != item["sha256"]:
                            errors.append(f"generated:hash:{item['path']}")
        except (OSError, subprocess.SubprocessError) as exc:
            errors.append(f"generated:execution:{type(exc).__name__}")
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
                                  timeout=spec.get("timeout_seconds", 60),
                                  env=verification_env(Path(td)))
            passed = proc.returncode == 0
            output = (proc.stdout + proc.stderr).encode("utf-8", errors="replace")
            # output_tail restored 2026-08-15 (charter flag 8, deliberately reversing
            # the 2026-08-13 hash-only receipts): hash-only detects drift but cannot
            # explain a failure — the ordered-steps floor diagnosis depended on
            # reading the per-suite assertion output. Bounded, tail-biased (the
            # assertion diff is at the end), and PATH-REDACTED so the receipts keep
            # the privacy property the hash-only change was protecting.
            tail = redact_paths(output[-OUTPUT_TAIL_BYTES:].decode("utf-8", errors="replace"))
            outcomes.append({"passed": passed, "returncode": proc.returncode,
                             "output_bytes": len(output), "output_sha256": hashlib.sha256(output).hexdigest(),
                             "output_tail": tail})
    return outcomes


PATH_RE = None  # compiled lazily; regex import kept local to the one consumer


def redact_paths(text):
    """Strip absolute filesystem paths from receipt tails (machine layout is private)."""
    global PATH_RE
    if PATH_RE is None:
        import re
        PATH_RE = re.compile(r"/(?:private|Users|var|tmp|home)/[^\s'\"):]*")
    return PATH_RE.sub("<path>", text)


def all_pass(rows):
    return len(rows) == RUNS and all(row["passed"] for row in rows)


def all_fail(rows):
    return len(rows) == RUNS and all(not row["passed"] for row in rows)


def check_one(task, write=True):
    """Run automated checks; optionally record their evidence in the manifest."""
    path, m = load_manifest(task)
    drift = artifact_drift(m)
    result = {"checked_at": iso(utcnow()), "runs_per_state": RUNS, "hash_drift": drift,
              "manifest_drift": manifest_drift(m), "overlay_lint": overlay_lint(m),
              "states": {}, "passed": False}
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
            # Both arms assert. f2p all-fail is the rejection (the shortcut must not
            # pass the hidden grader); p2p all-PASS is what makes the mutant a
            # meaningful decoy — a shortcut that breaks the visible suite is not a
            # plausible model solution, so its rejection proves nothing. The p2p arm
            # was recorded but never asserted until 2026-07-30 (triage #25); all
            # existing manifests already satisfy it (checked before adding).
            mutant_ok = mutant_ok and all_fail(f2p) and all_pass(p2p)
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
    crux = m.get("difficulty_crux")
    if crux:
        lines += ["## Difficulty crux (author's pre-data claim)", "",
                  f"- Mechanism: {crux['mechanism']}",
                  f"- Expected failure: {crux['expected_failure']}",
                  f"- Band prediction: `{crux['band_prediction']}`", ""]
    auto = m["admission"].get("automated") or {}
    lines += ["## Automated admission", "", f"- Passed: `{auto.get('passed', False)}`",
              f"- Checked: `{auto.get('checked_at', 'not run')}`", ""]
    lint = auto.get("overlay_lint") or []
    if lint:
        lines += ["### Behaviour-only lint FLAGS (human review required)", ""]
        for flag in lint:
            lines += [f"- `{flag['overlay']}` reads files ({', '.join(flag['reads'])}) and "
                      f"shape-asserts ({', '.join(flag['shape_asserts'])}) — confirm it asserts "
                      f"behaviour, not source shape"]
        lines += [""]
    lines += ["## Human decision", "",
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
                           "approved_prompt_hashes": [v["sha256"] for v in m["prompts"]["perturbations"]],
                           "manifest_sha256": manifest_digest(m)})
    path.write_text(json.dumps(m, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def authoritative(m, now=None):
    now = now or utcnow()
    try:
        expiry = dt.datetime.fromisoformat(m["timestamps"]["expires_at"].replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError, AttributeError):
        # KeyError matters: expires_at is written only by `approve`, so a manifest
        # that has never been approved has no such key at all. Without KeyError here
        # this raised instead of answering, which is the one thing an authority
        # check must not do — every caller asking "may this fixture be used?" about
        # a brand-new fixture crashed. Surfaced 2026-08-11 by the first fixtures
        # added since the check was written.
        return False, "missing expiry"
    checks = ((m["admission"].get("automated", {}).get("passed"), "automation not passed"),
              (m["admission"].get("approved"), "human approval missing"),
              (not artifact_drift(m), "artifact hash drift"),
              (expiry > now, "fixture expired"),
              # Last, so the checks above keep their more specific reasons. Fail-closed on a
              # missing hash: an approval that predates this field never covered the content.
              (m["admission"].get("manifest_sha256") == manifest_digest(m), "manifest changed after approval"))
    for ok, reason in checks:
        if not ok:
            return False, reason
    return True, "authoritative"


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="run checks and record admission evidence")
    check.add_argument("task", nargs="?"); check.add_argument("--all", action="store_true")
    verify = sub.add_parser("verify", help="run the same checks without modifying manifests or review packets")
    verify.add_argument("task", nargs="?"); verify.add_argument("--all", action="store_true")
    packet = sub.add_parser("review-packet"); packet.add_argument("task")
    approval = sub.add_parser("approve"); approval.add_argument("task"); approval.add_argument("--reviewer", required=True)
    args = ap.parse_args()
    try:
        if args.command in ("check", "verify"):
            tasks = sorted(p.stem for p in MANIFESTS.glob("*.json")) if args.all else [args.task]
            if not tasks or tasks == [None]:
                raise AdmissionError("provide <task> or --all")
            failed = False
            for task in tasks:
                result = check_one(task, write=args.command == "check")
                suffix = "" if args.command == "check" else " (read-only; manifest unchanged)"
                print(f"{task}: {'PASS' if result['passed'] else 'FAIL'}{suffix}")
                if result["manifest_drift"]:
                    print(f"{task}: manifest edited since approval — not authoritative until re-approved")
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
