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
        if key is not None and event.get("schema") == "pi.harness-event/v2" and event.get("source") != "gate":
            raise ValueError(f"non-gate telemetry source in authoritative stream at line {number}")
        if event.get("sk") == session_key and event.get("ext") == ext:
            selected.append(event)
    return raw, selected


def has_abort(path, session_key, key=None):
    raw = _read_raw(path)
    for number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        event = _decode_line(line, number, key)
        if key is not None and event.get("schema") == "pi.harness-event/v2" and event.get("source") != "gate":
            raise ValueError(f"non-gate telemetry source in authoritative stream at line {number}")
        if event.get("sk") == session_key and event.get("kind") in ("abort", "outcome-abort"):
            return True
    return False


def exposure_counts(path, session_key, event_keys, key=None):
    """Count only declared ext/kind pairs for one authenticated session."""
    wanted = {event for event in event_keys if isinstance(event, str) and "/" in event}
    counts = {event: 0 for event in sorted(wanted)}
    raw = _read_raw(path)
    for number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        event = _decode_line(line, number, key)
        if key is not None and event.get("schema") == "pi.harness-event/v2" and event.get("source") != "gate":
            raise ValueError(f"non-gate telemetry source in authoritative stream at line {number}")
        if event.get("sk") != session_key:
            continue
        name = f"{event.get('ext', '')}/{event.get('kind', '')}"
        if name in counts:
            counts[name] += 1
    return counts


