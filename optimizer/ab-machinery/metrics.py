#!/usr/bin/env python3
"""ab-machinery session-jsonl metrics.

Standalone copy of ab-symbolect.sh's inline parser (so that harness is left
untouched), extended with the machinery-specific signal: lb_fires / vg_fires —
how many times loop-breaker / verify-gate steered. Those steers are delivered as
followUp messages and recorded in the session, so we count messages whose text
carries the "[loop-breaker]" / "[verify-gate]" tag.

Usage:  metrics.py <workdir>     # prints a TSV row (see COLS)
        metrics.py --selftest    # no files; embedded synthetic session
"""
import json, os, re, sys, glob, tempfile

COLS = [
    # Keep the historical first 11 columns stable: real_gate.sh and old scripts
    # address these positions directly.
    "turns", "edits", "edit_err", "reads", "subag", "in_tok", "out_tok",
    "lb_fires", "vg_fires", "usage_exact", "output_chars",
    # Process metrics make small-model wins explainable instead of treating the
    # final binary score as the only signal.
    "tool_calls", "tool_errors", "repeat_calls", "repeat_reads",
    "tool_result_chars", "first_mutation_turn", "compactions", "unique_reads",
]
DEFAULT_READ_OFFSET = 1
DEFAULT_READ_LIMIT = 2000

def _text_of(content):
    """Collect text from a message's content (string, or list of blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def _bash_mutates(arguments):
    """Conservative trajectory signal; enforcement still lives in command-policy.ts."""
    command = str((arguments or {}).get("command") or "")
    return bool(re.search(
        r"(?:^|[;&|]\s*)(?:sed\s+-i\b|tee\b|rm\b|mv\b|cp\b|mkdir\b|touch\b|"
        r"git\s+(?:add|commit|mv|rm)\b|npm\s+(?:install|uninstall)\b)|(?:^|[^<])>>?\s*[^&]",
        command,
        re.I,
    ))


def _positive_int(value, default):
    """Normalize optional read bounds to the read tool's effective defaults."""
    if value is None:
        return default
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return default


def _read_span(arguments, workdir=None):
    """Canonical identity used by both unique-read and repeat-read metrics."""
    args = arguments or {}
    path = os.path.expanduser(str(args.get("path") or ""))
    if workdir and path and not os.path.isabs(path):
        path = os.path.join(os.path.abspath(workdir), path)
    path = os.path.normpath(path) if path else ""
    return (
        path,
        _positive_int(args.get("offset"), DEFAULT_READ_OFFSET),
        _positive_int(args.get("limit"), DEFAULT_READ_LIMIT),
    )


def parse_session(lines, workdir=None):
    turns = edits = edit_err = reads = subag = tin = tout = lb = vg = 0
    tool_calls = tool_errors = repeat_calls = repeat_reads = tool_result_chars = compactions = 0
    out_chars = 0
    first_mutation_turn = 0
    calls_by_id = {}
    seen_calls = set()
    read_targets = set()
    for line in lines:
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("type") == "compaction":
            compactions += 1
            continue
        if d.get("type") != "message":
            continue
        m = d["message"]
        role = m.get("role")
        text = _text_of(m.get("content"))
        if "[loop-breaker]" in text:
            lb += 1
        if "[verify-gate]" in text:
            vg += 1
        if role == "assistant":
            turns += 1
            u = m.get("usage") or {}
            tin += u.get("input", 0); tout += u.get("output", 0)
            for c in m.get("content") or []:
                if not isinstance(c, dict):
                    continue
                out_chars += len(c.get("text") or "") + len(c.get("thinking") or "")
                if c.get("type") == "toolCall":
                    out_chars += len(str(c.get("arguments") or ""))
                    n = (c.get("name") or "").lower()
                    args = c.get("arguments") or {}
                    call_id = str(c.get("id") or "")
                    if call_id:
                        calls_by_id[call_id] = n
                    tool_calls += 1
                    fingerprint = ((n, _read_span(args, workdir)) if n == "read" else
                                   (n, json.dumps(args, sort_keys=True, default=str)))
                    if fingerprint in seen_calls:
                        repeat_calls += 1
                        if n == "read":
                            repeat_reads += 1
                    seen_calls.add(fingerprint)
                    if n == "edit": edits += 1
                    elif n == "read":
                        reads += 1
                        read_targets.add(_read_span(args, workdir))
                    elif n == "subagent": subag += 1
                    if first_mutation_turn == 0 and (n in ("edit", "write", "plan_write") or (n == "bash" and _bash_mutates(args))):
                        first_mutation_turn = turns
        elif role in ("toolResult", "tool"):
            err = m.get("isError") or any(c.get("isError") for c in (m.get("content") or []) if isinstance(c, dict))
            tool_name = (m.get("toolName") or calls_by_id.get(str(m.get("toolCallId") or "")) or "").lower()
            if err:
                tool_errors += 1
                if tool_name == "edit": edit_err += 1
            tool_result_chars += len(text)
    # Remote llama.cpp sessions may record all-zero usage. Characters remain a
    # health proxy in their own dimension; they must never occupy a token field.
    usage_exact = int(tin > 0 and tout > 0)
    values = [turns, edits, edit_err, reads, subag, tin, tout, lb, vg, usage_exact, out_chars,
              tool_calls, tool_errors, repeat_calls, repeat_reads, tool_result_chars,
              first_mutation_turn, compactions, len(read_targets)]
    return dict(zip(COLS, values))

