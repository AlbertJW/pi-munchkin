#!/usr/bin/env python3
"""Deterministically reduce one gate session's exact-key context telemetry."""
import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import tempfile


MAC_SUFFIX = re.compile(br',"mac":"([0-9a-f]{64})"}$')


def _read_raw(source):
    if isinstance(source, str) and source.startswith("fd:"):
        raw_fd = source[3:]
        if not raw_fd.isdigit():
            raise ValueError("telemetry fd source must be fd:<integer>")
        fd = int(raw_fd)
        return os.pread(fd, os.fstat(fd).st_size, 0)
    return open(source, "rb").read() if os.path.exists(source) else b""


def _decode_line(line, number, key=None):
    payload = line
    if key is not None:
        match = MAC_SUFFIX.search(line)
        if not match:
            raise ValueError(f"unsigned telemetry JSON at line {number}: {line[:200]!r}")
        payload = line[:match.start()] + b"}"
        expected = hmac.new(key, payload, hashlib.sha256).hexdigest().encode()
        if not hmac.compare_digest(match.group(1), expected):
            raise ValueError(f"invalid telemetry MAC at line {number}")
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid telemetry JSON at line {number}: {exc.msg}") from exc


def exact_events(path, session_key, ext, key=None):
    raw = _read_raw(path)
    selected = []
    for number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        event = _decode_line(line, number, key)
        if event.get("sk") == session_key and event.get("ext") == ext:
            selected.append(event)
    return raw, selected


def has_abort(path, session_key, key=None):
    raw = _read_raw(path)
    for number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        event = _decode_line(line, number, key)
        if event.get("sk") == session_key and event.get("kind") in ("abort", "outcome-abort"):
            return True
    return False


def aggregate(path, session_key, key=None):
    raw, selected = exact_events(path, session_key, "context-watcher", key)
    _, surface_events = exact_events(path, session_key, "surface-receipt", key)
    harness_surface_sha256 = None
    if surface_events:
        candidate = surface_events[-1].get("sha256")
        if isinstance(candidate, str) and re.fullmatch(r"[0-9a-f]{64}", candidate):
            harness_surface_sha256 = candidate

    configs = [e for e in selected if e.get("kind") == "session-config"]
    compactions = [e for e in selected if e.get("kind") == "compacted"]
    requests = [e for e in selected if e.get("kind") == "compact-requested"]
    completed = [e for e in selected if e.get("kind") == "compact-completed"]
    failed = [e for e in selected if e.get("kind") == "compact-failed"]
    config = None
    if configs:
        latest = configs[-1]
        config = {k: latest.get(k) for k in ("enabled", "thresholdPct", "rearmPct")}
    return {
        "schema": "pi.context-telemetry/v1",
        "authenticated": key is not None,
        "content_sha256": hashlib.sha256(raw).hexdigest(),
        "session_key": session_key,
        "events": len(selected),
        "harness_surface_sha256": harness_surface_sha256,
        "config": config,
        "compactions": {
            "total": len(compactions),
            "watcher": sum(e.get("requester") == "context-watcher" for e in compactions),
            "pi": sum(e.get("requester") == "pi" for e in compactions),
            "compact_tool": sum(e.get("requester") == "compact-tool" for e in compactions),
            "manual_unknown": sum(e.get("requester") == "manual-unknown" for e in compactions),
            "extension_content": sum(e.get("contentProvider") == "extension" for e in compactions),
            "threshold": sum(e.get("reason") == "threshold" for e in compactions),
            "overflow": sum(e.get("reason") == "overflow" for e in compactions),
            "manual": sum(e.get("reason") == "manual" for e in compactions),
            "will_retry": sum(bool(e.get("willRetry")) for e in compactions),
        },
        "watcher": {
            "requests": len(requests),
            "completed": len(completed),
            "failed": len(failed),
            "thrash_silenced": sum(e.get("kind") == "thrash-silenced" for e in selected),
            "resume_required": sum(bool(e.get("resumePending")) for e in requests),
            "estimates": [
                {k: e.get(k) for k in ("preTokens", "tokensBefore", "estimatedTokensAfter", "postTokens")}
                for e in completed + failed
            ],
        },
    }


