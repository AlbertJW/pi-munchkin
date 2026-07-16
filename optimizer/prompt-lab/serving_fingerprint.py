#!/usr/bin/env python3
"""Capture a stable, comparison-grade serving fingerprint for each eval row."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import tempfile
import urllib.request
import urllib.parse
from pathlib import Path

SCHEMA = "pi.serving-fingerprint/v1"
CACHE = Path(os.environ.get("PI_FINGERPRINT_CACHE", "~/.cache/pi-eval/model-hashes.json")).expanduser()

REQUIRED_PATHS = (
    "model", "requested_model", "loaded_model", "gguf.basename", "gguf.size", "gguf.sha256",
    "llama_cpp.build_info", "llama_cpp.commit", "chat_template_sha256", "router.type",
    "router.config_sha256", "context_size", "cache.key_type", "cache.value_type", "cache.ram",
    "mtp.type", "mtp.depth", "mtp.threshold", "decoding.temperature", "decoding.top_p",
    "decoding.top_k", "decoding.min_p", "decoding.repeat_penalty", "decoding.presence_penalty",
    "decoding.reasoning", "decoding.reasoning_budget", "decoding.seed", "launch_flags_sha256",
)


def contract_missing(data):
    missing = []
    for dotted in REQUIRED_PATHS:
        value = data
        for key in dotted.split("."):
            value = value.get(key) if isinstance(value, dict) else None
        if value is None or value == "":
            missing.append(dotted)
    return missing


def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()


def digest_json(data):
    return digest_bytes(json.dumps(data, sort_keys=True, separators=(",", ":")).encode())


def load_cache():
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def file_sha(path):
    path = Path(path).resolve(); st = path.stat()
    key = f"{path}|{st.st_size}|{st.st_mtime_ns}"
    cache = load_cache()
    if key not in cache:
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for block in iter(lambda: fh.read(8 * 1024 * 1024), b""):
                h.update(block)
        cache[key] = h.hexdigest()
        if len(cache) > 32:
            cache = dict(list(cache.items())[-32:])
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", dir=CACHE.parent, delete=False) as fh:
            json.dump(cache, fh); tmp = fh.name
        os.replace(tmp, CACHE)
    return cache[key], st


def fetch_json(url, timeout=3):
    key = os.environ.get("LLAMA_API_KEY")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"} if key else {})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def process_rows():
    text = subprocess.check_output(["ps", "-axo", "pid=,command="], text=True)
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        pid, _, command = line.partition(" ")
        try:
            argv = shlex.split(command)
        except ValueError:
            argv = command.split()
        rows.append((int(pid), argv, command))
    return rows


def flag(argv, *names):
    for i, item in enumerate(argv):
        for name in names:
            if item == name and i + 1 < len(argv):
                return argv[i + 1]
            if item.startswith(name + "="):
                return item.split("=", 1)[1]
    return None


def as_number(value):
    if value is None:
        return None
    try:
        return float(value) if "." in str(value) else int(value)
    except ValueError:
        return value


def normalize_flags(argv):
    # Executable path is intentionally retained. Whitespace and process-rendering
    # differences are removed; secrets following API-key flags are redacted.
    redacted = []
    secret_next = False
    for token in argv:
        if secret_next:
            redacted.append("<redacted>"); secret_next = False; continue
        redacted.append(token)
        if token in ("--api-key", "--api-key-file"):
            secret_next = True
    return redacted


def remote_document(model):
    source = os.environ.get("SERVING_FINGERPRINT_FILE")
    url = os.environ.get("SERVING_FINGERPRINT_URL")
    try:
        data = json.loads(Path(source).read_text(encoding="utf-8")) if source else fetch_json(url) if url else {}
    except Exception as exc:
        data = {"error": str(exc)}
    data.setdefault("schema", SCHEMA); data.setdefault("model", model)
    missing = list(data.get("missing") or []) + contract_missing(data)
    data["missing"] = sorted(set(missing))
    data["status"] = "complete" if not missing else "incomplete"
    core = {k: v for k, v in data.items() if k != "fingerprint_sha256"}
    data["fingerprint_sha256"] = digest_json(core)
    return data


def capture(endpoint, model):
    if os.environ.get("SERVING_FINGERPRINT_FILE") or os.environ.get("SERVING_FINGERPRINT_URL"):
        return remote_document(model)
    host = urllib.parse.urlparse(endpoint).hostname
    if host not in ("127.0.0.1", "localhost", "::1"):
        return remote_document(model)
    missing = []
    try:
        models = fetch_json(endpoint.rstrip("/") + "/v1/models")
    except Exception:
        models = {}; missing.append("/v1/models")
    rows = process_rows()
    backend = None
    for _, argv, _ in rows:
        exe = Path(argv[0]).name if argv else ""
        if "llama-server" not in exe:
            continue
        alias = flag(argv, "--alias")
        if alias == model or (not backend and flag(argv, "-m", "--model")):
            backend = argv
            if alias == model:
                break
    props = {}
    if backend:
        port = flag(backend, "--port")
        try:
            props = fetch_json(f"http://127.0.0.1:{port}/props") if port else {}
        except Exception:
            missing.append("backend /props")
    else:
        missing.append("loaded llama-server process")
        backend = []

    model_path = flag(backend, "-m", "--model") or props.get("model_path")
    gguf = {"basename": Path(model_path).name if model_path else None, "size": None, "sha256": None}
    if model_path and Path(model_path).is_file():
        model_hash, st = file_sha(model_path); gguf.update(size=st.st_size, sha256=model_hash)
    else:
        missing.append("GGUF path/hash")

    router = {"type": None, "config_sha256": None}
    for _, argv, _ in rows:
        if argv and "llama-swap" in Path(argv[0]).name:
            router["type"] = "llama-swap"
            config = flag(argv, "--config")
            if config and Path(config).is_file():
                router["config_sha256"] = file_sha(config)[0]
            else:
                missing.append("router config")
            break
    if not router["type"]:
        router["type"] = "direct"
        router["config_sha256"] = digest_json({"type": "direct"})

    settings = (props.get("default_generation_settings") or {})
    params = settings.get("params") or {}
    template = props.get("chat_template")
    build = props.get("build_info")
    commit = None
    if build:
        match = re.search(r"-([0-9a-f]{7,40})(?:\b|$)", build)
        commit = match.group(1) if match else None
    decoding = {
        "temperature": params.get("temperature", as_number(flag(backend, "--temp"))),
        "top_p": params.get("top_p", as_number(flag(backend, "--top-p"))),
        "top_k": params.get("top_k", as_number(flag(backend, "--top-k"))),
        "min_p": params.get("min_p", as_number(flag(backend, "--min-p"))),
        "repeat_penalty": params.get("repeat_penalty", as_number(flag(backend, "--repeat-penalty"))),
        "presence_penalty": params.get("presence_penalty", as_number(flag(backend, "--presence-penalty"))),
        "reasoning": flag(backend, "--reasoning-format", "--reasoning") or "backend-default",
        "reasoning_budget": as_number(flag(backend, "--reasoning-budget")) or "backend-default",
        "seed": params.get("seed", as_number(flag(backend, "--seed"))),
    }
    required_decoding = ("temperature", "top_p", "top_k", "min_p", "repeat_penalty", "presence_penalty", "seed")
    missing += [f"decoding.{key}" for key in required_decoding if decoding[key] is None]
    fingerprint = {
        "schema": SCHEMA,
        "status": "complete" if not missing else "incomplete",
        "missing": sorted(set(missing)),
        "model": model,
        "requested_model": model,
        "loaded_model": props.get("model_alias") or props.get("model_path"),
        "loaded_models": sorted(str(x.get("id")) for x in models.get("data", []) if x.get("id")),
        "gguf": gguf,
        "llama_cpp": {"build_info": build, "commit": commit},
        "chat_template_sha256": digest_bytes(template.encode()) if isinstance(template, str) else None,
        "router": router,
        "context_size": settings.get("n_ctx", as_number(flag(backend, "-c", "--ctx-size"))),
        "cache": {"key_type": flag(backend, "--cache-type-k") or "backend-default",
                  "value_type": flag(backend, "--cache-type-v") or "backend-default",
                  "ram": flag(backend, "--cache-ram") or "backend-default"},
        "mtp": {"type": flag(backend, "--spec-type") or "disabled",
                "depth": as_number(flag(backend, "--draft-max", "--draft-n")) or (0 if not flag(backend, "--spec-type") else "backend-default"),
                "threshold": as_number(flag(backend, "--draft-p-min", "--draft-p")) or (0 if not flag(backend, "--spec-type") else "backend-default")},
        "decoding": decoding,
        "launch_flags_sha256": digest_json(normalize_flags(backend)) if backend else None,
    }
    fingerprint["missing"] = sorted(set(fingerprint["missing"] + contract_missing(fingerprint)))
    fingerprint["status"] = "complete" if not fingerprint["missing"] else "incomplete"
    core = dict(fingerprint)
    fingerprint["fingerprint_sha256"] = digest_json(core)
    return fingerprint


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="command", required=True)
    cap = sub.add_parser("capture"); cap.add_argument("--endpoint", required=True); cap.add_argument("--model", required=True); cap.add_argument("--output")
    cmp = sub.add_parser("compare"); cmp.add_argument("pre"); cmp.add_argument("post")
    args = ap.parse_args()
    if args.command == "capture":
        data = capture(args.endpoint, args.model); text = json.dumps(data, indent=2, sort_keys=True) + "\n"
        if args.output: Path(args.output).write_text(text, encoding="utf-8")
        else: print(text, end="")
    else:
        pre = json.loads(Path(args.pre).read_text()); post = json.loads(Path(args.post).read_text())
        same = pre.get("fingerprint_sha256") == post.get("fingerprint_sha256")
        complete = pre.get("status") == post.get("status") == "complete"
        print(json.dumps({"stable": same, "complete": complete})); raise SystemExit(0 if same and complete else 1)


if __name__ == "__main__":
    main()