def session_files_for(workdir, sessions_home=None):
    """All attempt JSONLs for a run, oldest first."""
    munged = os.path.abspath(workdir).replace("/", "-")
    home = sessions_home or os.path.expanduser("~/.pi/agent/sessions")
    # boundary match ("...parens-1" must not grab "...parens-10"'s dir)
    cands = [d for d in glob.glob(home + "/*")
             if os.path.basename(d).rstrip("-").endswith((munged, os.path.basename(workdir)))]
    return sorted((f for d in cands for f in glob.glob(d + "/*.jsonl")),
                  key=lambda f: (os.path.getmtime(f), f))


def session_file_for(workdir):
    """Newest attempt JSONL (compatibility API for trajectory_check.py)."""
    files = session_files_for(workdir)
    return files[-1] if files else None


def metrics_for_workdir(workdir, sessions_home=None):
    """Aggregate the complete trajectory, including fresh retry sessions."""
    files = session_files_for(workdir, sessions_home)
    if not files:
        return dict(zip(COLS, [0] * len(COLS)))

    def lines():
        for path in files:
            with open(path, encoding="utf-8") as fh:
                yield from fh

    return parse_session(lines(), workdir=workdir)

def as_tsv(counts):
    return "\t".join(str(counts[c]) for c in COLS)

