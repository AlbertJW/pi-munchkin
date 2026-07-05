#!/usr/bin/env python3
"""propose: reflective prompt-tweak generator (borrowed from GEPA + Karpathy autoresearch).

The "what to try next" step — NO DSPy dependency. Reads the failing traces from a
sql_eval run (score=0 rows joined to questions.json for the gold), hands them + the
current prompt to a frontier model, and asks for 1-3 MINIMAL edits, each tagged with
one autoresearch mutation operator. Writes each as a candidate prompt file. You then
A/B them across the fleet:  sql_eval --prompt-file C=proposals/<file>  ->  fleet_report.

Adoption stays MANUAL + statistical (the do-no-harm rule in fleet_report). This only
proposes.

Usage:  propose.py <gen> [--prompt ~/.pi/agent/APPEND_SYSTEM.md] [--n 3] [--max-traces 12]
        propose.py --selftest          # no network
Needs FRONTIER_BASE_URL / FRONTIER_API_KEY (reused from judge.py).
"""
import json, os, re, sys

LAB = os.path.dirname(os.path.abspath(__file__))
PROPOSALS = os.path.join(LAB, "proposals")
DEFAULT_PROMPT = os.path.expanduser(os.environ.get(
    "GOVERNOR", os.path.join(LAB, "..", "..", "harness", "APPEND_SYSTEM.md")))

OPERATORS = ["add-constraint", "add-negative-example", "restructure",
             "tighten", "remove-bloat", "add-counterexample",
             "tune-threshold", "switch-format", "switch-scaffold"]  # config-space ops (munchkin)

PROPOSE_SYS = (
    "You are a prompt engineer improving a coding-agent system prompt so a LOCAL LLM "
    "answers more questions correctly. You are shown the current prompt and concrete "
    "FAILING cases (question, expected answer, the model's wrong answer). Propose "
    f"{{n}} DISTINCT minimal edits. Each edit must use exactly one mutation operator from: "
    f"{', '.join(OPERATORS)}. Keep edits SMALL and general (must not overfit to these "
    "specific cases). Output each candidate EXACTLY as:\n"
    "### CANDIDATE\nOPERATOR: <one operator>\nRATIONALE: <one line>\n"
    "--- PROMPT ---\n<the full revised prompt>\n--- END ---")

# ---------- trace loading ----------

def failing_traces(gen, max_traces):
    rows = [json.loads(l) for l in open(os.path.join(LAB, "results", gen + ".jsonl")) if l.strip()]
    qs = {q["id"]: q for q in json.load(open(os.path.join(LAB, "sql", "questions.json")))}
    out = []
    for r in rows:
        if r.get("score") == 0 and r["task"] in qs:
            q = qs[r["task"]]
            out.append({"question": q["question"], "gold": q["gold_sql"],
                        "wrong": r.get("sql", ""), "model": r.get("model", "?")})
    return out[:max_traces]

def build_user(prompt_text, traces):
    blocks = "\n\n".join(
        f"FAIL {i+1} (model {t['model']}):\n  Q: {t['question']}\n  expected: {t['gold']}\n  got: {t['wrong']}"
        for i, t in enumerate(traces))
    return f"CURRENT PROMPT:\n```\n{prompt_text}\n```\n\nFAILING CASES:\n{blocks}"

# ---------- parsing (selftested) ----------

def parse_candidates(reply):
    """-> [(operator, prompt_body, config_delta)] for each well-formed ### CANDIDATE block.
    CONFIG is an optional single-line JSON delta over harness dims (munchkin validates it
    against the schema). PROMPT may be exactly 'UNCHANGED' for a config-only candidate —
    but UNCHANGED with no delta is a no-op and dropped."""
    out = []
    for chunk in reply.split("### CANDIDATE")[1:]:
        op = re.search(r"OPERATOR:\s*([a-z-]+)", chunk, re.I)
        body = re.search(r"--- PROMPT ---\s*(.*?)\s*--- END ---", chunk, re.S)
        cfg = re.search(r"^CONFIG:\s*(\{.*\})\s*$", chunk, re.M)
        delta = {}
        if cfg:
            try:
                delta = json.loads(cfg.group(1))
            except ValueError:
                delta = {}
        if not (op and body):
            continue
        opv, bodyv = op.group(1).lower(), body.group(1).strip()
        if opv not in OPERATORS or not bodyv:
            continue
        if bodyv == "UNCHANGED" and not delta:
            continue
        out.append((opv, bodyv, delta))
    return out