def aggregate(path, session_key, key=None, exposure_events=None):
    raw, selected = exact_events(path, session_key, "context-watcher", key)
    _, surface_events = exact_events(path, session_key, "surface-receipt", key)
    _, context_surfaces = exact_events(path, session_key, "context-surface", key)
    _, guard_events = exact_events(path, session_key, "bash-output-guard", key)
    _, plan_events = exact_events(path, session_key, "plan-runner", key)
    delegate_blocks = [e for e in plan_events if e.get("kind") == "delegate-all-block"]
    delegate_subagents = [e for e in plan_events if e.get("kind") == "delegate-all-subagent"]
    v4_kinds = {
        "reflection", "v4-write", "route", "tdd", "capability-refresh",
        "review", "step-context",
    }
    v4_events = [e for e in plan_events if e.get("kind") in v4_kinds]
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
    def stats(field):
        values = [e.get(field) for e in context_surfaces if isinstance(e.get(field), (int, float)) and not isinstance(e.get(field), bool)]
        return {
            "max": max(values) if values else None,
            "mean": (sum(values) / len(values)) if values else None,
        }

    def bool_rate(field):
        values = [e.get(field) for e in context_surfaces if isinstance(e.get(field), bool)]
        return (sum(values) / len(values)) if values else None

    message_bytes = []
    for event in context_surfaces:
        values = [event.get(name) for name in ("user_text_bytes", "assistant_text_bytes", "tool_text_bytes", "custom_text_bytes")]
        if all(isinstance(value, int) and not isinstance(value, bool) for value in values):
            message_bytes.append(sum(values))

    reflections = [e for e in v4_events if e.get("kind") == "reflection"]
    writes = [e for e in v4_events if e.get("kind") == "v4-write"]
    accepted_writes = [e for e in writes if e.get("accepted") is True]
    rejected_writes = [e for e in writes if e.get("accepted") is False]
    latest_accepted_write = accepted_writes[-1] if accepted_writes else {}
    routes = [e for e in v4_events if e.get("kind") == "route"]
    tdd_events = [e for e in v4_events if e.get("kind") == "tdd"]
    capability_events = [e for e in v4_events if e.get("kind") == "capability-refresh"]
    review_events = [e for e in v4_events if e.get("kind") == "review"]
    step_context_events = [e for e in v4_events if e.get("kind") == "step-context"]

    seen_red = set()
    compliant_green = set()
    green_without_red = 0
    stale_pending = set()
    stale_observed = set()
    stale_revalidated = set()
    for event in plan_events:
        if event.get("kind") == "route":
            for item_hash in event.get("stale_item_sha256") or []:
                if isinstance(item_hash, str):
                    stale_pending.add(item_hash)
                    stale_observed.add(item_hash)
        if event.get("kind") != "tdd":
            continue
        item_hash = event.get("item_sha256")
        phase = event.get("phase")
        if not isinstance(item_hash, str):
            continue
        if phase == "red":
            seen_red.add(item_hash)
        elif phase == "green":
            if item_hash in seen_red:
                compliant_green.add(item_hash)
            else:
                green_without_red += 1
            if item_hash in stale_pending:
                stale_revalidated.add(item_hash)
                stale_pending.discard(item_hash)

    def count_status(events, status):
        return sum(event.get("status") == status for event in events)

    result = {
        "schema": "pi.context-telemetry/v2",
        "authenticated": key is not None,
        "content_sha256": hashlib.sha256(raw).hexdigest(),
        "session_key": session_key,
        "events": len(selected) + len(context_surfaces) + len(guard_events) + len(delegate_blocks) + len(delegate_subagents) + len(v4_events),
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
        "surface": {
            "calls": len(context_surfaces),
            "concentration": {
                "largest_message": stats("largest_message_share"),
                "largest_tool_result": stats("largest_tool_result_share"),
            },
            "duplication": {
                "exact_block": stats("exact_duplicate_block_share"),
                "five_token_shingle": stats("repeated_five_token_shingle_share"),
                "near_block": stats("near_duplicate_block_share"),
            },
            "stale_tool_result": stats("stale_tool_result_share"),
            "kv_cache": {
                "prefix_stable_rate": bool_rate("prefix_stable"),
                "appended_only_rate": bool_rate("appended_only"),
                "system_prompt_changes": sum(e.get("system_prompt_changed") is True for e in context_surfaces),
            },
            "context": {
                "max_bytes": max(message_bytes) if message_bytes else None,
                "mean_bytes": (sum(message_bytes) / len(message_bytes)) if message_bytes else None,
                "tokens": stats("context_tokens"),
            },
        },
        "bash_output_guard": {
            "withheld": len(guard_events),
            "cwd_escape_suspected": sum(bool(e.get("cwd_escape_suspected")) for e in guard_events),
        },
        "plan_runner_delegation": {
            "blocked": len(delegate_blocks),
            "delegated": len(delegate_subagents),
        },
        "plan_runner_v4": {
            "events": len(v4_events),
            "reflection": {
                "passes": len(reflections),
                "max_pass": max((int(e.get("pass", 0)) for e in reflections), default=0),
                "requirements": max((int(e.get("requirements", 0)) for e in reflections), default=0),
                "uncertainties": sum(int(e.get("uncertainties", 0)) for e in reflections),
            },
            "writes": {
                "total": len(writes),
                "accepted": len(accepted_writes),
                "rejected": len(rejected_writes),
                "rejection_rate": (len(rejected_writes) / len(writes)) if writes else None,
                "coverage_errors": sum(int(e.get("coverage_errors", 0)) for e in rejected_writes),
                "capability_errors": sum(int(e.get("capability_errors", 0)) for e in rejected_writes),
                "requirements": int(latest_accepted_write.get("requirements", 0)),
                "covered_requirements": int(latest_accepted_write.get("covered_requirements", 0)),
                "acceptance_criteria": int(latest_accepted_write.get("acceptance_criteria", 0)),
                "required_capabilities": int(latest_accepted_write.get("required_capabilities", 0)),
            },
            "routing": {
                "total": len(routes),
                "accepted": sum(e.get("accepted") is True for e in routes),
                "rejected": sum(e.get("accepted") is False for e in routes),
                "jumps": sum(e.get("accepted") is True and int(e.get("selected_rank", 0)) > 1 for e in routes),
                "backtracks": sum(e.get("accepted") is True and e.get("action") == "backtrack" for e in routes),
                "blocks": sum(e.get("action") == "block" for e in routes),
                "stale": sum(int(e.get("stale", 0)) for e in routes),
                "churn_peak": max((int(e.get("streak", 0)) for e in routes), default=0),
                "stale_items": len(stale_observed),
                "stale_revalidated": len(stale_revalidated),
            },
            "tdd": {
                "red": sum(e.get("phase") == "red" for e in tdd_events),
                "green": sum(e.get("phase") == "green" for e in tdd_events),
                "final": sum(e.get("phase") == "final" and e.get("pass") is True for e in tdd_events),
                "compliant_steps": len(compliant_green),
                "green_without_red": green_without_red,
            },
            "capabilities": {
                "refreshes": len(capability_events),
                "changes": sum(e.get("changed") is True for e in capability_events),
            },
            "review": {
                "events": len(review_events),
                "unavailable": count_status(review_events, "unavailable"),
                "pending": count_status(review_events, "pending"),
                "approved": count_status(review_events, "approved"),
                "rejected": count_status(review_events, "rejected"),
            },
            "step_context": {
                "events": len(step_context_events),
                "delegated": sum(e.get("delegated") is True for e in step_context_events),
                "successful": sum(e.get("success") is True for e in step_context_events),
                "parent_input": sum(int(e.get("parent_input", 0)) for e in step_context_events),
                "child_input": sum(int(e.get("child_input", 0)) for e in step_context_events),
                "child_output": sum(int(e.get("child_output", 0)) for e in step_context_events),
            },
        },
    }
    if exposure_events:
        result["exposure"] = exposure_counts(path, session_key, exposure_events, key)
    return result


