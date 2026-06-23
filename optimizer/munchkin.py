#!/usr/bin/env python3
"""munchkin: bounded harness-refinement optimizer for ONE model (the loaded one on
:8080 — intended: qwopus35-9b-coder, which sits in the discriminating band).

Loop, per round: gate the current-best governor on the in-band agentic tasks → a
frontier model proposes K minimal governor edits from the FAILURES → gate each candidate
→ adopt the Fisher-significant winner (reusing fleet_report.classify) → repeat until a
plateau. HUMAN-GATED: the winner is written to prompt-lab/proposals/ for review; this
NEVER edits the live ~/.pi/agent/APPEND_SYSTEM.md.

The loop is pure + injectable (gate_fn/propose_fn), so --selftest proves it offline
(stubbed gate + frontier, no GPU/network). Live run needs llama-server up (free :8080)
and FRONTIER_BASE_URL/FRONTIER_API_KEY.

Usage:  munchkin.py [--gen m0] [--rounds 3] [--candidates 2] [--n 4] [--tasks t1,t2,t3]
        munchkin.py --dry        # print the session-count estimate, run nothing
        munchkin.py --selftest   # offline loop proof
GPU cost ≈ rounds × candidates × (tasks × n) agentic sessions on the model — keep small.
"""
import glob, hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.join(HERE, "prompt-lab")
PROPOSALS = os.path.join(LAB, "proposals")
RESULTS = os.path.join(LAB, "results")
RUNS = os.path.join(HERE, "real-gate-runs")
REAL_GATE = os.path.join(HERE, "real_gate.sh")
TASKS_DIR = os.path.join(HERE, "ab-symbolect", "tasks")
LIVE_GOV = os.path.expanduser(os.environ.get(
    "GOVERNOR", os.path.join(HERE, "..", "harness", "APPEND_SYSTEM.md")))
SATURATED = 0.85
PLATEAU_STOP = 2

def _classify(bk, bn, ck, cn):
    sys.path.insert(0, LAB)
    from fleet_report import classify  # Fisher exact; single-model = this one model's base-vs-cand
    return classify(bk, bn, ck, cn)

# ---------- real implementations (NOT exercised in --selftest) ----------

def server_model():
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:8080/v1/models", timeout=5) as r:
            return json.load(r)["data"][0]["id"]
    except Exception:
        return None

def real_gate_one(gov_text, tasks, n, gen):
    """Gate one governor (base config only) → (passes, total, failing_traces)."""
    os.makedirs(PROPOSALS, exist_ok=True)
    gov_path = os.path.join(PROPOSALS, gen + ".gov.md")
    cfg_path = os.path.join(PROPOSALS, gen + ".config.json")
    with open(gov_path, "w") as f:
        f.write(gov_text)
    with open(cfg_path, "w") as f:
        json.dump({"prompt_variant": gov_path, "format": "md", "scaffold": "none"}, f)
    out = os.path.join(RESULTS, gen + ".jsonl")
    if os.path.exists(out):
        os.remove(out)
    env = {**os.environ, "GEN": gen, "BASE": cfg_path, "N": str(n)}
    subprocess.run(["bash", REAL_GATE, "--calibrate", *tasks], env=env, cwd=HERE, check=False)
    rows = [json.loads(l) for l in open(out)] if os.path.exists(out) else []
    base = [r for r in rows if r.get("pattern") == "base"]
    k = sum(r["score"] for r in base)
    failures = []
    model = server_model() or "*"
    for r in base:
        if r["score"] == 0:
            logs = glob.glob(os.path.join(RUNS, f"{gen}-{model}-base-{r['task']}-{r['rep']}", "run.log"))
            tail = ""
            if logs:
                tail = "".join(open(logs[0]).readlines()[-15:])
            failures.append({"task": r["task"], "log_tail": tail[-800:]})
    return k, len(base), failures

def real_propose(gov_text, failures, k):
    sys.path.insert(0, LAB)
    from judge import frontier_call
    from propose import parse_candidates, OPERATORS
    fails = "\n\n".join(
        f"TASK {f['task']} (prose: {open(os.path.join(TASKS_DIR, f['task']+'.txt')).read().strip()[:200]})\n"
        f"what the model did (tail):\n{f['log_tail'][:400]}" for f in failures[:6])
    sysmsg = ("You improve a coding-agent system prompt (the 'governor') so a small local model completes "
              f"agentic coding tasks. Propose {k} DISTINCT minimal revised governors, each using one operator "
              f"from: {', '.join(OPERATORS)}. Keep edits small + general (do not overfit to these tasks). "
              "Output each EXACTLY as:\n### CANDIDATE\nOPERATOR: <one>\nRATIONALE: <one line>\n"
              "--- PROMPT ---\n<the FULL revised governor>\n--- END ---")
    user = f"CURRENT GOVERNOR:\n```\n{gov_text}\n```\n\nFAILING TASKS:\n{fails}"
    cands = parse_candidates(frontier_call(sysmsg, user))
    return [body for _op, body in cands]

# ---------- pure loop (selftested) ----------

