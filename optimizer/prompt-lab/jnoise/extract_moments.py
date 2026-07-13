#!/usr/bin/env python3
"""extract_moments: build the labeled confabulation corpus for the jlens phase-0
discrimination study. Walks archived pi session JSONLs, finds every hashline
`edit` tool call, and labels it by its tool result:

  CONFAB       — invented/malformed [path#TAG] header ("bad patch line ... before
                 any [path#TAG] header" / "unknown tag"): epistemic guessing.
  STALE        — "stale tag": NOT confabulation — a legitimate concurrent change
                 (an earlier edit landing between read and edit) produces this
                 without any guessing (audit 2026-07-13). Excluded from the
                 primary study.
  CONFAB_EXACT — builtin-edit exact-match failure ("Could not find the exact
                 text"): old_string invention (lc-on arm-1 class).
  CLEAN        — edit applied without error: the control, same task structure.

Emits one JSONL row per moment: {session, sdir, turn, label, sublabel,
call_args, context: [{role, text}...], context_full_chars, context_truncated}
where context is the conversation UP TO the call, TOTAL-BUDGETED (see
PREFIX_BUDGET below) so it fits a real model's window at scoring time. Context
INCLUDES tool results (role "tool"), individually head-capped to TOOLRESULT_CAP
chars — the correct hashline tag lives in the prior `read` OUTPUT (a tool
result), so a prefix without it destroys the tag-copy signal for both classes
(would false-reject jlens). Still omitted: pi's builtin system prompt + tool
schemas (a consistent distortion across classes).

PREFIX BUDGET: a real session can carry dozens of tool results; teacher-forcing
that unbounded would overflow a 16k-ctx model, and naive tail-truncation could
silently cut the one read that carries the tag. truncate_context() ALWAYS
preserves the most recent TARGET-relevant tag-bearing tool result, fills the
rest newest-first, and HARD-CAPS the total: when the must-keep suffix alone
exceeds the budget it is trimmed from the front down to the tag message + the
newest messages that fit (audit 2026-07-13 — the previous "keep the whole
suffix" rule could exceed the budget unboundedly).

CONFAB SUB-CLASSIFICATION (file-matched — audit 2026-07-13): a CONFAB is
CONFAB_COPY only when a prior tool result carries a tag header FOR THE FILE THE
EDIT TARGETS (path match, basename-tolerant) — the model saw the right tag for
the right file and typed a different one (the study's primary claim). Any tag
for some OTHER file does not count: that is CONFAB_BLIND (invention). An edit
whose target path can't be parsed is BLIND (the copy premise can't be
established). score_moments.analyze studies CONFAB_COPY as primary and reports
CONFAB_BLIND / STALE / CONFAB_EXACT separately.

  ./extract_moments.py <sessions_glob> -o moments.jsonl
  ./extract_moments.py --selftest
"""
import glob as globmod
import json, os, re, sys

CONFAB_PATTERNS = ["before any [path#TAG] header", "unknown tag"]
STALE_PATTERNS = ["stale tag"]
CONFAB_EXACT_PATTERNS = ["Could not find the exact text"]
# Head-cap tool-result text kept in the prefix: the `[path#TAG]` header sits at
# the TOP of a hashline read, so the head preserves the copy target while
# bounding any single message.
TOOLRESULT_CAP = int(os.environ.get("JNOISE_TOOLRESULT_CAP", "2500"))
# Total prefix budget (chars) after assembling the full context — conservative
# for a 16k-token local model (~4 chars/token -> ~3k tokens, leaving headroom
# for pi's system prompt + tool schemas + the call itself + generation).
PREFIX_BUDGET = int(os.environ.get("JNOISE_PREFIX_BUDGET", "12000"))

TAG_HEADER_RE = re.compile(r"\[([^\[\]#]+)#[0-9A-Za-z\-]+\]")


def tag_paths(text):
    """Paths that appear in [path#TAG] headers in this text."""
    return {m.group(1) for m in TAG_HEADER_RE.finditer(text)}


def has_tag_header(text):
    return bool(TAG_HEADER_RE.search(text))