def selftest():
    events = [
        {"ts":"x","sk":"other","ext":"context-watcher","kind":"compacted","reason":"overflow"},
        {"ts":"x","sk":"run-a","ext":"context-watcher","kind":"session-config","enabled":False,"thresholdPct":70,"rearmPct":55},
        {"ts":"x","sk":"run-a","ext":"context-watcher","kind":"compacted","requester":"pi","contentProvider":"pi","reason":"threshold","willRetry":False,"tokensBefore":800},
        {"ts":"x","sk":"run-a","ext":"context-watcher","kind":"compact-requested","resumePending":True},
        {"ts":"x","sk":"run-a","ext":"context-watcher","kind":"compact-completed","preTokens":750,"tokensBefore":750,"estimatedTokensAfter":300,"postTokens":None},
        {"ts":"x","sk":"run-a","ext":"surface-receipt","kind":"surface","sha256":"a"*64},
        {"ts":"x","sk":"run-a","ext":"context-surface","kind":"receipt","largest_message_share":0.6,
         "largest_tool_result_share":0.7,"exact_duplicate_block_share":0.2,"repeated_five_token_shingle_share":0.1,
         "stale_tool_result_share":0.4,"user_text_bytes":10,"assistant_text_bytes":20,"tool_text_bytes":30,
         "custom_text_bytes":0,"context_tokens":100},
        {"ts":"x","sk":"run-a","ext":"bash-output-guard","kind":"withheld","chars":9000,"max_chars":8000,"cwd_escape_suspected":True},
        {"ts":"x","sk":"run-a","ext":"bash-output-guard","kind":"withheld","chars":15000,"max_chars":8000,"cwd_escape_suspected":False},
        {"ts":"x","sk":"other","ext":"bash-output-guard","kind":"withheld","chars":9000,"max_chars":8000,"cwd_escape_suspected":True},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"delegate-all-block","toolName":"read"},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"delegate-all-block","toolName":"bash"},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"delegate-all-subagent","agent":"executor","mode":"spawn"},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"write","items":1},  # unrelated plan-runner kind — must not be counted
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"reflection","stage":"interpretation","pass":1,"next":"evidence","requirements":2,"uncertainties":1},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"v4-write","accepted":False,"coverage_errors":1,"capability_errors":0},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"v4-write","accepted":True,"coverage_errors":0,"capability_errors":0,
         "requirements":2,"covered_requirements":2,"acceptance_criteria":3,"required_capabilities":1},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"route","action":"backtrack","accepted":True,"selected_rank":1,
         "stale":1,"streak":0,"stale_item_sha256":["b"*64]},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"tdd","phase":"red","pass":False,"item_sha256":"b"*64},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"tdd","phase":"green","pass":True,"item_sha256":"b"*64},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"capability-refresh","changed":True},
        {"ts":"x","sk":"run-a","ext":"plan-runner","kind":"step-context","delegated":True,"success":True,
         "parent_input":100,"child_input":20,"child_output":5},
        {"ts":"x","sk":"other","ext":"plan-runner","kind":"delegate-all-block","toolName":"edit"},
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
        assert row["schema"] == "pi.context-telemetry/v2"
        assert row["events"] == 18 and row["config"]["enabled"] is False
        assert row["compactions"]["pi"] == 1 and row["compactions"]["overflow"] == 0
        assert row["watcher"]["completed"] == 1 and row["watcher"]["resume_required"] == 1
        assert row["harness_surface_sha256"] == "a" * 64
        assert row["surface"]["calls"] == 1 and row["surface"]["context"]["max_bytes"] == 60
        assert row["surface"]["concentration"]["largest_message"]["mean"] == 0.6
        assert row["bash_output_guard"]["withheld"] == 2, "only run-a's two events, not the other session's"
        assert row["bash_output_guard"]["cwd_escape_suspected"] == 1
        assert row["plan_runner_delegation"]["blocked"] == 2, "only run-a's delegate-all-block events, not other's edit or run-a's own write"
        assert row["plan_runner_delegation"]["delegated"] == 1
        assert row["plan_runner_v4"]["writes"]["rejection_rate"] == 0.5
        assert row["plan_runner_v4"]["writes"]["covered_requirements"] == 2
        assert row["plan_runner_v4"]["routing"]["backtracks"] == 1
        assert row["plan_runner_v4"]["routing"]["stale_revalidated"] == 1
        assert row["plan_runner_v4"]["tdd"]["compliant_steps"] == 1
        assert row["plan_runner_v4"]["step_context"]["child_input"] == 20
        exposure = exposure_counts(path, "run-a", ["plan-runner/route", "fake/event"], key)
        assert exposure["plan-runner/route"] == 1 and exposure["fake/event"] == 0
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
        bad_source = os.path.join(td, "bad-source.jsonl")
        open(bad_source, "wb").write(signed({"schema":"pi.harness-event/v2", "source":"test",
                                               "sk":"run-a", "ext":"context-watcher", "kind":"session-config"}))
        try:
            aggregate(bad_source, "run-a", key)
        except ValueError as exc:
            assert "non-gate telemetry source" in str(exc)
        else:
            raise AssertionError("authoritative reducer trusted test-source telemetry")
        try:
            has_abort(bad_source, "run-a", key)
        except ValueError as exc:
            assert "non-gate telemetry source" in str(exc)
        else:
            raise AssertionError("abort reducer trusted test-source telemetry")
        schema_path = os.path.join(os.path.dirname(__file__), "..", "real-gate-fixtures", "schemas", "pi.eval-row-v2.schema.json")
        context_schema = json.load(open(schema_path))["properties"]["context"]
        assert set(context_schema["properties"]["compactions"]["required"]) == set(row["compactions"])
        assert set(context_schema["properties"]["watcher"]["required"]) == set(row["watcher"])
        assert set(context_schema["properties"]["surface"]["required"]) == set(row["surface"])
        assert set(context_schema["properties"]["bash_output_guard"]["required"]) == set(row["bash_output_guard"])
        assert set(context_schema["properties"]["plan_runner_delegation"]["required"]) == set(row["plan_runner_delegation"])
        assert set(context_schema["properties"]["plan_runner_v4"]["required"]) == set(row["plan_runner_v4"])
    print("context_telemetry selftest: OK (exact key; v2 surface aggregates; content sha256)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("telemetry_file", nargs="?")
    parser.add_argument("session_key", nargs="?")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--has-abort", action="store_true")
    parser.add_argument("--key-stdin", action="store_true")
    parser.add_argument("--exposure-event", action="append", default=[])
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
    print(json.dumps(aggregate(args.telemetry_file, args.session_key, key, args.exposure_event), sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