def optimize(base_gov, tasks, n, rounds, k, gate_fn, propose_fn, gen):
    best_gov = base_gov
    bk, bn, failures = gate_fn(best_gov, tasks, n, f"{gen}-r0-base")
    ledger = [{"round": 0, "event": "baseline", "pass": f"{bk}/{bn}"}]
    if bn and bk / bn > SATURATED:
        ledger.append({"event": "stop", "why": f"baseline saturated ({bk}/{bn}) — no headroom"})
        return best_gov, ledger
    plateau = 0
    for r in range(rounds):
        cands = propose_fn(best_gov, failures, k, r)
        scored = []
        for i, cg in enumerate(cands):
            ck, cn, cf = gate_fn(cg, tasks, n, f"{gen}-r{r}-c{i}")
            label, delta = _classify(bk, bn, ck, cn)
            ledger.append({"round": r, "cand": i, "pass": f"{ck}/{cn}", "label": label, "delta": round(delta, 3)})
            scored.append((label, ck, cn, cg, cf))
        winners = [s for s in scored if s[0] == "better"]
        if winners:
            w = max(winners, key=lambda s: s[1] / s[2] if s[2] else 0)
            best_gov, bk, bn, failures = w[3], w[1], w[2], w[4]
            ledger.append({"round": r, "event": "ADOPT", "pass": f"{bk}/{bn}"})
            plateau = 0
        else:
            plateau += 1
            ledger.append({"round": r, "event": "no-improvement", "plateau": plateau})
            if plateau >= PLATEAU_STOP:
                ledger.append({"event": "stop", "why": "plateau"})
                break
    return best_gov, ledger

def _write_outputs(gen, best_gov, ledger, base_gov):
    os.makedirs(PROPOSALS, exist_ok=True)
    with open(os.path.join(RESULTS, f"munchkin-{gen}.jsonl"), "w") as f:
        for e in ledger:
            f.write(json.dumps(e) + "\n")
    improved = best_gov != base_gov
    winner_path = os.path.join(PROPOSALS, f"munchkin-{gen}-winner.md")
    if improved:
        with open(winner_path, "w") as f:
            f.write(best_gov)
    return improved, winner_path

# ---------- selftest (offline: no GPU, no network) ----------

def selftest():
    live_hash_before = hashlib.sha1(open(LIVE_GOV, "rb").read()).hexdigest() if os.path.exists(LIVE_GOV) else None
    base = "BASE governor: do the task."

    def stub_gate(gov, tasks, n, gen):
        k = 10 if "WINNER" in gov else (4 if "CAND" in gov else 3)
        fails = [{"task": "t1", "log_tail": "model gave up"}]
        return k, 12, fails

    def stub_propose(gov, failures, k, r):
        return ["governor v1 WINNER edition", "governor v1 CAND neutral"] if r == 0 \
            else [f"governor r{r} CAND a", f"governor r{r} CAND b"]

    best, ledger = optimize(base, ["t1"], 4, rounds=4, k=2, gate_fn=stub_gate, propose_fn=stub_propose, gen="selftest")
    assert "WINNER" in best, f"should adopt the significant winner, got: {best!r}"
    assert any(e.get("event") == "ADOPT" for e in ledger), "ledger missing ADOPT"
    assert any(e.get("why") == "plateau" for e in ledger), "should stop on plateau"
    # the 4/12-vs-base-3/12 candidate must read as neutral (not adopted) — Fisher at n=12
    r0 = [e for e in ledger if e.get("round") == 0 and "label" in e]
    assert any(e["label"] == "better" for e in r0) and any(e["label"] == "neutral" for e in r0), r0
    # human-gate proof: the live governor must be byte-identical (we never write it)
    live_hash_after = hashlib.sha1(open(LIVE_GOV, "rb").read()).hexdigest() if os.path.exists(LIVE_GOV) else None
    assert live_hash_before == live_hash_after, "munchkin must NOT touch the live governor"
    print("munchkin selftest: OK (adopts winner, ignores neutral, plateau-stops, live governor untouched)")

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    def opt(flag, d):
        return args[args.index(flag) + 1] if flag in args else d
    gen = opt("--gen", "m0"); rounds = int(opt("--rounds", "3")); k = int(opt("--candidates", "2"))
    n = int(opt("--n", "4")); tasks = opt("--tasks", "t1,t2,t3").split(",")
    sessions = (1 + rounds * k) * len(tasks) * n
    print(f"plan: gen={gen} rounds={rounds} candidates={k} n={n} tasks={tasks}")
    print(f"GPU cost estimate: ~{sessions} agentic sessions on the loaded model (each up to {os.environ.get('PI_TIMEOUT','1800')}s).")
    if "--dry" in args:
        print("(--dry: nothing run)"); return
    if not os.path.exists(LIVE_GOV):
        raise SystemExit(f"governor not found: {LIVE_GOV}")
    base_gov = open(LIVE_GOV).read()
    print(f"model on :8080 = {server_model()}  (intended: qwopus35-9b-coder)")
    best, ledger = optimize(base_gov, tasks, n, rounds, k, real_gate_one, real_propose, gen)
    improved, winner = _write_outputs(gen, best, ledger, base_gov)
    print("\n=== ledger ===")
    for e in ledger:
        print(" ", json.dumps(e))
    if improved:
        print(f"\nWINNER governor → {winner}")
        print("REVIEW it, then apply manually:  cp", winner, LIVE_GOV)
    else:
        print("\nno improvement found — live governor unchanged (as always; munchkin never edits it).")

if __name__ == "__main__":
    main()
