#!/usr/bin/env python3
"""Small manifest query interface shared by shell runners and reports."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from fixture_admission import MANIFESTS, authoritative, load_manifest, requirement_scoring


# A grader is WITHHELD when it lives in a directory the model's workdir never
# receives: the `hidden/` cohort and the context-pressure `*-heldout/` tree. Every
# fixture carries a tests.fail_to_pass overlay (admission replays it against the
# gold and mutant states), so the overlay alone does NOT make a task hidden --
# t1/t2/t3/t5/t6 stage their fail-to-pass test from the same visible files the gate
# installs pre-run via install_tests(). Scoping on the source location keeps that
# distinction data-driven instead of pinning it to one manifest flag.
WITHHELD_DIRS = ("hidden",)


def withheld_grader(manifest):
    """The fail-to-pass overlay source, but only when it is withheld from the model."""
    source = (manifest.get("tests", {}).get("fail_to_pass", {}).get("overlays") or [{}])[0].get("source")
    if not source:
        return None
    parts = Path(source).parts[:-1]
    return source if any(p in WITHHELD_DIRS or p.endswith("-heldout") for p in parts) else None


def prompt_record(manifest, variant):
    if variant == "canonical":
        return {"id": "canonical", **manifest["prompts"]["canonical"]}
    for item in manifest["prompts"]["perturbations"]:
        if item["id"] == variant:
            return item
    raise SystemExit(f"unknown prompt variant {variant}")


def row_context(task, variant, exploratory=False):
    _, manifest = load_manifest(task)
    ok, reason = authoritative(manifest)
    prompt = prompt_record(manifest, variant)
    prompt_approved = variant == "canonical" or prompt.get("sha256") in manifest["admission"].get("approved_prompt_hashes", [])
    return {
        "task": task,
        "cohort": manifest["cohort_id"],
        "version": manifest["fixture_version"],
        "semantic_group": manifest["prompts"]["semantic_group"],
        "prompt_variant": prompt["id"],
        "prompt_sha256": prompt["sha256"],
        "prompt_text": prompt["text"],
        "authoritative": bool(ok and prompt_approved),
        "fixture_authoritative": ok,
        "prompt_approved": prompt_approved,
        "authority_reason": reason,
        "exploratory_override": bool(exploratory and not ok),
        "one_shot": manifest["one_shot"],
        "fixture_root": manifest["fixture"]["root"],
    }


def grading_secrets(task):
    """The grading answer key. NEVER written to disk, NEVER placed in a prompt.

    These four fields used to ride along in the row-context JSON the gate wrote to
    `<workdir>.row-context.json` — a SIBLING of the model's own workdir, which
    `gate.sb` (allow default, read-denies for repo/mirror/credentials) let the
    session read. Measured 2026-08-21 on the real `parens` fixture with the real
    jail and seal: the session read its own answer key, baked the admitted case
    names into `src/`, registered them as trivial passing tests and truncated —
    honest 0/3 became a sealed, unblocked 3/3. Every rep shares $RUNS, so rep 1's
    file was readable by rep 2 as well.

    Fencing the file was not enough (that is what the `__PIN__` read-deny already
    did for the graded RE-RUN, not for the session). So the secret no longer exists
    on disk: real_gate's row builder calls this in-process, straight from the
    admission-hashed manifest under `__HARNESS__`, which is read-denied to both the
    session and the graded re-run.
    """
    _, manifest = load_manifest(task)
    f2p = manifest.get("tests", {}).get("fail_to_pass", {})
    return {
        # The fail-to-pass grader overlaid at grade time. This is the RAW overlay
        # source, not withheld_grader's scoped answer: the gate copies its BASENAME
        # into the workdir's test/ and the row builder needs that name to check
        # registration provenance, and t4 is hidden by an explicit gate branch its
        # path cannot express. Naming the withheld grader is itself a leak, which is
        # why this lives here and not in the on-disk row context.
        "hidden_test": (f2p.get("overlays") or [{}])[0].get("source"),
        # The grader artifact the gate is allowed to read, pinned by the (admission-hashed)
        # manifest. None for the fixtures that emit no graded subscores. See grade_artifact.py.
        "grade_artifact": f2p.get("grade_artifact"),
        # Admitted top-level case names for the reporter grader, hashed into the
        # approved manifest. grade_reporter refuses any observed set that differs —
        # the primary defense against a mid-run process.exit truncation forgery.
        "expected_cases": f2p.get("expected_cases"),
        # Parent-owned v3 grading metadata: leaks the same hidden case names.
        "requirement_scoring": requirement_scoring(manifest),
    }


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="command", required=True)
    state = sub.add_parser("state"); state.add_argument("task")
    prompt = sub.add_parser("prompt"); prompt.add_argument("task"); prompt.add_argument("--variant", default="canonical")
    row = sub.add_parser("row-context"); row.add_argument("task"); row.add_argument("--variant", default="canonical"); row.add_argument("--exploratory", action="store_true")
    fixture_root = sub.add_parser("fixture-root"); fixture_root.add_argument("task")
    hidden_test = sub.add_parser("hidden-test"); hidden_test.add_argument("task")
    grade_artifact = sub.add_parser("grade-artifact"); grade_artifact.add_argument("task")
    args = ap.parse_args()
    if args.command == "state":
        _, manifest = load_manifest(args.task); ok, why = authoritative(manifest)
        print(json.dumps({"authoritative": ok, "reason": why})); raise SystemExit(0 if ok else 1)
    if args.command == "fixture-root":
        _, manifest = load_manifest(args.task); print(manifest["fixture"]["root"])
    elif args.command == "hidden-test":
        _, manifest = load_manifest(args.task)
        print(withheld_grader(manifest) or "")
    elif args.command == "grade-artifact":
        print(grading_secrets(args.task)["grade_artifact"] or "")
    elif args.command == "prompt":
        _, manifest = load_manifest(args.task); print(prompt_record(manifest, args.variant)["text"])
    else:
        print(json.dumps(row_context(args.task, args.variant, args.exploratory), sort_keys=True))


if __name__ == "__main__":
    main()
