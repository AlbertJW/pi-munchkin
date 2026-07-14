#!/usr/bin/env python3
"""gauntlet_report: fault x model recovery table from gauntlet.sh runs.

Per (model, fault) row:
  recovered   — gate passed despite the fault (the headline metric)
  injected    — the chaos fault demonstrably fired (telemetry chaos.injected);
                a recovery claim without an injection is a broken run, flagged
  turns_to_rec— assistant turns from the injected fault observation to the next
                CLEAN call of the faulted tool (None = never recovered the tool)
  lb          — loop-breaker events in the session (steers + aborts)
  aborted     — outcome-abort fired; on a recoverable fault with recovered=0
                this is counted as a FALSE ABORT candidate

  ./gauntlet_report.py <gen_prefix>            # e.g. gt1
  ./gauntlet_report.py --selftest
"""
import collections, glob, json, os, sys

LAB = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(LAB, "results")
TELEMETRY = os.environ.get("TELEMETRY_FILE", os.path.expanduser("~/.pi/agent/telemetry/events.jsonl"))
SESSIONS = os.environ.get("PI_SESSIONS_DIR", os.path.expanduser("~/.pi/agent/sessions"))

# mirror of gauntlet.sh's FAULT_TABLE: fault -> (faulted tool, detection snippet)
CHAOS_FAULTS = {
    "perm-denied": ("edit", "EACCES"),
    "stale-tag": ("edit", "stale tag"),
    "missing-file": ("read", "ENOENT"),
    "disconnect": ("bash", "connection reset"),
    "edit-noop": ("edit", "no changes applied"),
}
DECEPTION_FAULTS = ("lying", "ghost")


def _msgs(session_path):
    out = []
    for line in open(session_path):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "message":
            out.append(d["message"])
    return out


def _text(m):
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(x.get("text", "") for x in c if isinstance(x, dict))
    return ""


def turns_to_recovery(session_path, tool, snippet):
    """Assistant turns between the injected fault result and the next CLEAN result
    of the same tool. None if the tool never succeeds again after the fault."""
    msgs = _msgs(session_path)
    # map toolCallId -> tool name from assistant calls
    call_tool = {}
    for m in msgs:
        if m.get("role") == "assistant":
            for c in m.get("content") or []:
                if isinstance(c, dict) and c.get("type") == "toolCall":
                    call_tool[c.get("id")] = c.get("name")
    injected_at = None
    turns = 0
    for m in msgs:
        role = m.get("role")
        if role == "assistant" and injected_at is not None:
            turns += 1
        if role not in ("toolResult", "tool"):
            continue
        tid = m.get("toolCallId") or m.get("tool_call_id")
        err = bool(m.get("isError")) or any(
            isinstance(c, dict) and c.get("isError") for c in (m.get("content") or []))
        if injected_at is None:
            if err and snippet in _text(m):
                injected_at = True
        elif call_tool.get(tid) == tool and not err:
            return turns
    return None


def session_for(gen, run, task, rep, sessions_dir=SESSIONS):
    """The session jsonl for ONE gauntlet row. Workdir basenames carry
    $GEN-$RUNID-$MODEL-$pat-$task-$rep — gen+run alone can't separate reps
    (audit-2: N>1 rows all matched the same glob)."""
    pats = glob.glob(os.path.join(sessions_dir, f"*{gen}-{run}*-{task}-{rep}*", "*.jsonl"))
    return sorted(pats)[-1] if pats else None


def telemetry_counts(sk_exact, telemetry_file=TELEMETRY):
    """EXACT sk match (audit-3): one gate invocation shares one run id across all
    reps, so a gen-run PREFIX pooled every rep's events — one rep's injection could
    validate another, uninjected rep. sk is the full workdir basename
    {gen}-{run}-{model}-{pattern}-{task}-{rep}; rows carry every component."""
    counts = collections.Counter()
    if not os.path.exists(telemetry_file):
        return counts
    for line in open(telemetry_file):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("sk") == sk_exact:
            counts[f"{e.get('ext', '?')}.{e.get('kind', '?')}"] += 1
    return counts


