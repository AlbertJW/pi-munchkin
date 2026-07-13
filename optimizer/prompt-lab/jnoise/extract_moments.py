#!/usr/bin/env python3
"""extract_moments: build the labeled confabulation corpus for the jlens phase-0
discrimination study. Walks archived pi session JSONLs, finds every hashline
`edit` tool call, and labels it by its tool result:

  CONFAB       — invented/malformed [path#TAG] header ("bad patch line ... before
                 any [path#TAG] header"): the epistemic-guessing moment.
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

PREFIX BUDGET (critical-priority fix): a real session can carry dozens of tool
results; teacher-forcing that unbounded would overflow a 16k-ctx model, and
naive tail-truncation could silently cut the one read that carries the tag.
truncate_context() ALWAYS preserves the most recent tag-bearing tool result
(and everything after it), then fills backward with as much older context as
the remaining budget allows.

CONFAB SUB-CLASSIFICATION: a CONFAB with a tag-bearing read earlier in its
(full, pre-truncation) context is a genuine COPY failure — the model saw the
right tag and typed a different one (the study's primary claim). A CONFAB
with no prior tag-bearing read is BLIND invention — the model never had a
tag to copy, closer to CONFAB_EXACT than to a copy failure. Recorded in
`sublabel`; score_moments.analyze studies CONFAB_COPY as the primary claim
and reports CONFAB_BLIND separately.

  ./extract_moments.py <sessions_glob> -o moments.jsonl
  ./extract_moments.py --selftest
"""
import glob as globmod
import json, os, re, sys

CONFAB_PATTERNS = ["before any [path#TAG] header", "unknown tag", "stale tag"]
CONFAB_EXACT_PATTERNS = ["Could not find the exact text"]
# Head-cap tool-result text kept in the prefix: the `[path#TAG]` header sits at
# the TOP of a hashline read, so the head preserves the copy target while
# bounding any single message.
TOOLRESULT_CAP = int(os.environ.get("JNOISE_TOOLRESULT_CAP", "2500"))
# Total prefix budget (chars) after assembling the full context — conservative
# for a 16k-token local model (~4 chars/token -> ~3k tokens, leaving headroom
# for pi's system prompt + tool schemas + the call itself + generation).
PREFIX_BUDGET = int(os.environ.get("JNOISE_PREFIX_BUDGET", "12000"))

TAG_HEADER_RE = re.compile(r"\[[^\[\]#]+#[0-9A-Za-z\-]+\]")


def has_tag_header(text):
    return bool(TAG_HEADER_RE.search(text))


def truncate_context(context, budget=PREFIX_BUDGET):
    """Budget the context to `budget` total chars WITHOUT ever dropping the most
    recent tag-bearing tool result — that message is the ground truth for
    whether a copy failure is possible. Everything from that message onward is
    kept; older turns fill backward until the budget is exhausted."""
    total = sum(len(c["text"]) for c in context)
    if total <= budget:
        return context
    last_tag_idx = None
    for i, c in enumerate(context):
        if c["role"] == "tool" and has_tag_header(c["text"]):
            last_tag_idx = i
    must_keep = context[last_tag_idx:] if last_tag_idx is not None else []
    before = context[:last_tag_idx] if last_tag_idx is not None else context
    remaining = budget - sum(len(c["text"]) for c in must_keep)
    kept_before, used = [], 0
    for c in reversed(before):
        n = len(c["text"])
        if used + n > max(remaining, 0):
            break
        kept_before.insert(0, c)
        used += n
    return kept_before + must_keep


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
                    full_ctx = list(context)
                    sublabel = None
                    if label == "CONFAB":
                        had_tag = any(x["role"] == "tool" and has_tag_header(x["text"]) for x in full_ctx)
                        sublabel = "CONFAB_COPY" if had_tag else "CONFAB_BLIND"
                    bounded = truncate_context(full_ctx)
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
        # a prior tag-bearing read -> COPY failure, not blind invention
        assert mos[0]["sublabel"] == "CONFAB_COPY", mos[0]["sublabel"]
        assert mos[1]["sublabel"] is None, "CLEAN carries no sublabel"
        # bash errors and unmatched classes are excluded
        out = os.path.join(td, "o.jsonl")
        counts = run(os.path.join(td, "*.jsonl"), out)
        assert counts == {"CONFAB_COPY": 1, "CLEAN": 1}, counts

    # CONFAB with NO prior tag-bearing read -> BLIND invention (different phenomenon)
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        msg = lambda m: json.dumps({"type": "message", "message": m}) + "\n"
        with open(p, "w") as f:
            f.write(msg({"role": "user", "content": [{"type": "text", "text": "add a helper"}]}))
            f.write(msg({"role": "assistant", "content": [
                {"type": "toolCall", "id": "a", "name": "edit", "arguments": {"input": "[new#0000]..."}}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "a", "isError": True, "content": [
                {"type": "text", "text": 'bad patch line 1: "[new#0000]" before any [path#TAG] header'}]}))
        mo = next(iter(moments_from_session(p)))
        assert mo["label"] == "CONFAB" and mo["sublabel"] == "CONFAB_BLIND", mo

    # truncate_context: budget forces front-truncation but NEVER drops the most
    # recent tag-bearing tool result, even when it isn't the last message.
    ctx = [
        {"role": "user", "text": "x" * 500},        # old, prunable
        {"role": "tool", "text": f"[f#TAG1]\n{'y' * 50}"},   # must-keep (has the tag)
        {"role": "assistant", "text": "z" * 100},    # after the tag -> also must-keep
    ]
    out = truncate_context(ctx, budget=300)
    assert any("[f#TAG1]" in c["text"] for c in out), "must-keep tag message survived truncation"
    assert not any(c["text"].startswith("x") for c in out), "old prunable turn dropped to make room"
    assert sum(len(c["text"]) for c in out) <= 300, "budget respected when must-keep fits under it"

    # when the must-keep span ALONE exceeds the budget, correctness wins: keep it
    # whole rather than truncate the tag out (a hard cap would be worse than useless).
    big_ctx = [
        {"role": "user", "text": "x" * 5000},
        {"role": "tool", "text": f"[f#TAG1]\n{'y' * 3000}"},
        {"role": "assistant", "text": "z" * 4000},
    ]
    out2 = truncate_context(big_ctx, budget=4000)
    assert any("[f#TAG1]" in c["text"] for c in out2), "tag survives even when must-keep exceeds budget"
    assert not any(c["text"].startswith("x") for c in out2), "prunable turn still dropped first"

    # a budget that already fits everything must be a no-op (identity, not a copy-with-loss)
    small = [{"role": "user", "text": "hi"}]
    assert truncate_context(small, budget=1000) == small

    print("extract_moments selftest: OK (labels, sublabel COPY/BLIND, context boundary, prefix budget, non-edit exclusion)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        args = [a for a in sys.argv[1:] if not a.startswith("-")]
        out = sys.argv[sys.argv.index("-o") + 1] if "-o" in sys.argv else "moments.jsonl"
        if not args:
            raise SystemExit("usage: extract_moments.py <sessions_glob> -o out.jsonl | --selftest")
        print(json.dumps(run(args[0], out)))