def selftest():
    events = [
        {"ts":"x","sk":"other","ext":"context-watcher","kind":"compacted","reason":"overflow"},
        {"ts":"x","sk":"run-a","ext":"context-watcher","kind":"session-config","enabled":False,"thresholdPct":70,"rearmPct":55},
        {"ts":"x","sk":"run-a","ext":"context-watcher","kind":"compacted","requester":"pi","contentProvider":"pi","reason":"threshold","willRetry":False,"tokensBefore":800},
        {"ts":"x","sk":"run-a","ext":"context-watcher","kind":"compact-requested","resumePending":True},
        {"ts":"x","sk":"run-a","ext":"context-watcher","kind":"compact-completed","preTokens":750,"tokensBefore":750,"estimatedTokensAfter":300,"postTokens":None},
        {"ts":"x","sk":"run-a","ext":"surface-receipt","kind":"surface","sha256":"a"*64},
    ]
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "events.jsonl")
        key = b"k" * 32
        def signed(event):
            payload = json.dumps(event, separators=(",", ":")).encode()
            mac = hmac.new(key, payload, hashlib.sha256).hexdigest().encode()
            return payload[:-1] + b',"mac":"' + mac + b'"}\n'
        content = b"".join(signed(e) for e in events)
        open(path, "wb").write(content)
        row = aggregate(path, "run-a", key)
        assert row["content_sha256"] == hashlib.sha256(content).hexdigest()
        assert row["events"] == 4 and row["config"]["enabled"] is False
        assert row["compactions"]["pi"] == 1 and row["compactions"]["overflow"] == 0
        assert row["watcher"]["completed"] == 1 and row["watcher"]["resume_required"] == 1
        assert row["harness_surface_sha256"] == "a" * 64
        assert aggregate(os.path.join(td, "missing"), "run-a", key)["events"] == 0
        assert aggregate(os.path.join(td, "missing"), "run-a", key)["harness_surface_sha256"] is None
        assert not has_abort(path, "run-a", key)
        with open(path, "ab") as f:
            f.write(signed({"sk":"run-a-extra","kind":"abort"}))
            f.write(signed({"sk":"run-a","kind":"outcome-abort"}))
        assert has_abort(path, "run-a", key) and not has_abort(path, "run-a-extra-missing", key)
        forged = os.path.join(td, "forged.jsonl")
        open(forged, "wb").write(b'{"sk":"run-a","kind":"outcome-abort"}\n')
        try:
            has_abort(forged, "run-a", key)
        except ValueError as exc:
            assert "unsigned" in str(exc)
        else:
            raise AssertionError("unsigned telemetry was trusted")
        # a validly-signed but malformed (non-hex-64) sha256 must never surface —
        # the format guard, not just the signature, gates what becomes evidence.
        malformed = os.path.join(td, "malformed.jsonl")
        open(malformed, "wb").write(signed({"sk":"run-a","ext":"surface-receipt","kind":"surface","sha256":"not-a-hash"}))
        assert aggregate(malformed, "run-a", key)["harness_surface_sha256"] is None
        schema_path = os.path.join(os.path.dirname(__file__), "..", "real-gate-fixtures", "schemas", "pi.eval-row-v2.schema.json")
        context_schema = json.load(open(schema_path))["properties"]["context"]
        assert set(context_schema["properties"]["compactions"]["required"]) == set(row["compactions"])
        assert set(context_schema["properties"]["watcher"]["required"]) == set(row["watcher"])
    print("context_telemetry selftest: OK (exact key; counts; estimates; content sha256)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("telemetry_file", nargs="?")
    parser.add_argument("session_key", nargs="?")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--has-abort", action="store_true")
    parser.add_argument("--key-stdin", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    if not args.telemetry_file or not args.session_key:
        parser.error("telemetry_file and session_key are required")
    key = sys.stdin.buffer.read().strip() if args.key_stdin else None
    if args.key_stdin and (key is None or len(key) < 32):
        parser.error("--key-stdin requires at least 32 key bytes")
    if args.has_abort:
        raise SystemExit(0 if has_abort(args.telemetry_file, args.session_key, key) else 3)
    print(json.dumps(aggregate(args.telemetry_file, args.session_key, key), sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
