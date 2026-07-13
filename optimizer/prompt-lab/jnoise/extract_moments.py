#!/usr/bin/env python3
"""extract_moments: build the labeled confabulation corpus for the jlens phase-0
discrimination study. Walks archived pi session JSONLs, finds every hashline
`edit` tool call, and labels it by its tool result:

  CONFAB       — invented/malformed [path#TAG] header ("bad patch line ... before
                 any [path#TAG] header"): the epistemic-guessing moment.
  CONFAB_EXACT — builtin-edit exact-match failure ("Could not find the exact
                 text"): old_string invention (lc-on arm-1 class).
  CLEAN        — edit applied without error: the control, same task structure.

Emits one JSONL row per moment: {session, sdir, turn, label, call_args, context:
[{role, text}...] } where context is the conversation UP TO the call. Context
INCLUDES tool results (role "tool"), bounded to TOOLRESULT_CAP chars each —
this is load-bearing: the correct hashline tag lives in the prior `read`
OUTPUT (a tool result), so a prefix without it destroys the tag-copy signal
for both classes (would false-reject jlens). The tag header sits at the top of
a read result, so the head-cap preserves it. Still omitted: pi's builtin
system prompt + tool schemas (a consistent distortion across classes).

  ./extract_moments.py <sessions_glob> -o moments.jsonl
  ./extract_moments.py --selftest
"""
import glob as globmod
import json, os, sys

CONFAB_PATTERNS = ["before any [path#TAG] header", "unknown tag", "stale tag"]
CONFAB_EXACT_PATTERNS = ["Could not find the exact text"]
# Head-cap tool-result text kept in the prefix: the `[path#TAG]` header sits at
# the TOP of a hashline read, so the head preserves the copy target while
# bounding the corpus file. Enough to hold a header + first lines.
TOOLRESULT_CAP = int(os.environ.get("JNOISE_TOOLRESULT_CAP", "2500"))


def classify_error(text):
    if any(p in text for p in CONFAB_PATTERNS):
        return "CONFAB"
    if any(p in text for p in CONFAB_EXACT_PATTERNS):
        return "CONFAB_EXACT"
    return None


def _text_of(content):
    if not isinstance(content, list):
        return ""
    return "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")


def moments_from_session(path):
    """Yield labeled moments from one session JSONL."""
    msgs = []
    for line in open(path):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "message":
            msgs.append(d["message"])
    # index tool results by toolCallId
    results = {}
    for m in msgs:
        if m.get("role") in ("toolResult", "tool"):
            err = bool(m.get("isError")) or any(
                isinstance(c, dict) and c.get("isError") for c in (m.get("content") or []))
            text = _text_of(m.get("content")) or "".join(
                c.get("text", "") for c in (m.get("content") or []) if isinstance(c, dict))
            tid = m.get("toolCallId") or m.get("tool_call_id")
            if tid:
                results[tid] = (err, text)
    context = []
    turn = 0
    for m in msgs:
        role = m.get("role")
        if role == "assistant":
            turn += 1
            for c in m.get("content") or []:
                if not (isinstance(c, dict) and c.get("type") == "toolCall"):
                    continue
                if c.get("name") != "edit":
                    continue
                err, rtext = results.get(c.get("id"), (None, ""))
                if err is None:
                    continue
                label = classify_error(rtext) if err else "CLEAN"
                if label:
                    # parent dir name = munged workdir -> carries GEN-MODEL-arm-task-rep
                    yield {"session": os.path.basename(path), "sdir": os.path.basename(os.path.dirname(path)),
                           "turn": turn, "label": label,
                           "call_args": c.get("arguments"), "context": list(context)}
            t = _text_of(m.get("content"))
            if t:
                context.append({"role": "assistant", "text": t})
        elif role == "user":
            t = _text_of(m.get("content"))
            if t:
                context.append({"role": "user", "text": t})
        elif role in ("toolResult", "tool"):
            # Load-bearing: read outputs carry the tag the next edit must copy.
            t = _text_of(m.get("content")) or "".join(
                c.get("text", "") for c in (m.get("content") or []) if isinstance(c, dict))
            if t:
                context.append({"role": "tool", "text": t[:TOOLRESULT_CAP]})


def run(session_glob, out_path):
    counts = {}
    with open(out_path, "w") as out:
        for p in sorted(globmod.glob(session_glob)):
            for mo in moments_from_session(p):
                counts[mo["label"]] = counts.get(mo["label"], 0) + 1
                out.write(json.dumps(mo) + "\n")
    return counts


def selftest():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        msg = lambda m: json.dumps({"type": "message", "message": m}) + "\n"
        with open(p, "w") as f:
            f.write(msg({"role": "user", "content": [{"type": "text", "text": "fix the bug"}]}))
            # a READ result carrying the true tag — MUST land in the next edit's prefix
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "r", "name": "read", "arguments": {"path": "f"}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "r", "isError": False, "content": [
                {"type": "text", "text": "[f#A1B2]\n1:hello"}]}))
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "a", "name": "edit", "arguments": {"input": "[f#mossy]..."}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "a", "isError": True, "content": [
                {"type": "text", "text": 'bad patch line 2: "[f#main]" before any [path#TAG] header'}]}))
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "b", "name": "edit", "arguments": {"input": "[f#A1B2]..."}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "b", "isError": False, "content": [
                {"type": "text", "text": "applied 1 hunk"}]}))
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "c", "name": "bash", "arguments": {"command": "ls"}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "c", "isError": True, "content": [
                {"type": "text", "text": "bash exploded"}]}))
        mos = list(moments_from_session(p))
        assert [m["label"] for m in mos] == ["CONFAB", "CLEAN"], mos
        # the read output (with the real tag) MUST be in the confab moment's prefix
        ctx_text = " ".join(c["text"] for c in mos[0]["context"])
        assert "[f#A1B2]" in ctx_text, "tool result carrying the true tag must survive into context"
        assert any(c["role"] == "tool" for c in mos[0]["context"]), "tool results included"
        assert "sdir" in mos[0], "moment carries its session-dir for model attribution"
        # bash errors and unmatched classes are excluded
        out = os.path.join(td, "o.jsonl")
        counts = run(os.path.join(td, "*.jsonl"), out)
        assert counts == {"CONFAB": 1, "CLEAN": 1}, counts
    print("extract_moments selftest: OK (labels, context boundary, non-edit exclusion)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        args = [a for a in sys.argv[1:] if not a.startswith("-")]
        out = sys.argv[sys.argv.index("-o") + 1] if "-o" in sys.argv else "moments.jsonl"
        if not args:
            raise SystemExit("usage: extract_moments.py <sessions_glob> -o out.jsonl | --selftest")
        print(json.dumps(run(args[0], out)))
