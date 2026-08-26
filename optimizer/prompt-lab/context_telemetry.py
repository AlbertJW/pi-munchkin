#!/usr/bin/env python3
"""Deterministically reduce one gate session's exact-key context telemetry."""
import argparse
from collections import Counter
import hashlib
import hmac
import json
import os
import re
import sys
import tempfile


MAC_SUFFIX = re.compile(br',"mac":"([0-9a-f]{64})"}$')
SAFE_TIER_DETECTORS = {"semantic", "session", "combined"}
PROVENANCE_FIELDS = (
    "run_id", "provider", "model", "requested_provider", "requested_model",
    "config_sha256", "harness_surface_sha256",
)


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


def authenticated_events(path, key=None):
    raw = _read_raw(path)
    events = []
    for number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        event = _decode_line(line, number, key)
        if key is not None and event.get("schema") == "pi.harness-event/v2" and event.get("source") != "gate":
            raise ValueError(f"non-gate telemetry source in authoritative stream at line {number}")
        events.append(event)
    return raw, events


def exact_events(path, session_key, ext, key=None):
    raw, events = authenticated_events(path, key)
    return raw, [event for event in events if event.get("sk") == session_key and event.get("ext") == ext]


def has_abort(path, session_key, key=None):
    _, events = authenticated_events(path, key)
    for event in events:
        if event.get("sk") == session_key and event.get("kind") in ("abort", "outcome-abort"):
            return True
    return False


def exposure_counts(path, session_key, event_keys, key=None):
    """Count only declared ext/kind pairs for one authenticated session."""
    wanted = {event for event in event_keys if isinstance(event, str) and "/" in event}
    counts = {event: 0 for event in sorted(wanted)}
    _, events = authenticated_events(path, key)
    for event in events:
        if event.get("sk") != session_key:
            continue
        name = f"{event.get('ext', '')}/{event.get('kind', '')}"
        if name in counts:
            counts[name] += 1
    return counts


def _nonnegative_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0


def _nonnegative_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _tier_counts(events, kind):
    counts = Counter()
    for event in events:
        if event.get("kind") != kind:
            continue
        detector, tier = event.get("detector"), event.get("tier")
        if detector in SAFE_TIER_DETECTORS and isinstance(tier, int) and not isinstance(tier, bool) and 1 <= tier <= 3:
            counts[(detector, tier)] += 1
    return [
        {"detector": detector, "tier": tier, "count": count}
        for (detector, tier), count in sorted(counts.items())
    ]


def _failure_episode_summary(events):
    def unique(kind, fields):
        result, seen = [], set()
        for event in events:
            if event.get("kind") != kind:
                continue
            identity = tuple(event.get(field) for field in fields)
            if identity in seen:
                continue
            seen.add(identity)
            result.append(event)
        return result

    opened = unique("opened", ("episode_id",))
    observed = unique("observed", ("episode_id", "count"))
    recovered = unique("recovered", ("episode_id", "count", "recovery"))
    abandoned = unique("abandoned", ("episode_id", "count"))
    settled = [event for event in events if event.get("kind") == "settled"]

    final_counts = {}
    for event in observed + recovered + abandoned:
        episode_id, count = event.get("episode_id"), event.get("count")
        # episode_id is 16 hex chars: the harness truncates the episode key
        # (failure-episodes.ts, id = key.slice(0, 16)). A 64-hex requirement here
        # silently zeroed failures_after_second/recovered_episodes/recovery_calls_*
        # on every real row until 2026-08-25.
        if isinstance(episode_id, str) and re.fullmatch(r"[0-9a-f]{16}", episode_id) and _nonnegative_int(count):
            final_counts[episode_id] = max(final_counts.get(episode_id, 0), count)

    recovery_calls = {}
    for event in recovered:
        episode_id, calls = event.get("episode_id"), event.get("calls_after_second")
        if isinstance(episode_id, str) and re.fullmatch(r"[0-9a-f]{16}", episode_id) and _nonnegative_int(calls):
            recovery_calls[episode_id] = max(recovery_calls.get(episode_id, 0), calls)

    fields = (
        "total_episodes", "total_failures", "longest_episode",
        "semantic_failure_overrun", "correlated_failure_overrun", "settled_without_recovery",
    )
    settlement = settled[0] if len(settled) == 1 else {}
    valid_settlement = len(settled) == 1 and all(_nonnegative_int(settlement.get(field)) for field in fields)
    return {
        "complete": valid_settlement,
        "settlement_summaries": len(settled),
        "opened_events": len(opened),
        "observed_events": len(observed),
        "recovered_events": len(recovered),
        "abandoned_events": len(abandoned),
        **{field: settlement.get(field) if valid_settlement else None for field in fields},
        "failures_after_second": sum(max(0, count - 2) for count in final_counts.values()),
        "recovered_episodes": len(recovery_calls),
        "recovery_calls_total": sum(recovery_calls.values()),
        "recovery_calls_max": max(recovery_calls.values()) if recovery_calls else 0,
        "tier_observed": _tier_counts(events, "tier-observed"),
        "interventions": _tier_counts(events, "intervention"),
    }