def edit_target_path(call_args):
    """The file the edit call targets: the first [path#TAG] header in its input.
    None when unparseable — the copy premise can't be established then."""
    if not isinstance(call_args, dict):
        return None
    m = TAG_HEADER_RE.search(str(call_args.get("input", "")))
    return m.group(1) if m else None


def _same_file(a, b):
    return a == b or os.path.basename(a) == os.path.basename(b)


def saw_tag_for(context, target):
    """True iff some prior tool result carries a tag header FOR the target file."""
    if not target:
        return False
    return any(c["role"] == "tool" and any(_same_file(p, target) for p in tag_paths(c["text"]))
               for c in context)


def truncate_context(context, budget=PREFIX_BUDGET, target=None):
    """Budget the context to AT MOST `budget` total chars without dropping the most
    recent tag-bearing tool result relevant to `target` (any tag-bearing tool result
    when target is None) — that message is the ground truth for whether a copy
    failure was possible. Newest messages win the remaining space. If even the tag
    message + newest messages exceed the budget, newest messages are dropped before
    the tag message; the tag message itself is never dropped (it is already
    head-capped at TOOLRESULT_CAP, far under any sane budget)."""
    total = sum(len(c["text"]) for c in context)
    if total <= budget:
        return context
    tag_idx = None
    for i, c in enumerate(context):
        if c["role"] == "tool" and (target is None and has_tag_header(c["text"])
                                    or target is not None and any(_same_file(p, target) for p in tag_paths(c["text"]))):
            tag_idx = i
    kept_idx = set()
    used = 0
    if tag_idx is not None:
        kept_idx.add(tag_idx)
        used = len(context[tag_idx]["text"])
    for i in range(len(context) - 1, -1, -1):  # newest first
        if i in kept_idx:
            continue
        n = len(context[i]["text"])
        if used + n > budget:
            continue  # skip what doesn't fit; keep trying smaller/newer pieces
        kept_idx.add(i)
        used += n
    return [context[i] for i in sorted(kept_idx)]


def classify_error(text):
    if any(p in text for p in CONFAB_PATTERNS):
        return "CONFAB"
    if any(p in text for p in STALE_PATTERNS):
        return "STALE"
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
                    full_ctx = list(context)
                    target = edit_target_path(c.get("arguments"))
                    sublabel = None
                    if label == "CONFAB":
                        sublabel = "CONFAB_COPY" if saw_tag_for(full_ctx, target) else "CONFAB_BLIND"
                    bounded = truncate_context(full_ctx, target=target)
                    full_chars = sum(len(x["text"]) for x in full_ctx)
                    # parent dir name = munged workdir -> carries GEN-MODEL-arm-task-rep
                    yield {"session": os.path.basename(path), "sdir": os.path.basename(os.path.dirname(path)),
                           "turn": turn, "label": label, "sublabel": sublabel,
                           "call_args": c.get("arguments"), "context": bounded,
                           "context_full_chars": full_chars, "context_truncated": len(bounded) < len(full_ctx)}
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
                key = mo["sublabel"] or mo["label"]  # CONFAB_COPY/CONFAB_BLIND, else the plain label
                counts[key] = counts.get(key, 0) + 1
                out.write(json.dumps(mo) + "\n")
    return counts


