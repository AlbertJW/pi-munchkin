#!/usr/bin/env python3
"""Build a private pi.failure-episode-study/v1 manifest for the staged semantic-loop trial.

Computes the six identity hashes the manifest must bind (see
docs/PREREG_SEMANTIC_LOOP_SCREEN_2026-08.md §8) and writes the manifest to an
operator-named path OUTSIDE the repository, then round-trips it through
failure_episode_trial.load_manifest as its own acceptance check.

Privacy: the live models.json is hashed from bytes and never printed, logged, or
embedded; the output contains names and hashes only (load_manifest independently
refuses paths/endpoints/credentials in the serialized manifest).

Usage:
  python3 make_episode_manifest.py --out /path/outside/repo/PRIVATE_MANIFEST.json \
      [--name NAME] [--model ID] [--fixtures a,b,...] [--seed N]
  python3 make_episode_manifest.py --selftest
"""
import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

# Defaults are the prereg's declared study; every one is operator-overridable.
DEFAULT_NAME = "semantic-loop-screen-2026-08"
DEFAULT_MODEL = "qwopus35-4b"
DEFAULT_FIXTURES = [
    "sweep-b", "sweep-c", "ling-exact-gate-recovery", "ling-partial-order-release",
    "audit-sweep",
]
BASE_CONFIG = os.path.join(HERE, "configs", "baseline.json")
CAND_CONFIG = os.path.join(HERE, "configs", "pending", "semantic-loop-enforce.json")


def sha256_file(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def loaded_surface_sha256(agent_dir):
    out = subprocess.run(
        ["node", "--experimental-strip-types",
         os.path.join(REPO, "harness", "scripts", "surface-hash.ts"), agent_dir],
        capture_output=True, text=True, check=True,
    ).stdout.strip().splitlines()
    digest = out[-1].strip()
    if not (len(digest) == 64 and all(c in "0123456789abcdef" for c in digest)):
        raise SystemExit("surface-hash.ts did not print a 64-hex digest")
    return digest


def rendered_governor_sha256():
    sys.path.insert(0, HERE)
    import config as prompt_config  # optimizer/prompt-lab/config.py
    digests = set()
    for path in (BASE_CONFIG, CAND_CONFIG):
        text = prompt_config.render_prompt(json.load(open(path)))
        digests.add(hashlib.sha256(text.encode("utf-8")).hexdigest())
    if len(digests) != 1:
        raise SystemExit(
            "base and candidate configs render different governors; the manifest holds ONE "
            "rendered_governor_sha256 checked against both arms — fix the configs first")
    return digests.pop()


def build(args):
    agent_dir = os.environ.get("PI_CODING_AGENT_DIR", os.path.expanduser("~/.pi/agent"))
    manifest = {
        "schema": "pi.failure-episode-study/v1",
        "name": args.name,
        "model": args.model,
        "fixtures": args.fixtures,
        "surface_sha256": loaded_surface_sha256(agent_dir),
        "model_registry_sha256": sha256_file(os.path.join(agent_dir, "models.json")),
        "control_config_sha256": sha256_file(BASE_CONFIG),
        "candidate_config_sha256": sha256_file(CAND_CONFIG),
        "rendered_governor_sha256": rendered_governor_sha256(),
        "seed": args.seed if args.seed is not None else secrets.randbits(32),
    }
    return manifest


def write_and_check(manifest, out_path):
    out_real = os.path.realpath(out_path)
    if out_real.startswith(os.path.realpath(REPO) + os.sep):
        raise SystemExit("refusing to write the private manifest inside the repository")
    with open(out_real, "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
        f.write("\n")
    os.chmod(out_real, 0o600)
    sys.path.insert(0, HERE)
    import pathlib

    import failure_episode_trial
    accepted = failure_episode_trial.load_manifest(pathlib.Path(out_real))
    # load_manifest returns the manifest plus derived manifest_path/manifest_sha256
    if {k: accepted[k] for k in manifest} != manifest or "manifest_sha256" not in accepted:
        raise SystemExit("round-trip mismatch: load_manifest returned a different manifest")


def selftest():
    # Hermetic: no ~/.pi/agent, no live governor, no node — CI runners have none
    # of them. The two live probes are stubbed; everything else runs for real.
    import tempfile
    global loaded_surface_sha256
    sys.path.insert(0, HERE)
    import config as prompt_config
    orig_surface, orig_gov = loaded_surface_sha256, prompt_config.LIVE_GOV
    orig_agent_dir = os.environ.get("PI_CODING_AGENT_DIR")
    with tempfile.TemporaryDirectory() as td:
        agent_dir = os.path.join(td, "agent")
        os.makedirs(agent_dir)
        with open(os.path.join(agent_dir, "models.json"), "w") as f:
            f.write("{}\n")
        gov = os.path.join(td, "APPEND_SYSTEM.md")
        with open(gov, "w") as f:
            f.write("RULE: selftest governor.\n")
        os.environ["PI_CODING_AGENT_DIR"] = agent_dir
        loaded_surface_sha256 = lambda _dir: "e" * 64
        prompt_config.LIVE_GOV = gov
        try:
            ns = argparse.Namespace(name=DEFAULT_NAME, model=DEFAULT_MODEL,
                                    fixtures=list(DEFAULT_FIXTURES), seed=7)
            manifest = build(ns)
        finally:
            loaded_surface_sha256 = orig_surface
            prompt_config.LIVE_GOV = orig_gov
            if orig_agent_dir is None:
                os.environ.pop("PI_CODING_AGENT_DIR", None)
            else:
                os.environ["PI_CODING_AGENT_DIR"] = orig_agent_dir
        for field in ("surface_sha256", "model_registry_sha256", "control_config_sha256",
                      "candidate_config_sha256", "rendered_governor_sha256"):
            assert len(manifest[field]) == 64, field
        out = os.path.join(td, "m.json")
        write_and_check(manifest, out)
        assert (os.stat(out).st_mode & 0o777) == 0o600
        # in-repo write must be refused
        try:
            write_and_check(manifest, os.path.join(REPO, "m.json"))
        except SystemExit as exc:
            assert "inside the repository" in str(exc)
        else:
            raise AssertionError("in-repo manifest write was not refused")
    print("make_episode_manifest selftest: OK (hashes, round-trip, in-repo refusal, 0600)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", help="path OUTSIDE the repo for the private manifest")
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--fixtures", default=",".join(DEFAULT_FIXTURES),
                        help="comma-separated fixture names")
    parser.add_argument("--seed", type=int, default=None,
                        help="study seed (default: fresh random 32-bit)")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    if not args.out:
        raise SystemExit("--out is required (choose a path outside the repository)")
    args.fixtures = [f for f in args.fixtures.split(",") if f]
    manifest = build(args)
    write_and_check(manifest, args.out)
    for key in ("surface_sha256", "model_registry_sha256", "control_config_sha256",
                "candidate_config_sha256", "rendered_governor_sha256"):
        print(f"{key}={manifest[key]}")
    print(f"seed={manifest['seed']}")
    print(f"manifest written (0600): {args.out}")


if __name__ == "__main__":
    main()
