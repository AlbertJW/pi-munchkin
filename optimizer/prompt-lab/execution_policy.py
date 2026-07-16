#!/usr/bin/env python3
"""Execution-network metadata for real_gate (no network calls, no secrets)."""

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def sanitized_endpoint(url):
    parsed = urlsplit(url)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError("endpoint must include a scheme and host")
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return urlunsplit((parsed.scheme.lower(), f"{host.lower()}:{port}", parsed.path.rstrip("/"), "", ""))


def infer_provider(model, explicit_provider, model_control):
    if explicit_provider:
        return explicit_provider
    if "/" in model:
        return model.split("/", 1)[0]
    return "llama" if model_control == "llama" else "auto"


def configured_base_url(provider, models_path):
    if not models_path or not Path(models_path).is_file() or provider == "auto":
        return None
    try:
        providers = json.loads(Path(models_path).read_text(encoding="utf-8")).get("providers", {})
        return (providers.get(provider) or {}).get("baseUrl")
    except (OSError, ValueError, TypeError):
        return None


def resolve(network_mode, model_control, model, provider="", llama_url="", model_ip="", models_path=""):
    if network_mode not in ("open", "endpoint"):
        raise ValueError("GATE_NETWORK must be open or endpoint")
    if model_control not in ("llama", "pi-native"):
        raise ValueError("MODEL_CONTROL must be llama or pi-native")
    if model_control == "pi-native" and not model:
        raise ValueError("MODEL_CONTROL=pi-native requires PI_MODEL")
    if model_control == "pi-native" and network_mode != "open":
        raise ValueError("MODEL_CONTROL=pi-native requires GATE_NETWORK=open")

    resolved_provider = infer_provider(model, provider, model_control)
    if model_control == "llama":
        identity = sanitized_endpoint(llama_url)
        fingerprint_endpoint = identity
    else:
        base_url = configured_base_url(resolved_provider, models_path)
        identity = sanitized_endpoint(base_url) if base_url else f"builtin-provider:{resolved_provider}"
        fingerprint_endpoint = f"managed://{resolved_provider}"

    loopback = model_control == "llama" and (model_ip.startswith("127.") or model_ip in ("::1", "0.0.0.0"))
    network_authoritative = network_mode == "endpoint" and loopback
    if network_mode == "open":
        reason = "open network permits arbitrary benchmark-session egress"
    elif not loopback:
        reason = "remote endpoint uses a port-scoped wildcard and is not contamination-resistant"
    else:
        reason = "endpoint-restricted loopback transport"
    return {
        "network_mode": network_mode,
        "model_control": model_control,
        "provider": resolved_provider,
        "endpoint_identity_sha256": hashlib.sha256(identity.encode()).hexdigest(),
        "fingerprint_endpoint": fingerprint_endpoint,
        "network_authoritative": network_authoritative,
        "authority_reason": reason,
    }


def row_decision(fixture_authoritative, fixture_reason, stable, serving_complete,
                 network_authoritative, network_reason, exploratory_override=False,
                 eligible=True):
    authoritative = bool(fixture_authoritative and stable and serving_complete
                         and network_authoritative and eligible)
    if not eligible:
        status = "ineligible"
    elif authoritative:
        status = "complete"
    elif exploratory_override or not network_authoritative:
        status = "exploratory"
    else:
        status = "incomplete"
    reason = fixture_reason if network_authoritative else f"{fixture_reason}; {network_reason}"
    return authoritative, status, reason


def selftest():
    local = resolve("endpoint", "llama", "m", llama_url="http://user:secret@localhost:8080/v1?key=x", model_ip="127.0.0.1")
    assert local["network_authoritative"]
    assert local["provider"] == "llama"
    assert "secret" not in json.dumps(local) and "key=x" not in json.dumps(local)
    remote = resolve("endpoint", "llama", "m", llama_url="http://box:8080", model_ip="10.0.0.2")
    assert not remote["network_authoritative"] and "wildcard" in remote["authority_reason"]
    cloud = resolve("open", "pi-native", "openai/gpt-test")
    assert cloud["provider"] == "openai" and cloud["fingerprint_endpoint"] == "managed://openai"
    assert not cloud["network_authoritative"]
    assert row_decision(True, "approved", True, True, True, "restricted")[:2] == (True, "complete")
    assert row_decision(True, "approved", True, True, False, "open")[:2] == (False, "exploratory")
    assert row_decision(True, "approved", True, False, True, "restricted")[:2] == (False, "incomplete")
    assert row_decision(True, "approved", True, True, True, "restricted", eligible=False)[:2] == (False, "ineligible")
    try:
        resolve("endpoint", "pi-native", "openai/gpt-test")
    except ValueError:
        pass
    else:
        raise AssertionError("native providers must not claim endpoint isolation")
    print("execution_policy selftest: OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--network-mode")
    parser.add_argument("--model-control")
    parser.add_argument("--model", default="")
    parser.add_argument("--provider", default="")
    parser.add_argument("--llama-url", default="")
    parser.add_argument("--model-ip", default="")
    parser.add_argument("--models-path", default="")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    try:
        data = resolve(args.network_mode, args.model_control, args.model, args.provider,
                       args.llama_url, args.model_ip, args.models_path)
    except ValueError as exc:
        raise SystemExit(str(exc))
    text = json.dumps(data, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
