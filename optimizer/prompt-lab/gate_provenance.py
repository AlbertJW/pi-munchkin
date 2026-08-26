#!/usr/bin/env python3
"""Canonical identity for one parent gate session.

The gate invocation id groups paired rows. This module adds a unique identity
for the individual parent Pi process and provides the fail-closed comparison
used when reducing authenticated telemetry.
"""
import argparse
import json
import re
import sys
import uuid


SCHEMA = "pi.gate-session/v1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _text(value):
    return value if isinstance(value, str) and value else None


def mint(*, invocation_id, requested_model, resolved_model, requested_provider,
         resolved_provider, config_sha256, surface_sha256):
    return {
        "schema": SCHEMA,
        "session_id": uuid.uuid4().hex,
        "invocation_id": _text(invocation_id),
        "requested_model": _text(requested_model),
        "resolved_model": _text(resolved_model),
        "requested_provider": _text(requested_provider),
        "resolved_provider": _text(resolved_provider),
        "config_sha256": _text(config_sha256),
        "surface_sha256": _text(surface_sha256),
    }


def validate(observed, expected):
    """Return bounded mismatch labels; an empty list means authoritative."""
    if not isinstance(observed, dict):
        return ["identity_missing"]
    errors = []
    if observed.get("schema") != SCHEMA:
        errors.append("identity_schema")
    for field in (
        "session_id", "invocation_id", "requested_model", "resolved_model",
        "requested_provider", "resolved_provider", "config_sha256", "surface_sha256",
    ):
        value = observed.get(field)
        expected_value = expected.get(field)
        if not isinstance(value, str) or not value:
            errors.append(f"identity_missing_{field}")
        elif value != expected_value:
            errors.append(f"identity_mismatch_{field}")
    for field in ("config_sha256", "surface_sha256"):
        if isinstance(observed.get(field), str) and not HEX64.fullmatch(observed[field]):
            errors.append(f"identity_malformed_{field}")
    if isinstance(observed.get("session_id"), str) and not re.fullmatch(r"[0-9a-f]{32}", observed["session_id"]):
        errors.append("identity_malformed_session_id")
    return sorted(set(errors))


def selftest():
    identity = mint(
        invocation_id="run-a", requested_model="ling", resolved_model="ling",
        requested_provider="local-llamacpp", resolved_provider="local-llamacpp",
        config_sha256="a" * 64, surface_sha256="b" * 64,
    )
    assert identity["schema"] == SCHEMA
    assert re.fullmatch(r"[0-9a-f]{32}", identity["session_id"])
    assert validate(identity, identity) == []
    assert "identity_mismatch_config_sha256" in validate(identity, {**identity, "config_sha256": "c" * 64})
    assert "identity_missing" in validate(None, identity)
    malformed = {**identity, "surface_sha256": "not-a-hash"}
    assert "identity_malformed_surface_sha256" in validate(malformed, malformed)
    print("gate_provenance selftest: OK")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--mint", action="store_true")
    parser.add_argument("--invocation-id")
    parser.add_argument("--requested-model")
    parser.add_argument("--resolved-model")
    parser.add_argument("--requested-provider")
    parser.add_argument("--resolved-provider")
    parser.add_argument("--config-sha256")
    parser.add_argument("--surface-sha256")
    args = parser.parse_args(argv)
    if args.selftest:
        selftest()
        return
    if args.mint:
        print(json.dumps(mint(
            invocation_id=args.invocation_id,
            requested_model=args.requested_model,
            resolved_model=args.resolved_model,
            requested_provider=args.requested_provider,
            resolved_provider=args.resolved_provider,
            config_sha256=args.config_sha256,
            surface_sha256=args.surface_sha256,
        ), sort_keys=True))
        return
    parser.error("choose --selftest or --mint")


if __name__ == "__main__":
    main()
