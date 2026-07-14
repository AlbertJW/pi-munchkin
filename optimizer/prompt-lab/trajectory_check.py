#!/usr/bin/env python3
"""trajectory_check: assert the agent took a SANE PATH, not just that the final
state passed. A gate that scores only the end file state can be fooled by a lucky
broken trajectory — the model infers an answer it never actually derived (Pydantic
Evals' HasMatchingSpan point, 2026-07-14 disposition). This asserts against the
session jsonl (the tool sequence the agent actually ran), per task.

Currently the sharp case is `bigdata` (the map-reduce task): a 305KB JSONL query
that MUST be answered by scanning the whole file. A model that reads head/tail and
guesses can hit the recomputing grader by luck; the trajectory assertion requires a
real full-file scan (rg/awk/wc/jq/python over the data dir), not a peek.

Grader-integrity feature (like t2-check.mjs), not an A/B candidate: TRAJECTORY=on
in real_gate ANDs this into the gate. Run base off-vs-on once and the pass-rate
delta IS the lucky-pass rate; adopt as default if material.

  trajectory_check.py <workdir> <task>   # exit 0 = sane path (or no rule), 1 = violated
  trajectory_check.py --selftest
"""
import json, os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ab-machinery"))
from metrics import session_file_for  # reuse the exact workdir->session resolution  # noqa: E402

# A full-file scan: a streaming/aggregating tool over a path, NOT a bounded peek.
SCAN_RE = re.compile(r"\b(rg|grep|awk|wc|jq|sort|uniq|python3?|node)\b")
PEEK_ONLY_RE = re.compile(r"\b(head|tail|sed\s+-n|less|more)\b")


def _bash_commands(msgs):
    for m in msgs:
        if m.get("role") != "assistant":
            continue
        for c in m.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "toolCall" and (c.get("name") or "").lower() == "bash":
                yield str((c.get("arguments") or {}).get("command", ""))


def check_bigdata(msgs):
    """Pass iff SOME bash command scans the data file (not merely peeks). A run that
    only ever head/tail'd the data and still passed the grader was lucky."""
    scanned_data = False
    for cmd in _bash_commands(msgs):
        if "data/" not in cmd and "data" not in cmd.split("/"):
            # be lenient: many scans name the file directly (e.g. *.jsonl)
            if ".jsonl" not in cmd and "data" not in cmd:
                continue
        if SCAN_RE.search(cmd):
            scanned_data = True
            break
    if scanned_data:
        return True, "scanned the data file"
    return False, "no full-file scan of the data — answer likely inferred from a head/tail peek"


CHECKS = {"bigdata": check_bigdata}


def load_msgs(session_path):
    msgs = []
    for line in open(session_path):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "message":
            msgs.append(d["message"])
    return msgs


def check(workdir, task):
    """(ok, reason). No rule for a task -> ok (the check only ever ADDS strictness)."""
    fn = CHECKS.get(task)
    if fn is None:
        return True, "no trajectory rule for this task"
    session = session_file_for(workdir)
    if not session:
        return True, "no session found — cannot assert trajectory, fail open"
    return fn(load_msgs(session))


def selftest():
    def msgs_with(cmds):
        return [{"role": "assistant", "content": [
            {"type": "toolCall", "name": "bash", "arguments": {"command": c}}]} for c in cmds]

    # scanned the whole file -> pass
    ok, _ = check_bigdata(msgs_with(["wc -l data/big.jsonl", "cat src/index.js"]))
    assert ok
    ok, _ = check_bigdata(msgs_with(["python3 -c 'import json; [json.loads(l) for l in open(\"data/big.jsonl\")]'"]))
    assert ok
    ok, _ = check_bigdata(msgs_with(["rg 'error' data/big.jsonl | wc -l"]))
    assert ok

    # only peeked -> FAIL (the lucky-trajectory case)
    ok, why = check_bigdata(msgs_with(["head -20 data/big.jsonl", "sed -n '1,5p' data/big.jsonl"]))
    assert not ok and "peek" in why, why
    # no data interaction at all -> FAIL
    ok, _ = check_bigdata(msgs_with(["ls", "cat package.json"]))
    assert not ok

    # unknown task -> always ok (only adds strictness where a rule exists)
    ok, why = check("/nonexistent/wd", "t1")
    assert ok and "no trajectory rule" in why
    print("trajectory_check selftest: OK (bigdata scan-vs-peek, no-rule pass-through)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif len(sys.argv) >= 3:
        ok, why = check(sys.argv[1], sys.argv[2])
        if not ok:
            sys.stderr.write(f"[trajectory] {sys.argv[2]}: {why}\n")
        sys.exit(0 if ok else 1)
    else:
        raise SystemExit("usage: trajectory_check.py <workdir> <task> | --selftest")