def report(gen_prefix, results_dir=RESULTS, telemetry_file=TELEMETRY, sessions_dir=SESSIONS):
    """[(model, fault, rowdict)] for every gauntlet gen under the prefix."""
    global SESSIONS
    rows_out = []
    for path in sorted(glob.glob(os.path.join(results_dir, f"{gen_prefix}-*.jsonl"))):
        gen = os.path.basename(path)[:-6]
        fault = gen.rsplit("-", 1)[-1]
        known = fault in CHAOS_FAULTS or fault in DECEPTION_FAULTS or fault == "control"
        if not known:  # e.g. "gt1-<model>-stale-tag" splits wrong on single dash
            for f in list(CHAOS_FAULTS) + list(DECEPTION_FAULTS) + ["control"]:
                if gen.endswith("-" + f):
                    fault = f
                    break
            else:
                continue
        model_part = gen[len(gen_prefix) + 1: -(len(fault) + 1)]
        for r in (json.loads(l) for l in open(path) if l.strip()):
            run = r.get("run", "")
            sk = f"{gen}-{run}-{r.get('model')}-{r.get('pattern')}-{r.get('task')}-{r.get('rep')}"
            tel = telemetry_counts(sk, telemetry_file)
            d = {"recovered": r["score"], "injected": tel.get("chaos.injected", 0),
                 "lb": sum(v for k, v in tel.items() if k.startswith("loop-breaker.")),
                 "aborted": sum(v for k, v in tel.items() if k.endswith("outcome-abort")),
                 "turns_to_rec": None, "tokens": r.get("in_tok", 0) + r.get("out_tok", r.get("out_chars", 0)),
                 "task": r.get("task"), "rep": r.get("rep")}
            if fault in CHAOS_FAULTS:
                tool, snippet = CHAOS_FAULTS[fault]
                sp = session_for(gen, run, r.get("task"), r.get("rep"), sessions_dir)
                if sp:
                    d["turns_to_rec"] = turns_to_recovery(sp, tool, snippet)
                # integrity: a chaos row without an injection measured nothing
                d["valid"] = d["injected"] >= 1
                d["false_abort"] = bool(d["aborted"]) and not d["recovered"]
            else:
                d["valid"] = True
                d["false_abort"] = False
            rows_out.append((model_part, fault, d))
    return rows_out


def render(rows):
    """Aggregates per (model, fault) across reps — audit-2: keying a dict by fault
    silently kept only the LAST rep, so N>1 reported one observation as the result."""
    order = ["control"] + list(CHAOS_FAULTS) + list(DECEPTION_FAULTS)
    by_model = collections.defaultdict(lambda: collections.defaultdict(list))
    for model, fault, d in rows:
        by_model[model][fault].append(d)
    for model, faults in sorted(by_model.items()):
        print(f"\n== {model}")
        for f in order:
            ds = faults.get(f)
            if not ds:
                continue
            valid = [d for d in ds if d["valid"]]
            n_inv = len(ds) - len(valid)
            rec = sum(d["recovered"] for d in valid)
            bits = [f"recovered={rec}/{len(valid)}"]
            if f in CHAOS_FAULTS:
                inj = sum(1 for d in valid if d["injected"])
                bits.append(f"injected={inj}/{len(valid)}")
                turns = sorted(d["turns_to_rec"] for d in valid if d["turns_to_rec"] is not None)
                bits.append(f"turns_to_rec={turns if turns else None}")
                fa = sum(1 for d in valid if d["false_abort"])
                if fa:
                    bits.append(f"FALSE-ABORT x{fa}")
            lb = sum(d["lb"] for d in valid)
            if lb:
                bits.append(f"lb={lb}")
            toks = [d["tokens"] for d in valid]
            if toks:
                bits.append(f"tok(mean)={sum(toks) // len(toks)}")
            flag = f"  [{n_inv} INVALID rep(s): fault never fired]" if n_inv else ""
            print(f"   {f:13} {'  '.join(bits)}{flag}")


