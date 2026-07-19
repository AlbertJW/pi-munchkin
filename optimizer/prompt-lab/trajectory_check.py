#!/usr/bin/env python3
"""Fail-closed trajectory assertions backed only by execution-time receipts.

`search_spans` records a `pi.tool-receipt/v1` object in the matching tool-result
row.  Call arguments, visible headers, and arbitrary shell strings are not
evidence.  c23 currently requires an exhaustive receipt for bigdata's corpus.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ab-machinery"))
from metrics import session_files_for  # noqa: E402


def file_facts(path: Path) -> dict:
    data = path.read_bytes()
    if not data:
        lines = 0
    else:
        lines = data.count(b"\n") + (0 if data.endswith(b"\n") else 1)
    return {
        "path": str(path.resolve()),
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "lines": lines,
    }


def _calls_and_results(msgs):
    calls = {}
    results = []
    for msg in msgs:
        role = msg.get("role")
        if role == "assistant":
            for item in msg.get("content") or []:
                if isinstance(item, dict) and item.get("type") == "toolCall":
                    calls[str(item.get("id", ""))] = {
                        "name": str(item.get("name", "")).lower(),
                        "arguments": item.get("arguments") or {},
                    }
        elif role == "toolResult":
            results.append(msg)
    return calls, results


def validate_search_receipt(call, result, expected):
    if not call or call.get("name") != "search_spans":
        return False, "result has no matching search_spans call id"
    if result.get("isError"):
        return False, "search_spans result is an error"
    receipt = ((result.get("details") or {}).get("receipt") or {})
    if receipt.get("schema") != "pi.tool-receipt/v1" or receipt.get("operation") != "search_spans":
        return False, "missing pi.tool-receipt/v1 execution receipt"
    checks = {
        "normalized file": receipt.get("normalized_file") == expected["path"],
        "sha256": receipt.get("sha256") == expected["sha256"],
        "size": receipt.get("size_bytes") == expected["size"],
        "bytes examined": receipt.get("bytes_examined") == expected["size"],
        "line count": receipt.get("total_lines_scanned") == expected["lines"],
        "complete": receipt.get("complete") is True,
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        return False, "receipt mismatch: " + ", ".join(failed)
    return True, "verified exhaustive search_spans receipt"


def check_bigdata(msgs, corpus: Path, expected_corpus: Path | None = None):
    if not corpus.is_file():
        return False, f"expected corpus missing: {corpus}"
    expected = file_facts(expected_corpus or corpus)
    expected["path"] = str(corpus.resolve())
    calls, results = _calls_and_results(msgs)
    reasons = []
    for result in results:
        call = calls.get(str(result.get("toolCallId", "")))
        if not call or call.get("name") != "search_spans":
            continue
        ok, why = validate_search_receipt(call, result, expected)
        if ok:
            return True, why
        reasons.append(why)
    if reasons:
        return False, reasons[-1]
    return False, "no successful receipt-backed search_spans result for the corpus"


def load_msgs(session_path):
    msgs = []
    with open(session_path, encoding="utf-8") as fh:
        for line in fh:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("type") == "message":
                msgs.append(row["message"])
    return msgs


def check_session_files(session_paths, corpus: Path, expected_corpus: Path | None = None):
    """Validate attempts independently so reused toolCallIds cannot cross-bind."""
    reasons = []
    for session in session_paths:
        ok, why = check_bigdata(load_msgs(session), corpus, expected_corpus)
        if ok:
            return True, why
        reasons.append(f"{Path(session).name}: {why}")
    return False, "; ".join(reasons) if reasons else "no session attempts"


def check(workdir, task):
    if task != "bigdata":
        return True, "no trajectory rule for this task"
    sessions = session_files_for(workdir)
    if not sessions:
        return False, "no session found — trajectory evidence unavailable (fail closed)"
    canonical = Path(__file__).resolve().parents[1] / "real-gate-fixtures/bigdata/data/events.jsonl"
    return check_session_files(sessions, Path(workdir) / "data/events.jsonl", canonical)


def selftest():
    with tempfile.TemporaryDirectory() as td:
        corpus = Path(td) / "events.jsonl"
        corpus.write_text('{"x":"é"}\n{"x":2}\n', encoding="utf-8")
        facts = file_facts(corpus)
        call_id = "call-1"

        def messages(receipt=None, *, result=True, call=True, error=False):
            out = []
            if call:
                out.append({"role": "assistant", "content": [{
                    "type": "toolCall", "id": call_id, "name": "search_spans",
                    "arguments": {"path": "data/events.jsonl", "pattern": "."},
                }]})
            if result:
                out.append({"role": "toolResult", "toolCallId": call_id, "toolName": "search_spans",
                            "details": {"receipt": receipt or {}}, "isError": error})
            return out

        valid = {"schema": "pi.tool-receipt/v1", "operation": "search_spans",
                 "normalized_file": facts["path"], "sha256": facts["sha256"],
                 "size_bytes": facts["size"], "bytes_examined": facts["size"],
                 "total_lines_scanned": facts["lines"], "complete": True}
        assert check_bigdata(messages(valid), corpus)[0]
        for field, value in (("sha256", "0" * 64), ("size_bytes", 1),
                             ("bytes_examined", facts["size"] - 1),
                             ("total_lines_scanned", 1), ("complete", False),
                             ("normalized_file", str(Path(td) / "wrong.jsonl"))):
            bad = dict(valid); bad[field] = value
            assert not check_bigdata(messages(bad), corpus)[0], field
        assert not check_bigdata(messages(valid, result=False), corpus)[0]  # argument-only forgery
        assert not check_bigdata(messages(valid, call=False), corpus)[0]  # orphan result
        assert not check_bigdata(messages(valid, error=True), corpus)[0]
        # Fresh retries create another JSONL. Receipt evidence from either attempt
        # remains valid treatment-compliance evidence for the combined row.
        attempts = messages({**valid, "complete": False}) + messages(valid)
        assert check_bigdata(attempts, corpus)[0]
        first = Path(td) / "attempt-1.jsonl"; second = Path(td) / "attempt-2.jsonl"
        first.write_text("\n".join(json.dumps({"type": "message", "message": msg})
                                         for msg in messages({**valid, "complete": False})) + "\n")
        # Reuse the same call id in the retry. Independent validation must accept
        # its valid receipt without cross-binding to the first attempt.
        second.write_text("\n".join(json.dumps({"type": "message", "message": msg})
                                          for msg in messages(valid)) + "\n")
        assert check_session_files([first, second], corpus)[0]
        assert check("/missing", "t1")[0]
    print("trajectory_check selftest: OK (receipt binding, UTF-8 bytes, stale/partial/wrong-file rejection)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif len(sys.argv) >= 3:
        ok, why = check(sys.argv[1], sys.argv[2])
        if not ok:
            sys.stderr.write(f"[trajectory] {sys.argv[2]}: {why}\n")
        raise SystemExit(0 if ok else 1)
    else:
        raise SystemExit("usage: trajectory_check.py <workdir> <task> | --selftest")
