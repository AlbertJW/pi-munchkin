#!/usr/bin/env python3
"""Harness overhead ROI meter — blurman-ai's "compression must exceed 1.0",
applied to the harness itself (from the LLM-Wiki gist, 2026-07-15).

We already count HOW OFTEN the mechanisms fire (metrics.py lb_fires/vg_fires).
This asks the missing question: what does the steering COST? Each steer/block
site now logs `injected_chars` (the size of the text it injects) into the
telemetry row (~/.pi/agent/lib/telemetry.ts events). This reporter joins those
events to gate result rows by session key and reports, per model and split by
pass/fail, how large the harness's injected footprint is relative to the model's
own output.

Join key: the telemetry `sk` IS the gate workdir basename
`{GEN}-{RUNID}-{MODEL}-{pattern}-{task}-{rep}` (real_gate.sh:193). GEN is the
results-file stem; RUNID is row["run"]. Result rows already embed the per-session
metrics (in_tok/out_tok/out_chars/token_usage_exact) that ab-machinery/metrics.py
produces, so no session-file access is needed for the join.

ponytail: char footprint is the always-available signal (local llama.cpp sessions
record no exact usage). Token overhead is a single-injection LOWER BOUND — a steer
is re-read every subsequent turn under prompt cache, so true amortized cost is
higher. Exact per-turn attribution is the deferred U3b upgrade; not built here.

Usage:  harness_roi.py <results.jsonl> [more.jsonl ...]   # per-model, pass/fail
        harness_roi.py --events-only                       # just aggregate events
        harness_roi.py --selftest
        (env TELEMETRY_FILE overrides the events path, as in telemetry.ts)
"""
from __future__ import annotations

import collections
import json
import os
import sys

# Steer/block sites that inject text and now carry injected_chars. Pure count
# events (skipped/passed/gate) are not injections and are excluded from cost.
INJECTING_KINDS = {
    ("loop-breaker", "steer"), ("loop-breaker", "outcome-steer"),
    ("verify-gate", "steer"), ("micro-gate", "fired"),
}
CHARS_PER_TOKEN = 4  # crude proxy; only used when exact usage is absent-or-present alike


def events_path() -> str:
    return os.environ.get("TELEMETRY_FILE") or os.path.expanduser("~/.pi/agent/telemetry/events.jsonl")


def load_events(path: str) -> dict:
    """Per-sk aggregate: {sk: {"injected_chars": int, "fires": Counter(ext.kind)}}."""
    agg: dict = collections.defaultdict(lambda: {"injected_chars": 0, "fires": collections.Counter()})
    if not os.path.isfile(path):
        return agg
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            sk = d.get("sk")
            if not sk:
                continue
            key = (d.get("ext"), d.get("kind"))
            if key in INJECTING_KINDS:
                agg[sk]["injected_chars"] += int(d.get("injected_chars") or 0)
                agg[sk]["fires"][f"{key[0]}.{key[1]}"] += 1
    return agg


def _exact(row: dict) -> bool:
    return (row.get("usage") or {}).get("exact", row.get("token_usage_exact")) is True


def _row_sk(gen: str, row: dict) -> str:
    return f"{gen}-{row.get('run')}-{row.get('model')}-{row.get('pattern')}-{row.get('task')}-{row.get('rep')}"


def load_rows(paths: list[str]) -> list[dict]:
    out = []
    for p in paths:
        gen = os.path.basename(p)[:-len(".jsonl")] if p.endswith(".jsonl") else os.path.basename(p)
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                r["_sk"] = _row_sk(gen, r)
                out.append(r)
    return out


def report(paths: list[str]) -> None:
    events = load_events(events_path())
    rows = load_rows(paths)
    if not rows:
        print("no result rows found"); return

    total_inj = sum(v["injected_chars"] for v in events.values())
    matched = sum(1 for r in rows if r["_sk"] in events)
    print(f"== harness ROI ==  rows={len(rows)}  telemetry-matched={matched}  "
          f"events-total-injected-chars={total_inj}")
    if total_inj == 0:
        print("  note: 0 injected_chars across telemetry — no sessions have run since the\n"
              "        injected_chars instrumentation landed. Run a gate/session to populate.")

    by_model: dict = collections.defaultdict(list)
    for r in rows:
        by_model[r.get("model")].append(r)

    print(f"\n{'model':30} {'sess':>4} {'p/f':>7} {'inj_chars':>10} {'char_ftp%':>9} "
          f"{'tok_ovh%':>8}  fires")
    for model in sorted(by_model, key=lambda m: (m is None, m)):
        mr = by_model[model]
        inj = out_chars = 0
        exact_inj = exact_tok = 0
        n_exact = 0
        fires: collections.Counter = collections.Counter()
        npass = 0
        pf_inj = {True: 0, False: 0}
        pf_out = {True: 0, False: 0}
        for r in mr:
            ev = events.get(r["_sk"])
            ic = ev["injected_chars"] if ev else 0
            oc = int(r.get("out_chars") or 0) + int(r.get("think_chars") or 0)
            passed = r.get("score") == 1
            npass += int(passed)
            inj += ic; out_chars += oc
            pf_inj[passed] += ic; pf_out[passed] += oc
            if ev:
                fires.update(ev["fires"])
            if _exact(r):
                n_exact += 1
                exact_inj += ic
                exact_tok += int(r.get("in_tok") or 0) + int(r.get("out_tok") or 0)
        char_ftp = (100 * inj / out_chars) if out_chars else 0.0
        tok_ovh = (100 * (exact_inj / CHARS_PER_TOKEN) / exact_tok) if exact_tok else None
        fires_s = " ".join(f"{k}={v}" for k, v in sorted(fires.items())) or "-"
        print(f"{str(model):30} {len(mr):>4} {str(npass)+'/'+str(len(mr)-npass):>7} "
              f"{inj:>10} {char_ftp:>8.2f}% {(f'{tok_ovh:.2f}%' if tok_ovh is not None else 'n/a'):>8}  {fires_s}")
        # pass/fail footprint split (char proxy — always available)
        for p in (True, False):
            if pf_out[p]:
                lbl = "pass" if p else "fail"
                print(f"{'  · '+lbl:30} {'':>4} {'':>7} {pf_inj[p]:>10} "
                      f"{100*pf_inj[p]/pf_out[p]:>8.2f}% {'':>8}")
    print("\nchar_ftp% = injected steer chars / model output chars (always available).")
    print(f"tok_ovh%  = est injected tokens (chars/{CHARS_PER_TOKEN}) / session tokens, EXACT-usage rows only;\n"
          "            a single-injection lower bound (ignores per-turn cache re-reads).")