def selftest():
    syn = [
        json.dumps({"type": "message", "message": {"role": "assistant", "usage": {"input": 10, "output": 5},
                    "content": [{"type": "toolCall", "id": "r1", "name": "read", "arguments": {"path": "a"}},
                                {"type": "toolCall", "id": "r2", "name": "read", "arguments": {"path": "a"}}]}}),
        json.dumps({"type": "message", "message": {"role": "assistant", "usage": {"input": 20, "output": 8},
                    "content": [{"type": "toolCall", "id": "e1", "name": "edit"}]}}),
        json.dumps({"type": "message", "message": {"role": "toolResult", "toolCallId": "e1", "isError": True,
                    "content": [{"type": "text", "text": "stale tag"}]}}),
        json.dumps({"type": "message", "message": {"role": "assistant",
                    "content": [{"type": "toolCall", "id": "s1", "name": "subagent"}]}}),
        json.dumps({"type": "message", "message": {"role": "user",
                    "content": "[loop-breaker] Repeated read 2×, no file change."}}),
        json.dumps({"type": "message", "message": {"role": "user",
                    "content": [{"type": "text", "text": "[verify-gate] run the gate before finishing."}]}}),
        json.dumps({"type": "compaction", "tokensBefore": 1234}),
        "not json — must be skipped",
    ]
    c = parse_session(syn)
    exp = {"turns": 3, "edits": 1, "edit_err": 1, "reads": 2, "subag": 1,
           "in_tok": 30, "out_tok": 13, "lb_fires": 1, "vg_fires": 1, "usage_exact": 1,
           "output_chars": 2 * len(str({"path": "a"})), "tool_calls": 4, "tool_errors": 1,
           "repeat_calls": 1, "repeat_reads": 1, "tool_result_chars": len("stale tag"),
           "first_mutation_turn": 2, "compactions": 1, "unique_reads": 1}
    assert c == exp, f"{c} != {exp}"
    assert as_tsv(c).split("\t")[:11] == ["3", "1", "1", "2", "1", "30", "13", "1", "1", "1", str(exp["output_chars"])], as_tsv(c)
    # zero-usage session keeps token counts at zero and reports a char proxy separately
    zu = [json.dumps({"type": "message", "message": {"role": "assistant", "usage": {"input": 0, "output": 0},
          "content": [{"type": "thinking", "thinking": "hm"},
                      {"type": "toolCall", "name": "edit", "arguments": {"path": "x"}}]}})]
    z = parse_session(zu)
    assert z["out_tok"] == 0, z
    assert z["output_chars"] == 2 + len(str({"path": "x"})), z
    assert z["usage_exact"] == 0, z
    assert z["first_mutation_turn"] == 1, z
    assert _bash_mutates({"command": "sed -i '' 's/a/b/' src/x.js"})
    assert _bash_mutates({"command": "printf x > src/x.js"})
    assert not _bash_mutates({"command": "node --test && git status --short"})
    # Equivalent spellings and omitted/default bounds identify the same span;
    # a genuinely different limit remains a different span.
    spans = [
        {"path": "./src/../src/a.js"},
        {"path": "src/a.js", "offset": 1, "limit": 2000},
        {"path": "src/a.js", "offset": 1, "limit": 20},
    ]
    span_lines = [json.dumps({"type": "message", "message": {"role": "assistant",
                  "content": [{"type": "toolCall", "name": "read", "arguments": args}]}})
                  for args in spans]
    sc = parse_session(span_lines, workdir="/tmp/metrics-span-run")
    assert sc["reads"] == 3 and sc["unique_reads"] == 2 and sc["repeat_reads"] == 1, sc

    # A retry creates another JSONL for the same workdir. Both attempts must
    # contribute to totals, and a cross-attempt re-read must remain visible.
    with tempfile.TemporaryDirectory() as td:
        work = os.path.join(td, "gate-run-1")
        sessions = os.path.join(td, "sessions")
        os.makedirs(work); os.makedirs(sessions)
        session_dir = os.path.join(sessions, os.path.abspath(work).replace("/", "-") + "-")
        os.makedirs(session_dir)
        attempts = [
            ("attempt-1.jsonl", 10, 2, {"path": "src/a.js"}),
            ("attempt-2.jsonl", 20, 4, {"path": "./src/a.js", "offset": 1, "limit": 2000}),
        ]
        for i, (name, itok, otok, args) in enumerate(attempts, 1):
            path = os.path.join(session_dir, name)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(json.dumps({"type": "message", "message": {"role": "assistant",
                    "usage": {"input": itok, "output": otok}, "content": [
                        {"type": "toolCall", "id": f"r{i}", "name": "read", "arguments": args}]}}) + "\n")
            os.utime(path, (i, i))
        files = session_files_for(work, sessions)
        assert [os.path.basename(f) for f in files] == ["attempt-1.jsonl", "attempt-2.jsonl"], files
        agg = metrics_for_workdir(work, sessions)
        assert agg["turns"] == 2 and agg["in_tok"] == 30 and agg["out_tok"] == 6, agg
        assert agg["reads"] == 2 and agg["unique_reads"] == 1 and agg["repeat_reads"] == 1, agg
    print("metrics selftest: OK", as_tsv(c))

def main():
    if "--selftest" in sys.argv:
        selftest(); return
    if len(sys.argv) < 2:
        raise SystemExit("usage: metrics.py <workdir> | --selftest")
    print(as_tsv(metrics_for_workdir(sys.argv[1])))

if __name__ == "__main__":
    main()
