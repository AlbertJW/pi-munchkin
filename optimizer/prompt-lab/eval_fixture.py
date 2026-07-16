#!/usr/bin/env python3
"""Small manifest query interface shared by shell runners and reports."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from fixture_admission import MANIFESTS, authoritative, load_manifest


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
    }


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="command", required=True)
    state = sub.add_parser("state"); state.add_argument("task")
    prompt = sub.add_parser("prompt"); prompt.add_argument("task"); prompt.add_argument("--variant", default="canonical")
    row = sub.add_parser("row-context"); row.add_argument("task"); row.add_argument("--variant", default="canonical"); row.add_argument("--exploratory", action="store_true")
    args = ap.parse_args()
    if args.command == "state":
        _, manifest = load_manifest(args.task); ok, why = authoritative(manifest)
        print(json.dumps({"authoritative": ok, "reason": why})); raise SystemExit(0 if ok else 1)
    if args.command == "prompt":
        _, manifest = load_manifest(args.task); print(prompt_record(manifest, args.variant)["text"])
    else:
        print(json.dumps(row_context(args.task, args.variant, args.exploratory), sort_keys=True))


if __name__ == "__main__":
    main()