def write_candidates(gen, cands, out_dir=PROPOSALS):
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for i, (op, body, _delta) in enumerate(cands):
        p = os.path.join(out_dir, f"{gen}-{i+1}-{op}.md")
        with open(p, "w") as f:
            f.write(body + "\n")
        paths.append(p)
    return paths

# ---------- run ----------

def run(gen, prompt_path, n, max_traces):
    from judge import frontier_call  # reuse the frontier endpoint plumbing
    traces = failing_traces(gen, max_traces)
    if not traces:
        print(f"no failing traces in results/{gen}.jsonl — nothing to propose"); return
    prompt_text = open(prompt_path).read()
    reply = frontier_call(PROPOSE_SYS.format(n=n), build_user(prompt_text, traces))
    cands = parse_candidates(reply)
    if not cands:
        print("frontier returned no well-formed candidates; raw reply:\n" + reply[:800]); return
    paths = write_candidates(gen, cands)
    print(f"{len(traces)} failing traces -> {len(cands)} candidate(s):")
    for (op, _b, _d), p in zip(cands, paths):
        print(f"  [{op}] {p}")
    print(f"\nA/B them:  ./sql_eval.py {gen}-ab --variants A,C --prompt-file C=<path>  then  ./fleet_report.py {gen}-ab --candidate C")

# ---------- selftest (no network) ----------

def selftest():
    stub = (
        "preamble\n"
        "### CANDIDATE\nOPERATOR: tighten\nRATIONALE: be explicit about single statement\n"
        "--- PROMPT ---\nYou are precise. Output ONE SQL statement.\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: add-constraint\nRATIONALE: forbid prose\n"
        "--- PROMPT ---\nNever explain. SQL only.\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: nonsense\nRATIONALE: invalid op should be dropped\n"
        "--- PROMPT ---\nx\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: tune-threshold\nRATIONALE: config-only experiment\n"
        'CONFIG: {"thresholds": {"LB_STREAK_SOFT": 8}}\n'
        "--- PROMPT ---\nUNCHANGED\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: tighten\nRATIONALE: UNCHANGED without config is a no-op\n"
        "--- PROMPT ---\nUNCHANGED\n--- END ---\n")
    cands = parse_candidates(stub)
    assert len(cands) == 3, f"expected 3 valid candidates, got {len(cands)}"
    assert all(op in OPERATORS for op, _b, _d in cands), cands
    assert all(body.strip() for _op, body, _d in cands)
    # nested single-line CONFIG json parses; prompt candidates default to empty delta
    assert cands[2] == ("tune-threshold", "UNCHANGED", {"thresholds": {"LB_STREAK_SOFT": 8}}), cands[2]
    assert cands[0][2] == {} and cands[1][2] == {}
    assert parse_candidates("no candidates here") == []
    # file writing round-trips to a temp dir (no real proposals/ touched)
    import tempfile, shutil
    d = tempfile.mkdtemp()
    try:
        paths = write_candidates("selftest", cands, out_dir=d)
        assert len(paths) == 3 and all(os.path.exists(p) for p in paths)
        assert open(paths[0]).read().strip() == "You are precise. Output ONE SQL statement."
    finally:
        shutil.rmtree(d)
    print("propose selftest: OK (parse drops invalid op + no-op UNCHANGED; CONFIG delta round-trips; files round-trip)")

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    gen = next((a for a in args if not a.startswith("-")), "sql0")
    prompt_path = os.path.expanduser(args[args.index("--prompt") + 1]) if "--prompt" in args else DEFAULT_PROMPT
    n = int(args[args.index("--n") + 1]) if "--n" in args else 3
    max_traces = int(args[args.index("--max-traces") + 1]) if "--max-traces" in args else 12
    run(gen, prompt_path, n, max_traces)

if __name__ == "__main__":
    main()
