"""Render a gate session's transcript(s) into judge-readable text.

The bridge agentic_judge.py never had: its unit is a transcript STRING, and
nothing produced one from a gate workdir. This renders pi session JSONL
(resolved via ab-machinery/metrics.session_files_for) into a bounded, readable
turn log: role-tagged text, compact toolCall lines, tool results elided (the
judge grades the AGENT's behaviour — what it claimed, tried, and changed — not
the tool payloads, and results would blow the budget with untrusted bytes).

Bounding is middle-out: when a rendering exceeds MAX_CHARS, keep the head and
tail with an explicit elision marker — the last turns carry the wrap-up claims
the honesty dimension grades, the first carry the plan. Deterministic; no model
calls; fencing is agentic_judge.build_prompt's job, not ours.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ab-machinery"))

MAX_CHARS = 40_000
HEAD_SHARE = 0.4
MAX_ARG_CHARS = 160
MAX_TEXT_CHARS = 2_000


def _compact_args(arguments):
    parts = []
    for key, value in (arguments or {}).items():
        text = json.dumps(value) if not isinstance(value, str) else value
        text = text.replace("\n", "\\n")
        if len(text) > MAX_ARG_CHARS:
            text = text[:MAX_ARG_CHARS] + f"…(+{len(text) - MAX_ARG_CHARS} chars)"
        parts.append(f"{key}={text}")
    return " ".join(parts)


def render_lines(path):
    lines = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            try:
                record = json.loads(raw)
            except ValueError:
                continue
            if record.get("type") != "message":
                continue
            message = record.get("message") or {}
            role = message.get("role", "?")
            if role not in ("user", "assistant", "system"):
                continue  # tool results elided: untrusted payloads, budget-hostile
            for block in message.get("content") or []:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text" and (block.get("text") or "").strip():
                    text = block["text"].strip()
                    if len(text) > MAX_TEXT_CHARS:
                        text = text[:MAX_TEXT_CHARS] + f"…(+{len(text) - MAX_TEXT_CHARS} chars)"
                    lines.append(f"[{role}] {text}")
                elif block.get("type") == "toolCall":
                    lines.append(f"[{role}:tool] {block.get('name')} {_compact_args(block.get('arguments'))}")
    return lines


def bound(text, max_chars=MAX_CHARS):
    if len(text) <= max_chars:
        return text
    head = int(max_chars * HEAD_SHARE)
    tail = max_chars - head
    return (text[:head] + f"\n…[transcript elided: {len(text) - max_chars} chars omitted]…\n"
            + text[-tail:])


def render_workdir(workdir, max_chars=MAX_CHARS):
    """All attempts for a workdir, oldest first, as one bounded string ('' if none)."""
    from metrics import session_files_for
    sections = []
    for index, path in enumerate(session_files_for(workdir), start=1):
        lines = render_lines(path)
        if lines:
            sections.append(f"=== attempt {index} ===\n" + "\n".join(lines))
    return bound("\n\n".join(sections), max_chars)


def selftest():
    import tempfile
    record = lambda role, content: json.dumps(
        {"type": "message", "timestamp": "2026-08-15T10:00:00Z",
         "message": {"role": role, "content": content}})
    with tempfile.TemporaryDirectory() as td:
        transcript = os.path.join(td, "s.jsonl")
        with open(transcript, "w") as fh:
            fh.write(json.dumps({"type": "session", "version": 3}) + "\n")
            fh.write(record("user", [{"type": "text", "text": "Fix the bug."}]) + "\n")
            fh.write(record("assistant", [
                {"type": "toolCall", "name": "read", "arguments": {"path": "src/a.js", "limit": 100}},
                {"type": "text", "text": "Reading the source first."}]) + "\n")
            fh.write(record("toolResult", [{"type": "text", "text": "GIANT TOOL PAYLOAD " * 500}]) + "\n")
            fh.write(record("assistant", [{"type": "text", "text": "Done; tests pass."}]) + "\n")
        lines = render_lines(transcript)
        text = "\n".join(lines)
        assert "[user] Fix the bug." in text
        assert "[assistant:tool] read path=src/a.js limit=100" in text
        assert "Done; tests pass." in text
        assert "GIANT TOOL PAYLOAD" not in text, "tool results must be elided"
        assert all(len(line) <= MAX_TEXT_CHARS + 40 for line in lines)
        assert len(text) > 60, "synthetic transcript must exceed the test budget"
        bounded = bound(text, max_chars=60)
        assert len(bounded) <= 60 + 80, "budget plus one elision marker"
        assert "elided" in bounded and len(bounded) < len(text)
        assert bounded.endswith("Done; tests pass.")
    # Long tool args are truncated with an explicit marker.
    compact = _compact_args({"command": "x" * 500})
    assert len(compact) < 220 and "…(+" in compact
    print("judge_render selftest: OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif len(sys.argv) > 1:
        print(render_workdir(sys.argv[1]))
    else:
        print(__doc__)
