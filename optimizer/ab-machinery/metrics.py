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
import json, os, sys, glob

COLS = ["turns", "edits", "edit_err", "reads", "subag", "in_tok", "out_tok", "lb_fires", "vg_fires", "usage_exact"]

def _text_of(content):
    """Collect text from a message's content (string, or list of blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""

def parse_session(lines):
    turns = edits = edit_err = reads = subag = tin = tout = lb = vg = 0
    out_chars = 0
    last_call = None
    for line in lines:
        try:
            d = json.loads(line)
        except Exception:
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
                    n = (c.get("name") or "").lower(); last_call = n
                    if n == "edit": edits += 1
                    elif n == "read": reads += 1
                    elif n == "subagent": subag += 1
        elif role in ("toolResult", "tool"):
            err = m.get("isError") or any(c.get("isError") for c in (m.get("content") or []) if isinstance(c, dict))
            if err and last_call == "edit": edit_err += 1
    # ponytail: remote-llamacpp sessions record all-zero usage; keep a character
    # proxy for degraded-session detection, but mark it ineligible for token cost.
    usage_exact = int(tin > 0 and tout > 0)
    if not usage_exact:
        tout = out_chars
    return dict(zip(COLS, [turns, edits, edit_err, reads, subag, tin, tout, lb, vg, usage_exact]))

def session_file_for(workdir):
    """Newest session jsonl whose session dir mentions this run (ab-symbolect rule)."""
    munged = os.path.abspath(workdir).replace("/", "-")
    home = os.path.expanduser("~/.pi/agent/sessions")
    # boundary match ("...parens-1" must not grab "...parens-10"'s dir)
    cands = [d for d in glob.glob(home + "/*")
             if os.path.basename(d).rstrip("-").endswith((munged, os.path.basename(workdir)))]
    files = sorted((f for d in cands for f in glob.glob(d + "/*.jsonl")), key=os.path.getmtime)
    return files[-1] if files else None

def as_tsv(counts):
    return "\t".join(str(counts[c]) for c in COLS)

def selftest():
    syn = [
        json.dumps({"type": "message", "message": {"role": "assistant", "usage": {"input": 10, "output": 5},
                    "content": [{"type": "toolCall", "name": "read"}, {"type": "toolCall", "name": "read"}]}}),
        json.dumps({"type": "message", "message": {"role": "assistant", "usage": {"input": 20, "output": 8},
                    "content": [{"type": "toolCall", "name": "edit"}]}}),
        json.dumps({"type": "message", "message": {"role": "toolResult", "isError": True, "content": []}}),
        json.dumps({"type": "message", "message": {"role": "assistant",
                    "content": [{"type": "toolCall", "name": "subagent"}]}}),
        json.dumps({"type": "message", "message": {"role": "user",
                    "content": "[loop-breaker] Repeated read 2×, no file change."}}),
        json.dumps({"type": "message", "message": {"role": "user",
                    "content": [{"type": "text", "text": "[verify-gate] run the gate before finishing."}]}}),
        "not json — must be skipped",
    ]
    c = parse_session(syn)
    exp = {"turns": 3, "edits": 1, "edit_err": 1, "reads": 2, "subag": 1,
           "in_tok": 30, "out_tok": 13, "lb_fires": 1, "vg_fires": 1, "usage_exact": 1}
    assert c == exp, f"{c} != {exp}"
    assert as_tsv(c) == "3\t1\t1\t2\t1\t30\t13\t1\t1\t1", as_tsv(c)
    # zero-usage session (remote-llamacpp) -> out_tok falls back to chars
    zu = [json.dumps({"type": "message", "message": {"role": "assistant", "usage": {"input": 0, "output": 0},
          "content": [{"type": "thinking", "thinking": "hm"},
                      {"type": "toolCall", "name": "edit", "arguments": {"path": "x"}}]}})]
    z = parse_session(zu)
    assert z["out_tok"] == 2 + len(str({"path": "x"})), z
    assert z["usage_exact"] == 0, z
    print("metrics selftest: OK", as_tsv(c))

def main():
    if "--selftest" in sys.argv:
        selftest(); return
    if len(sys.argv) < 2:
        raise SystemExit("usage: metrics.py <workdir> | --selftest")
    f = session_file_for(sys.argv[1])
    if not f:
        print(as_tsv(dict(zip(COLS, [0] * len(COLS))))); return
    with open(f) as fh:
        print(as_tsv(parse_session(fh)))

if __name__ == "__main__":
    main()