def events_only() -> None:
    events = load_events(events_path())
    tot = sum(v["injected_chars"] for v in events.values())
    fires: collections.Counter = collections.Counter()
    for v in events.values():
        fires.update(v["fires"])
    print(f"== telemetry events ==  sessions={len(events)}  total-injected-chars={tot}")
    for k, v in sorted(fires.items()):
        print(f"  {k:28} {v}")
    print("\ntop sessions by injected chars:")
    for sk, v in sorted(events.items(), key=lambda kv: -kv[1]["injected_chars"])[:10]:
        if v["injected_chars"]:
            print(f"  {v['injected_chars']:>8}  {sk}")


def selftest() -> None:
    import tempfile
    # Reuse ab-machinery/metrics.py to produce the token fields exactly as real_gate
    # does, proving the row fields we consume ARE metrics.parse_session's output.
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ab-machinery"))
    from metrics import parse_session  # noqa: E402

    sess = [
        json.dumps({"type": "message", "message": {"role": "assistant", "usage": {"input": 100, "output": 40},
                    "content": [{"type": "text", "text": "x" * 40}]}}),
    ]
    m = parse_session(sess)
    assert m["usage_exact"] == 1 and m["in_tok"] == 100 and m["out_tok"] == 40

    gen = "g0"
    def row(run, model, pat, task, rep, score, exact=True):
        r = {"run": run, "model": model, "pattern": pat, "task": task, "rep": rep,
             "score": score, "out_chars": 400, "think_chars": 0}
        if exact:
            r.update(in_tok=m["in_tok"], out_tok=m["out_tok"], token_usage_exact=True)
        else:
            r.update(in_tok=0, out_tok=0, token_usage_exact=False)
        return r
    rows = [row("r1", "M", "base", "a", 1, 1), row("r1", "M", "base", "b", 1, 0),
            row("r1", "M", "base", "c", 1, 1, exact=False)]

    with tempfile.TemporaryDirectory() as td:
        tel = os.path.join(td, "events.jsonl")
        with open(tel, "w") as fh:
            # session a: two steers (100 + 60 chars); session b: one steer (200);
            # session c: a NON-injecting event only (must contribute 0 injected).
            def sk(r): return _row_sk(gen, r)
            fh.write(json.dumps({"sk": sk(rows[0]), "ext": "loop-breaker", "kind": "steer", "injected_chars": 100}) + "\n")
            fh.write(json.dumps({"sk": sk(rows[0]), "ext": "verify-gate", "kind": "steer", "injected_chars": 60}) + "\n")
            fh.write(json.dumps({"sk": sk(rows[1]), "ext": "micro-gate", "kind": "fired", "injected_chars": 200}) + "\n")
            fh.write(json.dumps({"sk": sk(rows[2]), "ext": "verify-gate", "kind": "unverified-end", "injected_chars": 999}) + "\n")
        os.environ["TELEMETRY_FILE"] = tel
        ev = load_events(tel)
        # exact sk-join, no cross-session leakage
        assert ev[sk(rows[0])]["injected_chars"] == 160, ev[sk(rows[0])]
        assert ev[sk(rows[1])]["injected_chars"] == 200
        # non-injecting kind (unverified-end) contributes 0 even with an injected_chars field
        assert sk(rows[2]) not in ev, "non-injecting event must not create an injecting session"
        # 0-fire sanity: a session with no events has no entry → treated as 0 downstream
        assert "g0-r9-M-base-z-1" not in ev
    print("harness_roi selftest: OK (sk-join exactness, injecting-kind filter, 0-fire, metrics lineage)")


def main() -> None:
    args = [a for a in sys.argv[1:]]
    if "--selftest" in args:
        selftest(); return
    if "--events-only" in args:
        events_only(); return
    paths = [a for a in args if not a.startswith("-")]
    if not paths:
        raise SystemExit("usage: harness_roi.py <results.jsonl> [...] | --events-only | --selftest")
    report(paths)


if __name__ == "__main__":
    main()
