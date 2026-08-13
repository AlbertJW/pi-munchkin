#!/usr/bin/env python3
"""Capture a stable, comparison-grade serving fingerprint for each eval row."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shlex
import subprocess
import tempfile
import urllib.request
import urllib.parse
from pathlib import Path

LEGACY_SCHEMA = "pi.serving-fingerprint/v1"
SCHEMA = "pi.serving-fingerprint/v2"
CACHE = Path(os.environ.get("PI_FINGERPRINT_CACHE", "~/.cache/pi-eval/model-hashes.json")).expanduser()
HELPER_MAX_BYTES = 64 * 1024

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


def safe_component(value):
    if not isinstance(value, str):
        return None
    value = Path(value).name
    return value[:160] if re.fullmatch(r"[A-Za-z0-9._@+:-]{1,160}", value) else None


def safe_model_id(value):
    if not isinstance(value, str) or len(value) > 200 or value.startswith(("/", ".")) or ".." in value:
        return None
    return value if re.fullmatch(r"[A-Za-z0-9._@+:/-]{1,200}", value) else None


def safe_scalar(value):
    if value is None:
        return True
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(value) and abs(value) <= 2**63 - 1
    return isinstance(value, str) and safe_component(value) == value


def performance_from_argv(argv):
    def resolved(*names, default="backend-default"):
        value = flag(argv, *names)
        return as_number(value) if value is not None else default
    tensor_split = flag(argv, "--tensor-split")
    return {
        "threads": resolved("-t", "--threads"),
        "batch_size": resolved("-b", "--batch-size"),
        "ubatch_size": resolved("-ub", "--ubatch-size"),
        "parallel_slots": resolved("-np", "--parallel"),
        "gpu_layers": resolved("-ngl", "--n-gpu-layers"),
        "split_mode": safe_component(flag(argv, "--split-mode")) or "backend-default",
        "tensor_split_sha256": digest_bytes(tensor_split.encode()) if tensor_split else None,
    }


def _v2_core(legacy):
    runtime = legacy.get("llama_cpp") or {}
    artifact = legacy.get("gguf") or {}
    semantic = {
        "model_id": safe_model_id(legacy.get("model")),
        "artifact": {
            "basename": safe_component(artifact.get("basename")),
            "size": artifact.get("size"),
            "sha256": artifact.get("sha256"),
        },
        "runtime": {
            "family": safe_component(legacy.get("runtime")) or "llama.cpp",
            "build_sha256": digest_json(runtime.get("build_info")) if runtime.get("build_info") else None,
            "commit": safe_component(runtime.get("commit")),
        },
        "chat_template_sha256": legacy.get("chat_template_sha256"),
        "router": legacy.get("router") or {"type": None, "config_sha256": None},
        "context_size": legacy.get("context_size"),
        "max_tokens": (legacy.get("generation") or {}).get("max_tokens", "backend-default"),
        "cache": legacy.get("cache") or {"key_type": None, "value_type": None, "ram": None},
        "speculative": legacy.get("mtp") or {"type": None, "depth": None, "threshold": None},
        "decoding": legacy.get("decoding") or {
            "temperature": None, "top_p": None, "top_k": None, "min_p": None,
            "repeat_penalty": None, "presence_penalty": None, "reasoning": None,
            "reasoning_budget": None, "seed": None,
        },
        "launch_flags_sha256": legacy.get("launch_flags_sha256"),
    }
    performance = legacy.get("performance") or {
        "threads": None, "batch_size": None, "ubatch_size": None, "parallel_slots": None,
        "gpu_layers": None, "split_mode": None, "tensor_split_sha256": None,
    }
    return semantic, performance


def upgrade_v2(legacy):
    if legacy.get("schema") == SCHEMA:
        return validate_v2(legacy)
    semantic, performance = _v2_core(legacy)
    missing = list(legacy.get("missing") or [])
    required_hashes = (
        semantic["artifact"].get("sha256"), semantic["runtime"].get("build_sha256"),
        semantic.get("chat_template_sha256"), semantic.get("context_size"),
        semantic.get("launch_flags_sha256"),
    )
    if any(value in (None, "") for value in required_hashes):
        missing.append("semantic identity")
    if not legacy.get("performance"):
        missing.append("performance identity")
    core = {"schema": SCHEMA, "model": safe_model_id(legacy.get("model")),
            "semantic": semantic, "performance": performance}
    result = {
        **core,
        "semantic_sha256": digest_json(semantic),
        "performance_sha256": digest_json(performance),
        "full_sha256": digest_json(core),
        "missing": sorted(set(str(item)[:120] for item in missing if item)),
    }
    result["fingerprint_sha256"] = result["full_sha256"]
    result["status"] = "complete" if not result["missing"] else "incomplete"
    return validate_v2(result)


def validate_v2(data):
    if not isinstance(data, dict):
        raise ValueError("fingerprint helper returned a non-object")
    allowed = {"schema", "status", "model", "semantic", "performance", "semantic_sha256",
               "performance_sha256", "full_sha256", "fingerprint_sha256", "missing"}
    if set(data) != allowed or data.get("schema") != SCHEMA:
        raise ValueError("fingerprint v2 has an invalid top-level shape")
    if data.get("status") not in ("complete", "incomplete"):
        raise ValueError("fingerprint v2 has an invalid status")
    for field in ("semantic_sha256", "performance_sha256", "full_sha256", "fingerprint_sha256"):
        if not isinstance(data.get(field), str) or not re.fullmatch(r"[0-9a-f]{64}", data[field]):
            raise ValueError(f"fingerprint v2 has an invalid {field}")
    if data["fingerprint_sha256"] != data["full_sha256"]:
        raise ValueError("fingerprint v2 compatibility hash disagrees with full hash")
    if not isinstance(data.get("semantic"), dict) or not isinstance(data.get("performance"), dict):
        raise ValueError("fingerprint v2 identity groups must be objects")
    semantic = data["semantic"]
    expected_semantic = {"model_id", "artifact", "runtime", "chat_template_sha256", "router",
                         "context_size", "max_tokens", "cache", "speculative", "decoding",
                         "launch_flags_sha256"}
    expected_performance = {"threads", "batch_size", "ubatch_size", "parallel_slots", "gpu_layers",
                            "split_mode", "tensor_split_sha256"}
    if set(semantic) != expected_semantic or set(data["performance"]) != expected_performance:
        raise ValueError("fingerprint v2 has an invalid identity-group shape")
    nested_shapes = {
        "artifact": {"basename", "size", "sha256"},
        "runtime": {"family", "build_sha256", "commit"},
        "router": {"type", "config_sha256"},
        "cache": {"key_type", "value_type", "ram"},
        "speculative": {"type", "depth", "threshold"},
        "decoding": {"temperature", "top_p", "top_k", "min_p", "repeat_penalty", "presence_penalty",
                     "reasoning", "reasoning_budget", "seed"},
    }
    for field, keys in nested_shapes.items():
        if not isinstance(semantic.get(field), dict) or set(semantic[field]) != keys:
            raise ValueError(f"fingerprint v2 has an invalid semantic.{field} shape")
    primitive_values = list(data["performance"].values())
    primitive_values += [semantic.get("chat_template_sha256"), semantic.get("context_size"),
                         semantic.get("max_tokens"), semantic.get("launch_flags_sha256")]
    for field in nested_shapes:
        primitive_values += list(semantic[field].values())
    if any(not safe_scalar(value) for value in primitive_values):
        raise ValueError("fingerprint v2 identity values must be bounded safe scalars")
    if safe_model_id(data.get("model")) != data.get("model") or semantic.get("model_id") != data.get("model"):
        raise ValueError("fingerprint v2 model identity is invalid")
    if (not isinstance(data.get("missing"), list) or
            any(not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9_. -]{1,120}", item) for item in data["missing"])):
        raise ValueError("fingerprint v2 missing list is invalid")
    if (data["status"] == "complete") != (len(data["missing"]) == 0):
        raise ValueError("fingerprint v2 status disagrees with missing identity fields")
    for value in (semantic["artifact"]["basename"], semantic["runtime"]["family"], semantic["runtime"]["commit"],
                  semantic["router"]["type"], semantic["cache"]["key_type"], semantic["cache"]["value_type"],
                  semantic["cache"]["ram"], semantic["speculative"]["type"], data["performance"]["split_mode"]):
        if value is not None and safe_component(value) != value:
            raise ValueError("fingerprint v2 contains an unsafe identity component")
    for field in ("sha256",):
        value = semantic["artifact"][field]
        if value is not None and (not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)):
            raise ValueError("fingerprint v2 artifact digest is invalid")
    if (semantic["artifact"]["size"] is not None and
            (not isinstance(semantic["artifact"]["size"], int) or isinstance(semantic["artifact"]["size"], bool) or
             semantic["artifact"]["size"] < 0)):
        raise ValueError("fingerprint v2 artifact size is invalid")
    for value in (semantic["runtime"]["build_sha256"], semantic["chat_template_sha256"],
                  semantic["router"]["config_sha256"], semantic["launch_flags_sha256"],
                  data["performance"]["tensor_split_sha256"]):
        if value is not None and (not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)):
            raise ValueError("fingerprint v2 component digest is invalid")
    semantic_hash = digest_json(data["semantic"])
    performance_hash = digest_json(data["performance"])
    core = {"schema": SCHEMA, "model": data.get("model"), "semantic": data["semantic"], "performance": data["performance"]}
    if data["semantic_sha256"] != semantic_hash or data["performance_sha256"] != performance_hash or data["full_sha256"] != digest_json(core):
        raise ValueError("fingerprint v2 digest does not match its canonical identity")
    serialized = json.dumps(data, sort_keys=True)
    if re.search(r"(?:https?://|(?:^|[\" ])/(?:Users|home|opt|var|private|etc|srv)/|Bearer |api[_-]?key)", serialized, re.I):
        raise ValueError("fingerprint v2 contains a forbidden endpoint, path, or credential marker")
    return data


def helper_document(model):
    helper = os.environ.get("SERVING_FINGERPRINT_HELPER")
    if not helper:
        return None
    path = Path(helper)
    if not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError("SERVING_FINGERPRINT_HELPER must be an absolute executable file")
    env = {key: os.environ[key] for key in ("HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "SSH_AUTH_SOCK") if key in os.environ}
    with tempfile.TemporaryFile() as output:
        completed = subprocess.run([str(path), "--model", model], stdout=output,
                                   stderr=subprocess.DEVNULL, timeout=20, env=env, check=False)
        size = output.tell()
        if completed.returncode != 0 or size > HELPER_MAX_BYTES:
            raise ValueError("serving fingerprint helper failed")
        output.seek(0); payload = output.read(HELPER_MAX_BYTES + 1)
    try:
        return validate_v2(json.loads(payload))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("serving fingerprint helper returned invalid JSON") from exc


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
    if data.get("schema") == SCHEMA:
        return validate_v2(data)
    data.setdefault("schema", LEGACY_SCHEMA); data.setdefault("model", model)
    missing = list(data.get("missing") or []) + contract_missing(data)
    data["missing"] = sorted(set(missing))
    data["status"] = "complete" if not missing else "incomplete"
    core = {k: v for k, v in data.items() if k != "fingerprint_sha256"}
    data["fingerprint_sha256"] = digest_json(core)
    return data


def mlx_runtime_version(pid):
    """mlx-lm version of the RUNNING server, via the site-packages it actually has
    open (lsof). argv[0] is useless here: ps shows the resolved framework binary,
    not the venv shim, so the venv is not recoverable from the command line
    (measured on .venv-mlx / macOS). No code execution; read-only lsof + glob."""
    try:
        text = subprocess.check_output(["lsof", "-p", str(pid), "-Fn"], text=True,
                                       stderr=subprocess.DEVNULL, timeout=10)
    except (subprocess.SubprocessError, OSError):
        return None
    for line in text.splitlines():
        if line.startswith("n") and "/site-packages/" in line:
            sp = Path(line[1:].split("/site-packages/")[0] + "/site-packages")
            for info in sp.glob("mlx_lm-*.dist-info"):
                return info.name.removeprefix("mlx_lm-").removesuffix(".dist-info")
    return None


def mlx_fingerprint(backend, model, models, pid=None):
    """Fingerprint an `mlx_lm server` backend into the SAME schema/contract as the
    llama.cpp path, so pre/post stability and row authority work identically.

    Field mapping is honest, not cosmetic:
      gguf.*            -> the MLX model DIRECTORY: combined sha256 over config,
                           tokenizer config, in-checkpoint model code (*.py) and every
                           weight shard (all via the cached file_sha), total weight bytes
      llama_cpp.*       -> runtime identity (key name kept for schema stability):
                           build_info "mlx-lm==X", commit "pypi:X" — wheels carry no git
      chat_template     -> tokenizer_config.json chat_template (or chat_template.jinja)
      context_size      -> config.json max_position_embeddings
      cache/mtp         -> the same "backend-default"/"disabled" idiom the llama path
                           uses for absent flags (no KV-type or speculative flags exist)
      decoding          -> from the server argv; repeat/presence penalty and seed are
                           recorded at mlx_lm.server's effective defaults (1.0 / 0.0 /
                           -1 unseeded) — the server exposes no flags for them, so the
                           defaults ARE the serving truth, same as llama's /props
    """
    missing = []
    model_dir = flag(backend, "--model")
    artifact = {"basename": None, "size": None, "sha256": None}
    template_digest = None
    context_size = None
    if model_dir and Path(model_dir).is_dir():
        root = Path(model_dir)
        parts, total = [], 0
        names = sorted([q for q in root.iterdir()
                        if q.suffix in (".safetensors", ".py", ".json") and q.is_file()],
                       key=lambda q: q.name)
        for q in names:
            digest, st = file_sha(q)
            parts.append({"name": q.name, "sha256": digest})
            if q.suffix == ".safetensors":
                total += st.st_size
        artifact = {"basename": root.name, "size": total or None,
                    "sha256": digest_json(parts) if parts else None}
        try:
            config = json.loads((root / "config.json").read_text())
            context_size = config.get("max_position_embeddings")
        except (OSError, ValueError):
            missing.append("mlx config.json")
        try:
            tok = json.loads((root / "tokenizer_config.json").read_text())
            template = tok.get("chat_template")
            if not isinstance(template, str) and (root / "chat_template.jinja").is_file():
                template = (root / "chat_template.jinja").read_text()
            template_digest = digest_bytes(json.dumps(template, sort_keys=True).encode()) if template else None
        except (OSError, ValueError):
            pass
    else:
        missing.append("mlx model directory")
    version = mlx_runtime_version(pid) if pid else None
    decoding = {
        "temperature": as_number(flag(backend, "--temp")),
        "top_p": as_number(flag(backend, "--top-p")),
        "top_k": as_number(flag(backend, "--top-k")),
        "min_p": as_number(flag(backend, "--min-p")),
        # mlx_lm.server exposes no server-level flags for these three; the recorded
        # values are its effective behaviour (no penalties, unseeded), which is the
        # same "serving truth" the llama path reads from /props defaults.
        "repeat_penalty": 1.0,
        "presence_penalty": 0.0,
        "reasoning": "backend-default",
        "reasoning_budget": "backend-default",
        "seed": -1,
    }
    fingerprint = {
        "schema": LEGACY_SCHEMA,
        "runtime": "mlx-lm",
        "model": model,
        "requested_model": model,
        "loaded_model": model_dir,
        "loaded_models": sorted(str(x.get("id")) for x in models.get("data", []) if x.get("id")),
        "gguf": artifact,
        "llama_cpp": {"build_info": f"mlx-lm=={version}" if version else None,
                      "commit": f"pypi:{version}" if version else None},
        "chat_template_sha256": template_digest,
        "router": {"type": None, "config_sha256": None},
        "context_size": context_size,
        "cache": {"key_type": "backend-default", "value_type": "backend-default", "ram": "backend-default"},
        "mtp": {"type": "disabled", "depth": 0, "threshold": 0},
        "decoding": decoding,
        "generation": {"max_tokens": as_number(flag(backend, "--max-tokens")) or "backend-default"},
        "performance": performance_from_argv(backend),
        "launch_flags_sha256": digest_json(normalize_flags(backend)) if backend else None,
        "missing": missing,
    }
    return fingerprint


def _capture_legacy(endpoint, model):
    if os.environ.get("SERVING_FINGERPRINT_FILE") or os.environ.get("SERVING_FINGERPRINT_URL"):
        return remote_document(model)
    host = urllib.parse.urlparse(endpoint).hostname
    if host not in ("127.0.0.1", "localhost", "::1"):
        return remote_document(model)
    missing = []
    try:
        models = fetch_json(endpoint.rstrip("/") + "/v1/models")
    except Exception:
        models = {}; missing.append("models response")
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
    if backend is None:
        # No llama-server: an `mlx_lm server` process is a first-class backend too
        # (maple-20b, 2026-08-05 — the zoo's first non-llama.cpp entry). Same schema,
        # same contract, same pre/post stability semantics; see mlx_fingerprint.
        mlx = next(((pid, argv) for pid, argv, _ in rows
                    if "mlx_lm" in argv and "server" in argv and flag(argv, "--model")), None)
        if mlx:
            fingerprint = mlx_fingerprint(mlx[1], model, models, pid=mlx[0])
            fingerprint["missing"] = sorted(set(missing + fingerprint["missing"]))
            for _, argv, _ in rows:
                if argv and "llama-swap" in Path(argv[0]).name:
                    fingerprint["router"] = {"type": "llama-swap", "config_sha256": None}
                    config = flag(argv, "--config")
                    if config and Path(config).is_file():
                        fingerprint["router"]["config_sha256"] = file_sha(config)[0]
                    else:
                        fingerprint["missing"].append("router config")
                    break
            else:
                fingerprint["router"] = {"type": "direct", "config_sha256": digest_json({"type": "direct"})}
            fingerprint["missing"] = sorted(set(fingerprint["missing"] + contract_missing(fingerprint)))
            fingerprint["status"] = "complete" if not fingerprint["missing"] else "incomplete"
            core = dict(fingerprint)
            fingerprint["fingerprint_sha256"] = digest_json(core)
            return fingerprint
    props = {}
    if backend:
        port = flag(backend, "--port")
        try:
            props = fetch_json(f"http://127.0.0.1:{port}/props") if port else {}
        except Exception:
            missing.append("backend props")
    else:
        missing.append("loaded llama-server process")
        backend = []

    model_path = flag(backend, "-m", "--model") or props.get("model_path")
    gguf = {"basename": Path(model_path).name if model_path else None, "size": None, "sha256": None}
    if model_path and Path(model_path).is_file():
        model_hash, st = file_sha(model_path); gguf.update(size=st.st_size, sha256=model_hash)
    else:
        missing.append("GGUF artifact hash")

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
        "schema": LEGACY_SCHEMA,
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
        "generation": {"max_tokens": as_number(flag(backend, "-n", "--predict")) or "backend-default"},
        "performance": performance_from_argv(backend),
        "launch_flags_sha256": digest_json(normalize_flags(backend)) if backend else None,
    }
    fingerprint["missing"] = sorted(set(fingerprint["missing"] + contract_missing(fingerprint)))
    fingerprint["status"] = "complete" if not fingerprint["missing"] else "incomplete"
    core = dict(fingerprint)
    fingerprint["fingerprint_sha256"] = digest_json(core)
    return fingerprint


def capture(endpoint, model):
    helper = helper_document(model)
    if helper is not None:
        return helper
    return upgrade_v2(_capture_legacy(endpoint, model))


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
        fields = ("semantic_sha256", "performance_sha256", "full_sha256")
        same = all(pre.get(field) and pre.get(field) == post.get(field) for field in fields)
        complete = (pre.get("schema") == post.get("schema") == SCHEMA and
                    pre.get("status") == post.get("status") == "complete")
        print(json.dumps({"stable": same, "complete": complete})); raise SystemExit(0 if same and complete else 1)


if __name__ == "__main__":
    main()