def _provider_timing_summary(events):
    fields = ("request_to_headers_ms", "first_token_ms", "stream_completion_ms", "settlement_ms")
    result = {"requests": len(events)}
    for field in fields:
        values = [event.get(field) for event in events if _nonnegative_number(event.get(field))]
        result[field] = {
            "count": len(values),
            "sum_ms": sum(values),
            "max_ms": max(values) if values else None,
        }
    return result


def _verification_frontier_summary(events):
    fields = (
        "recognized_gates", "current_passed", "current_failed", "current_skipped", "current_total",
        "best_passed", "best_failed", "best_skipped", "best_total", "plateau_streak",
        "successful_mutation_epochs_since_advance", "verification_plateau_overrun",
    )
    settled = [event for event in events if event.get("kind") == "settled"]
    event = settled[0] if len(settled) == 1 else {}
    protocol = event.get("protocol")
    integers_valid = all(
        _nonnegative_int(event.get(field)) if field in (
            "recognized_gates", "plateau_streak", "successful_mutation_epochs_since_advance",
            "verification_plateau_overrun",
        ) else event.get(field) is None or _nonnegative_int(event.get(field))
        for field in fields
    )
    complete = (len(settled) == 1 and protocol in ("node_tap", "unknown") and
                isinstance(event.get("last_advanced"), bool) and integers_valid)
    return {
        "complete": complete,
        "settlement_summaries": len(settled),
        "protocol": protocol if complete else None,
        **{field: event.get(field) if complete else None for field in fields},
        "last_advanced": event.get("last_advanced") if complete else None,
    }


def _provenance_summary(events):
    """Summarize the identity stamped on every authenticated parent event."""
    values = {}
    mismatches = []
    for field in PROVENANCE_FIELDS:
        seen = {event.get(field) for event in events if event.get(field) is not None}
        if len(seen) == 1:
            values[field] = next(iter(seen))
        elif len(seen) > 1:
            values[field] = None
            mismatches.append(field)
        else:
            values[field] = None
            mismatches.append(field)
    valid_hashes = all(
        isinstance(values[field], str) and re.fullmatch(r"[0-9a-f]{64}", values[field])
        for field in ("config_sha256", "harness_surface_sha256")
    )
    return {
        "schema": "pi.gate-session/v1",
        "complete": not mismatches and valid_hashes,
        "mismatches": sorted(set(mismatches)),
        **values,
    }