def selftest():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        rdir = os.path.join(td, "results"); os.makedirs(rdir)
        sdir = os.path.join(td, "sessions"); os.makedirs(sdir)
        tel = os.path.join(td, "tel.jsonl")
        # one chaos row: stale-tag on edit, run abc123, recovered
        with open(os.path.join(rdir, "gt0-m1-stale-tag.jsonl"), "w") as f:
            f.write(json.dumps({"task": "t1", "pattern": "base", "rep": 1, "model": "m1",
                                "split": "val", "score": 1, "run": "abc123", "in_tok": 10, "out_tok": 5}) + "\n")
        with open(tel, "w") as f:
            f.write(json.dumps({"sk": "gt0-m1-stale-tag-abc123-m1-base-t1-1", "ext": "chaos", "kind": "injected"}) + "\n")
            f.write(json.dumps({"sk": "gt0-m1-stale-tag-abc123-m1-base-t1-1", "ext": "loop-breaker", "kind": "steer"}) + "\n")
        # session: edit fails with the injected stale tag, 2 assistant turns later a clean edit
        sd = os.path.join(sdir, "x-gt0-m1-stale-tag-abc123-m1-base-t1-1"); os.makedirs(sd)
        msg = lambda m: json.dumps({"type": "message", "message": m}) + "\n"
        with open(os.path.join(sd, "s.jsonl"), "w") as f:
            f.write(msg({"role": "assistant", "content": [{"type": "toolCall", "id": "a", "name": "edit"}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "a", "isError": True, "content": [
                {"type": "text", "text": "stale tag: cannot uniquely relocate the edit"}]}))
            f.write(msg({"role": "assistant", "content": [{"type": "toolCall", "id": "r", "name": "read"}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "r", "isError": False, "content": [{"type": "text", "text": "[f#A1B2] ok"}]}))
            f.write(msg({"role": "assistant", "content": [{"type": "toolCall", "id": "b", "name": "edit"}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "b", "isError": False, "content": [{"type": "text", "text": "applied"}]}))
        rows = report("gt0", results_dir=rdir, telemetry_file=tel, sessions_dir=sdir)
        assert len(rows) == 1
        model, fault, d = rows[0]
        assert (model, fault) == ("m1", "stale-tag"), (model, fault)
        assert d["recovered"] == 1 and d["injected"] == 1 and d["valid"] and not d["false_abort"], d
        assert d["turns_to_rec"] == 2, d["turns_to_rec"]  # read-turn + retry-edit-turn
        assert d["lb"] == 1

        # a chaos row whose fault never fired must be flagged INVALID
        with open(os.path.join(rdir, "gt0-m1-disconnect.jsonl"), "w") as f:
            f.write(json.dumps({"task": "t1", "pattern": "base", "rep": 1, "model": "m1",
                                "split": "val", "score": 1, "run": "def456", "in_tok": 1, "out_tok": 1}) + "\n")
        rows = report("gt0", results_dir=rdir, telemetry_file=tel, sessions_dir=sdir)
        d2 = next(d for m, f, d in rows if f == "disconnect")
        assert not d2["valid"], "no chaos.injected event -> invalid row, not a silent success"

        # a false abort: recoverable fault, aborted, not recovered
        with open(os.path.join(rdir, "gt0-m1-perm-denied.jsonl"), "w") as f:
            f.write(json.dumps({"task": "t1", "pattern": "base", "rep": 1, "model": "m1",
                                "split": "val", "score": 0, "run": "ggg789", "in_tok": 1, "out_tok": 1}) + "\n")
        with open(tel, "a") as f:
            f.write(json.dumps({"sk": "gt0-m1-perm-denied-ggg789-m1-base-t1-1", "ext": "chaos", "kind": "injected"}) + "\n")
            f.write(json.dumps({"sk": "gt0-m1-perm-denied-ggg789-m1-base-t1-1", "ext": "loop-breaker", "kind": "outcome-abort"}) + "\n")
        rows = report("gt0", results_dir=rdir, telemetry_file=tel, sessions_dir=sdir)
        d3 = next(d for m, f, d in rows if f == "perm-denied")
        assert d3["false_abort"] and d3["valid"], d3

        # N=2: both reps must survive as separate rows with their OWN sessions
        # (audit-2: dict-keying by fault silently dropped all but the last rep,
        # and the session glob couldn't tell reps apart). Rep 2 gets NO injection
        # event: under the audit-3 exact-sk rule it must be INVALID — the old
        # gen-run PREFIX would have leaked rep 1's injection onto it.
        with open(os.path.join(rdir, "gt0-m1-stale-tag.jsonl"), "a") as f:
            f.write(json.dumps({"task": "t1", "pattern": "base", "rep": 2, "model": "m1",
                                "split": "val", "score": 0, "run": "abc123", "in_tok": 8, "out_tok": 3}) + "\n")
        sd2 = os.path.join(sdir, "x-gt0-m1-stale-tag-abc123-m1-base-t1-2"); os.makedirs(sd2)
        with open(os.path.join(sd2, "s.jsonl"), "w") as f:
            f.write(msg({"role": "assistant", "content": [{"type": "toolCall", "id": "a", "name": "edit"}]}))
            f.write(msg({"role": "toolResult", "toolCallId": "a", "isError": True, "content": [
                {"type": "text", "text": "stale tag: cannot uniquely relocate the edit"}]}))
        rows = report("gt0", results_dir=rdir, telemetry_file=tel, sessions_dir=sdir)
        st = sorted((d["rep"], d["recovered"], d["turns_to_rec"], d["valid"])
                    for m, f2, d in rows if f2 == "stale-tag")
        assert st == [(1, 1, 2, True), (2, 0, None, False)], \
            f"rep-exact telemetry: rep 1 valid, uninjected rep 2 INVALID (no leak): {st}"
    print("gauntlet_report selftest: OK (recovery turns, injection integrity, INVALID flag, "
          "false-abort, N>1 reps kept + per-rep sessions, rep-exact telemetry no-leak)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        args = [a for a in sys.argv[1:] if not a.startswith("-")]
        if not args:
            raise SystemExit("usage: gauntlet_report.py <gen_prefix> | --selftest")
        render(report(args[0]))
