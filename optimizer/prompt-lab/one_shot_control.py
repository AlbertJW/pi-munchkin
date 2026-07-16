#!/usr/bin/env python3
"""True no-harness control: one request, one safe patch application, one grader."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath

from eval_fixture import prompt_record
from fixture_admission import install_overlays, load_manifest, safe_root, stage

MAX_BYTES = 48 * 1024


class ControlError(RuntimeError): pass


def context_pack(manifest, work):
    if not manifest["one_shot"]["eligible"]:
        raise ControlError("fixture is ineligible for one-shot control")
    blocks = []
    total = 0
    for relative in manifest["one_shot"]["context_files"]:
        path = work / relative
        if not path.is_file():
            raise ControlError(f"allowlisted context file missing: {relative}")
        data = path.read_bytes(); total += len(data)
        if total > min(MAX_BYTES, manifest["one_shot"].get("max_context_bytes", MAX_BYTES)):
            raise ControlError("allowlisted context pack exceeds 48 KiB")
        blocks.append(f"--- FILE: {relative} ---\n{data.decode('utf-8')}\n")
    return "\n".join(blocks), total


def request_once(endpoint, model, user_prompt, timeout=600):
    body = {"model": model, "messages": [{"role": "user", "content": user_prompt}],
            "temperature": 0, "n": 1}
    headers = {"Content-Type": "application/json"}
    if os.environ.get("LLAMA_API_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["LLAMA_API_KEY"]
    req = urllib.request.Request(endpoint.rstrip("/") + "/v1/chat/completions",
                                 data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def extract_diff(text):
    match = re.search(r"```(?:diff)?\s*\n(.*?)```", text, re.S)
    return match.group(1) if match else text


def validate_diff(diff):
    if "GIT binary patch" in diff or "Binary files " in diff:
        raise ControlError("binary patch rejected")
    paths = []
    for marker, raw in re.findall(r"^(---|\+\+\+)\s+([^\t\n]+)", diff, re.M):
        if raw == "/dev/null": continue
        raw = raw[2:] if raw.startswith(("a/", "b/")) else raw
        path = PurePosixPath(raw)
        if path.is_absolute() or ".." in path.parts:
            raise ControlError("absolute/traversal patch path rejected")
        lowered = [x.lower() for x in path.parts]
        if any(x in ("test", "tests", ".git", "grader", "graders") for x in lowered):
            raise ControlError("test/grader/repository tampering rejected")
        if not path.parts or path.parts[0] != "src":
            raise ControlError(f"one-shot patch may modify src/ only: {path}")
        paths.append(str(path))
    if not paths or not diff.lstrip().startswith("---"):
        raise ControlError("response is not a unified diff")
    return sorted(set(paths))


def apply_once(work, diff):
    validate_diff(diff)
    patch = work / ".one-shot.patch"; patch.write_text(diff, encoding="utf-8")
    dry = subprocess.run(["patch", "-p1", "--batch", "--dry-run", "-i", str(patch)], cwd=work, capture_output=True, text=True)
    if dry.returncode:
        raise ControlError("patch dry-run failed: " + (dry.stdout + dry.stderr)[-1000:])
    real = subprocess.run(["patch", "-p1", "--batch", "-i", str(patch)], cwd=work, capture_output=True, text=True)
    if real.returncode:
        raise ControlError("patch application failed after dry-run")


def grade(manifest, work):
    # Same external contract as admission/real_gate: pristine P2P plus withheld F2P.
    install_overlays(work, manifest["tests"]["pass_to_pass"].get("overlays", []))
    install_overlays(work, manifest["tests"]["fail_to_pass"].get("overlays", []))
    p2p = subprocess.run(["node", "--test"], cwd=work, capture_output=True, text=True, timeout=60)
    f2p = subprocess.run(manifest["tests"]["fail_to_pass"]["command"], cwd=work, capture_output=True, text=True, timeout=60)
    return p2p.returncode == 0 and f2p.returncode == 0, (p2p.stdout + p2p.stderr + f2p.stdout + f2p.stderr)[-2000:]


def run(task, variant, endpoint, model, output=None, mock_response=None):
    _, manifest = load_manifest(task)
    with tempfile.TemporaryDirectory(prefix=f"pi-one-shot-{task}-") as td:
        work = stage(manifest, Path(td))
        context, context_bytes = context_pack(manifest, work)
        prompt = prompt_record(manifest, variant)
        user = (prompt["text"] + "\n\nReturn only a unified diff. You may modify source files only.\n\n" + context)
        response = json.loads(Path(mock_response).read_text()) if mock_response else request_once(endpoint, model, user)
        content = response["choices"][0]["message"]["content"]
        error = None; score = 0; grader_tail = ""
        try:
            apply_once(work, extract_diff(content)); score, grader_tail = grade(manifest, work)
        except ControlError as exc:
            error = str(exc)
        usage = response.get("usage") or {}
        exact = all(isinstance(usage.get(k), int) and usage[k] > 0 for k in ("prompt_tokens", "completion_tokens"))
        result = {"task": task, "variant": variant, "prompt_sha256": prompt["sha256"], "requests": 1,
                  "context_bytes": context_bytes, "score": int(score), "error": error,
                  "grader_tail": grader_tail, "usage": {"source": "provider" if exact else "char_proxy",
                  "exact": exact, "input_tokens": usage.get("prompt_tokens") if exact else None,
                  "output_tokens": usage.get("completion_tokens") if exact else None,
                  "output_chars": len(content)}}
        if output: Path(output).write_text(json.dumps(result, indent=2) + "\n")
        return result


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("task"); ap.add_argument("--variant", default="canonical")
    ap.add_argument("--endpoint", required=True); ap.add_argument("--model", required=True); ap.add_argument("--output")
    ap.add_argument("--mock-response")
    args = ap.parse_args()
    try: result = run(args.task, args.variant, args.endpoint, args.model, args.output, args.mock_response)
    except ControlError as exc: raise SystemExit(f"one_shot_control: {exc}")
    print(json.dumps(result, sort_keys=True)); raise SystemExit(0 if result["score"] else 1)


if __name__ == "__main__": main()