def selftest():
    import tempfile
    msg = lambda m: json.dumps({"type": "message", "message": m}) + "\n"
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        with open(p, "w") as f:
            f.write(msg({"role": "user", "content": [{"type": "text", "text": "fix the bug"}]}))
            # a READ result carrying the true tag FOR f — MUST land in the next edit's prefix
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
        # a prior tag FOR THE TARGET FILE -> COPY failure, not blind invention
        assert mos[0]["sublabel"] == "CONFAB_COPY", mos[0]["sublabel"]
        assert mos[1]["sublabel"] is None, "CLEAN carries no sublabel"
        # bash errors and unmatched classes are excluded
        out = os.path.join(td, "o.jsonl")
        counts = run(os.path.join(td, "*.jsonl"), out)
        assert counts == {"CONFAB_COPY": 1, "CLEAN": 1}, counts

    # FILE-MATCHED (audit): a prior tag for a DIFFERENT file must NOT rescue a
    # blind invention on the target file into COPY.
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        with open(p, "w") as f:
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "r", "name": "read", "arguments": {"path": "other.js"}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "r", "isError": False, "content": [
                {"type": "text", "text": "[other.js#C3D4]\n1:hi"}]}))
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "a", "name": "edit", "arguments": {"input": "[main.js#FFFF]..."}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "a", "isError": True, "content": [
                {"type": "text", "text": 'bad patch line 1: "[main.js#FFFF]" before any [path#TAG] header'}]}))
        mo = next(iter(moments_from_session(p)))
        assert mo["sublabel"] == "CONFAB_BLIND", f"other-file tag must not make COPY: {mo['sublabel']}"

    # CONFAB with NO prior tag-bearing read at all -> BLIND
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        with open(p, "w") as f:
            f.write(msg({"role": "user", "content": [{"type": "text", "text": "add a helper"}]}))
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "a", "name": "edit", "arguments": {"input": "[new#0000]..."}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "a", "isError": True, "content": [
                {"type": "text", "text": 'bad patch line 1: "[new#0000]" before any [path#TAG] header'}]}))
        mo = next(iter(moments_from_session(p)))
        assert mo["label"] == "CONFAB" and mo["sublabel"] == "CONFAB_BLIND", mo

    # STALE is its own label, not confabulation (audit)
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        with open(p, "w") as f:
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "a", "name": "edit", "arguments": {"input": "[f#A1B2]..."}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "a", "isError": True, "content": [
                {"type": "text", "text": "stale tag A1B2 for f — re-read the file"}]}))
        mo = next(iter(moments_from_session(p)))
        assert mo["label"] == "STALE" and mo["sublabel"] is None, mo

    # truncate_context: budget forces truncation but never drops the target's tag message
    ctx = [
        {"role": "user", "text": "x" * 500},                 # old, prunable
        {"role": "tool", "text": f"[f#TAG1]\n{'y' * 50}"},   # must-keep (tag for target f)
        {"role": "assistant", "text": "z" * 100},
    ]
    out = truncate_context(ctx, budget=300, target="f")
    assert any("[f#TAG1]" in c["text"] for c in out), "must-keep tag message survived truncation"
    assert not any(c["text"].startswith("x") for c in out), "old prunable turn dropped to make room"
    assert sum(len(c["text"]) for c in out) <= 300, "budget respected"

    # HARD CAP (audit): even when the post-tag suffix is huge, the total NEVER
    # exceeds the budget — newest-that-fits wins, the tag message is kept.
    big_ctx = [
        {"role": "user", "text": "x" * 5000},
        {"role": "tool", "text": f"[f#TAG1]\n{'y' * 500}"},
        {"role": "assistant", "text": "z" * 9000},           # oversized suffix
        {"role": "tool", "text": "w" * 800},                 # newer, small — should fit
    ]
    out2 = truncate_context(big_ctx, budget=4000, target="f")
    assert sum(len(c["text"]) for c in out2) <= 4000, "hard cap holds even with a huge suffix"
    assert any("[f#TAG1]" in c["text"] for c in out2), "tag message survives the hard cap"
    assert any(c["text"].startswith("w") for c in out2), "newest small message kept"
    assert not any(c["text"].startswith("z") for c in out2), "oversized suffix dropped, not the tag"

    # relative order is preserved after truncation
    assert [c["text"][:1] for c in out2] == [c["text"][:1] for c in big_ctx if any(
        c is k for k in out2)], "kept messages stay in original order"

    # a budget that already fits everything must be a no-op (identity, not a copy-with-loss)
    small = [{"role": "user", "text": "hi"}]
    assert truncate_context(small, budget=1000) == small

    print("extract_moments selftest: OK (labels incl. STALE, file-matched COPY/BLIND, "
          "context boundary, hard-capped prefix budget, non-edit exclusion)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        args = [a for a in sys.argv[1:] if not a.startswith("-")]
        out = sys.argv[sys.argv.index("-o") + 1] if "-o" in sys.argv else "moments.jsonl"
        if not args:
            raise SystemExit("usage: extract_moments.py <sessions_glob> -o out.jsonl | --selftest")
        print(json.dumps(run(args[0], out)))