def aggregate(path, session_key, key=None, exposure_events=None):
    raw, all_events = authenticated_events(path, key)
    session_events = [event for event in all_events if event.get("sk") == session_key]
    by_ext = {
        ext: [event for event in session_events if event.get("ext") == ext]
        for ext in ("context-watcher", "surface-receipt", "context-surface", "bash-output-guard", "plan-runner", "failure-episode", "runtime", "verification-frontier")
    }
    selected = by_ext["context-watcher"]
    surface_events = by_ext["surface-receipt"]
    context_surfaces = by_ext["context-surface"]
    guard_events = by_ext["bash-output-guard"]
    plan_events = by_ext["plan-runner"]
    delegate_blocks = [e for e in plan_events if e.get("kind") == "delegate-all-block"]
    delegate_subagents = [e for e in plan_events if e.get("kind") == "delegate-all-subagent"]
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

    result = {
        "schema": "pi.context-telemetry/v4",
        "authenticated": key is not None,
        "content_sha256": hashlib.sha256(raw).hexdigest(),
        "session_key": session_key,
        "provenance": _provenance_summary(session_events),
        "events": (len(selected) + len(context_surfaces) + len(guard_events) + len(delegate_blocks) +
                   len(delegate_subagents) + len(by_ext["failure-episode"]) +
                   sum(event.get("kind") == "provider-timing" for event in by_ext["runtime"]) +
                   len(by_ext["verification-frontier"])),
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
        "failure_episodes": _failure_episode_summary(by_ext["failure-episode"]),
        "provider_timing": _provider_timing_summary([
            event for event in by_ext["runtime"] if event.get("kind") == "provider-timing"
        ]),
        "verification_frontier": _verification_frontier_summary(by_ext["verification-frontier"]),
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
        {"ts":"x","sk":"other","ext":"plan-runner","kind":"delegate-all-block","toolName":"edit"},
        {"ts":"x","sk":"run-a","ext":"failure-episode","kind":"opened","episode_id":"b"*16,
         "failure_class":"compile_or_lint","tool_family":"bash","target_hash":"c"*64,"plan_item_hash":"d"*64},
        {"ts":"x","sk":"run-a","ext":"failure-episode","kind":"observed","episode_id":"b"*16,
         "failure_class":"compile_or_lint","count":3,"calls_after_second":2,"correlated_calls_after_second":1,"call_variant_count":2},
        {"ts":"x","sk":"run-a","ext":"failure-episode","kind":"observed","episode_id":"b"*16,
         "failure_class":"compile_or_lint","count":3,"calls_after_second":2,"correlated_calls_after_second":1,"call_variant_count":2},
        {"ts":"x","sk":"run-a","ext":"failure-episode","kind":"tier-observed","tier":1,"detector":"semantic",
         "mode":"shadow","failure_class":"compile_or_lint","count":2,"session_repeats":7},
        {"ts":"x","sk":"run-a","ext":"failure-episode","kind":"recovered","episode_id":"b"*16,
         "failure_class":"compile_or_lint","count":3,"calls_after_second":2,"correlated_calls_after_second":1,"recovery":"exact_gate"},
        {"ts":"x","sk":"run-a","ext":"failure-episode","kind":"settled","total_episodes":1,"total_failures":3,
         "longest_episode":3,"semantic_failure_overrun":2,"correlated_failure_overrun":1,"settled_without_recovery":0},
        {"ts":"x","sk":"run-a","ext":"runtime","kind":"provider-timing","request_seq":1,
         "request_to_headers_ms":10,"first_token_ms":20,"stream_completion_ms":30,"settlement_ms":40,"status":200},
        {"ts":"x","sk":"run-a","ext":"verification-frontier","kind":"settled","protocol":"node_tap",
         "recognized_gates":3,"current_passed":8,"current_failed":1,"current_skipped":0,"current_total":9,
         "best_passed":8,"best_failed":1,"best_skipped":0,"best_total":9,"last_advanced":False,
         "plateau_streak":2,"successful_mutation_epochs_since_advance":2,"verification_plateau_overrun":0},
    ]
    # Every authoritative parent event carries the same launcher identity. A
    # reduced row must expose drift rather than silently choosing the last value.
    for event in events:
        if event.get("sk") == "run-a":
            event.update({
                "run_id": "session-1", "provider": "local-llamacpp", "model": "ling",
                "requested_provider": "local-llamacpp", "requested_model": "ling",
                "config_sha256": "c" * 64, "harness_surface_sha256": "a" * 64,
            })
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
        assert row["schema"] == "pi.context-telemetry/v4"
        assert row["events"] == 18 and row["config"]["enabled"] is False
        assert row["compactions"]["pi"] == 1 and row["compactions"]["overflow"] == 0
        assert row["watcher"]["completed"] == 1 and row["watcher"]["resume_required"] == 1
        assert row["harness_surface_sha256"] == "a" * 64
        assert row["provenance"]["complete"] and row["provenance"]["run_id"] == "session-1"
        assert row["surface"]["calls"] == 1 and row["surface"]["context"]["max_bytes"] == 60
        assert row["surface"]["concentration"]["largest_message"]["mean"] == 0.6
        assert row["bash_output_guard"]["withheld"] == 2, "only run-a's two events, not the other session's"
        assert row["bash_output_guard"]["cwd_escape_suspected"] == 1
        assert row["plan_runner_delegation"]["blocked"] == 2, "only run-a's delegate-all-block events, not other's edit or run-a's own write"
        assert row["plan_runner_delegation"]["delegated"] == 1
        episodes = row["failure_episodes"]
        assert episodes["complete"] and episodes["settlement_summaries"] == 1
        assert episodes["observed_events"] == 1, "duplicate semantic event is counted once"
        assert episodes["failures_after_second"] == 1 and episodes["semantic_failure_overrun"] == 2
        assert episodes["recovered_episodes"] == 1 and episodes["recovery_calls_total"] == 2
        assert episodes["tier_observed"] == [{"detector":"semantic", "tier":1, "count":1}]
        assert row["provider_timing"]["requests"] == 1
        assert row["provider_timing"]["first_token_ms"] == {"count":1, "sum_ms":20, "max_ms":20}
        assert row["verification_frontier"]["complete"]
        assert row["verification_frontier"]["best_passed"] == 8
        exposure = exposure_counts(path, "run-a", ["plan-runner/delegate-all-block", "fake/event"], key)
        assert exposure["plan-runner/delegate-all-block"] == 2 and exposure["fake/event"] == 0
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
        missing_episodes = aggregate(os.path.join(td, "missing"), "run-a", key)["failure_episodes"]
        assert not missing_episodes["complete"] and missing_episodes["settlement_summaries"] == 0
        duplicate_settlement = os.path.join(td, "duplicate-settlement.jsonl")
        settlement = next(event for event in events if event.get("ext") == "failure-episode" and event.get("kind") == "settled")
        open(duplicate_settlement, "wb").write(signed(settlement) + signed(settlement))
        duplicate = aggregate(duplicate_settlement, "run-a", key)["failure_episodes"]
        assert not duplicate["complete"] and duplicate["settlement_summaries"] == 2
        schema_path = os.path.join(os.path.dirname(__file__), "..", "real-gate-fixtures", "schemas", "pi.eval-row-v4.schema.json")
        context_schema = json.load(open(schema_path))["properties"]["context"]
        assert set(context_schema["properties"]["compactions"]["required"]) == set(row["compactions"])
        assert set(context_schema["properties"]["watcher"]["required"]) == set(row["watcher"])
        assert set(context_schema["properties"]["surface"]["required"]) == set(row["surface"])
        assert set(context_schema["properties"]["bash_output_guard"]["required"]) == set(row["bash_output_guard"])
        assert set(context_schema["properties"]["plan_runner_delegation"]["required"]) == set(row["plan_runner_delegation"])
        assert set(context_schema["properties"]["failure_episodes"]["required"]) == set(row["failure_episodes"])
        assert set(context_schema["properties"]["provider_timing"]["required"]) == set(row["provider_timing"])
        assert set(context_schema["properties"]["verification_frontier"]["required"]) == set(row["verification_frontier"])
    print("context_telemetry selftest: OK (authenticated v4 episodes + frontier + provider timing; content sha256)")


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
