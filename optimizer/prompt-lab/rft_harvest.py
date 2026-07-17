#!/usr/bin/env python3
"""rft_harvest: turn gate-PASSING sessions into rejection-fine-tuning data.

The gate already runs N reps per (model, task) and scores each pass/fail against
hidden graders — exactly the accept/reject signal RFT/STaR needs. This collects
the passing runs with provenance and emits one training example per pass:
{messages:[system, user_task, assistant_solution], meta}. Fine-tune a model on
its own (or a stronger model's) survivors -> the harness becomes a data flywheel.

INTEGRITY:
  - Only score==1 rows. Authoritative rows preferred; exploratory rows are KEPT
    but flagged `authoritative:false` in meta (box/cloud rows can still be good
    training data even if they can't decide a verdict).
  - The assistant turn is the model's REAL session output (final code/answer),
    tool calls stripped to the delivered solution — not a reconstruction.
  - Dedup by (task, solution-hash): identical solutions across reps collapse.
  - --min-authoritative drops exploratory rows entirely (strict mode).

Usage:
  ./rft_harvest.py <gen> [<gen>...] [--out rft/<name>.jsonl] [--min-authoritative]
                   [--model <id>]   # restrict to one model's survivors
  ./rft_harvest.py --selftest
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import sys

LAB = os.path.dirname(os.path.abspath(__file__))
HERE = os.path.dirname(LAB)
TASKS_DIR = os.path.join(HERE, "ab-symbolect", "tasks")
RUNS = os.environ.get("REAL_GATE_RUNS", os.path.expanduser("~/.pi/real-gate-runs"))

sys.path.insert(0, os.path.join(HERE, "ab-machinery"))
from metrics import session_file_for  # noqa: E402


def task_prompt(task: str) -> str | None:
    p = os.path.join(TASKS_DIR, f"{task}.txt")
    return open(p, encoding="utf-8").read().strip() if os.path.exists(p) else None


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def solution_from_session(session_path: str) -> str | None:
    """The model's delivered answer: the LAST assistant turn carrying text
    (final report / code summary). Tool-call-only turns are skipped — the
    accepted artifact is on disk; the text turn is the model's own account."""
    last = None
    with open(session_path, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("type") != "message":
                continue
            m = d["message"]
            if m.get("role") == "assistant":
                t = _text(m.get("content"))
                if t.strip():
                    last = t.strip()
    return last


def harvest(gens, want_model=None, min_authoritative=False):
    examples, seen, stats = [], set(), {"rows": 0, "passing": 0, "no_session": 0, "no_solution": 0, "exploratory": 0, "dup": 0}
    for gen in gens:
        path = os.path.join(LAB, "results", gen + ".jsonl")
        if not os.path.exists(path):
            print(f"  (skip {gen}: no results file)", file=sys.stderr)
            continue
        for r in (json.loads(l) for l in open(path) if l.strip()):
            stats["rows"] += 1
            if r.get("score") != 1:
                continue
            if want_model and r.get("model") != want_model:
                continue
            stats["passing"] += 1
            authoritative = r.get("authoritative") is True
            if not authoritative:
                stats["exploratory"] += 1
                if min_authoritative:
                    continue
            prompt = task_prompt(r["task"])
            if not prompt:
                continue
            wd_glob = os.path.join(RUNS, f"{gen}-*-{r.get('arm', 'base')}-{r['task']}-{r['rep']}")
            wds = glob.glob(wd_glob)
            if not wds:
                stats["no_session"] += 1
                continue
            sess = session_file_for(wds[0])
            sol = solution_from_session(sess) if sess else None
            if not sol:
                stats["no_solution"] += 1
                continue
            h = hashlib.sha256((r["task"] + "\0" + sol).encode()).hexdigest()[:16]
            if h in seen:
                stats["dup"] += 1
                continue
            seen.add(h)
            examples.append({
                "messages": [
                    {"role": "system", "content": "You are a senior coding agent."},
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": sol},
                ],
                "meta": {"gen": gen, "task": r["task"], "model": r.get("model"),
                         "rep": r["rep"], "run": r.get("run"),
                         "authoritative": authoritative, "solution_sha": h},
            })
    return examples, stats


def selftest():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        sess = os.path.join(td, "s.jsonl")
        with open(sess, "w") as f:
            f.write(json.dumps({"type": "message", "message": {"role": "user", "content": "task"}}) + "\n")
            f.write(json.dumps({"type": "message", "message": {"role": "assistant",
                    "content": [{"type": "toolCall", "name": "edit"}]}}) + "\n")
            f.write(json.dumps({"type": "message", "message": {"role": "assistant",
                    "content": [{"type": "text", "text": "Final: implemented firstUnmatched, tests pass."}]}}) + "\n")
        assert solution_from_session(sess) == "Final: implemented firstUnmatched, tests pass."
        # tool-only session -> no solution
        sess2 = os.path.join(td, "s2.jsonl")
        with open(sess2, "w") as f:
            f.write(json.dumps({"type": "message", "message": {"role": "assistant",
                    "content": [{"type": "toolCall", "name": "edit"}]}}) + "\n")
        assert solution_from_session(sess2) is None
    print("rft_harvest selftest: OK (last-text extraction, tool-only -> none)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gens", nargs="*")
    ap.add_argument("--out", default=None)
    ap.add_argument("--model", default=None)
    ap.add_argument("--min-authoritative", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest(); return
    if not a.gens:
        ap.error("give at least one gen (results/<gen>.jsonl)")
    examples, stats = harvest(a.gens, a.model, a.min_authoritative)
    out = a.out or os.path.join(LAB, "rft", f"{'-'.join(a.gens)}.jsonl")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")
    n_auth = sum(1 for e in examples if e["meta"]["authoritative"])
    print(f"harvested {len(examples)} training examples ({n_auth} authoritative, "
          f"{len(examples) - n_auth} exploratory) -> {out}")
    print(f"  stats: {stats}")
    if stats["exploratory"] and not a.min_authoritative:
        print("  note: includes exploratory (box/cloud) survivors — pass --min-authoritative for strict.")


if __name__ == "__main__":
    main()
