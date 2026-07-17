#!/usr/bin/env python3
"""propose_screen: rejection-sampling funnel in front of the gate.

The measured bottleneck is candidate QUALITY, not measurement (r5/r6: every
hand-authored candidate lost, each costing hours of gate time). This funnel
inverts the economics: over-generate cheaply, reject cheaply, gate rarely.

  propose K candidates (frontier via FRONTIER_* env — Cerebras gemma works)
    -> schema-reject (configs/schema.json dims; malformed/no-op dropped)
      -> smoke-screen each survivor: ONE real_gate rep of ONE task on a FAST
         provider (MODEL_CONTROL=pi-native GATE_NETWORK=open -> rows exploratory
         by construction)
        -> rank vs a baseline smoke; emit top-k configs for a REAL gate round.

HONESTY CONTRACT (printed on every report):
  - The screen RANKS, it never adopts. Fisher on the real gate remains the only
    adoption authority; a 1-rep smoke is selection on noise (winner's curse).
  - The smoke model (fast cloud) is usually NOT the adoption target (local 4B):
    transfer is assumed until the gate says otherwise.
  - Screening K candidates then gating the top-k is multiplicity: fleet_verdict
    already stamps multi-candidate rounds exploratory pending single-candidate
    confirmation — the funnel rides that discipline, it does not replace it.

Usage:
  FRONTIER_BASE_URL=https://api.cerebras.ai/v1 FRONTIER_API_KEY=... \
  FRONTIER_MODEL=gemma-4-31b \
  SCREEN_PROVIDER=cerebras SCREEN_MODEL=gemma-4-31b \
    ./propose_screen.py --gen s1 --traces b2 --k 8 --top 3 [--task parens]
  ./propose_screen.py --selftest
"""
from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys
import time
import uuid

LAB = os.path.dirname(os.path.abspath(__file__))
HERE = os.path.dirname(LAB)
RUNS = os.environ.get("REAL_GATE_RUNS", os.path.expanduser("~/.pi/real-gate-runs"))
PROPOSALS = os.path.join(LAB, "proposals")
LIVE_GOV = os.path.expanduser("~/.pi/agent/APPEND_SYSTEM.md")

sys.path.insert(0, LAB)
from propose import OPERATORS, parse_candidates  # noqa: E402


def load_dims() -> dict:
    return json.load(open(os.path.join(LAB, "configs", "schema.json")))["dimensions"]


# ---------- 1. propose ----------

PROPOSE_SYS = (
    "You run autoresearch on a coding-agent harness so a SMALL local model completes "
    "agentic coding tasks. You see the current system prompt (the governor) and concrete "
    "failing traces. Propose {k} DISTINCT candidates; each uses exactly one operator from: "
    + ", ".join(OPERATORS) + ". Keep edits SMALL and GENERAL (no overfitting to the traces). "
    "Each candidate may revise the governor AND/OR move config dimensions.\n"
    "Config space: {space}\n"
    "Output each candidate EXACTLY as:\n"
    "### CANDIDATE\nOPERATOR: <operator>\nRATIONALE: <one line>\n"
    'CONFIG: {{"format": "md"}}   (optional single-line JSON delta)\n'
    "--- PROMPT ---\n<full revised governor, or exactly UNCHANGED>\n--- END ---"
)


def failing_traces(gen: str, limit: int = 6) -> list[dict]:
    """Failing rows from a gate gen + their session tails (the munchkin recipe)."""
    path = os.path.join(LAB, "results", gen + ".jsonl")
    rows = [json.loads(l) for l in open(path) if l.strip()]
    out = []
    for r in rows:
        if r.get("score") != 0:
            continue
        pat = os.path.join(RUNS, f"{gen}-*-{r.get('arm', 'base')}-{r['task']}-{r['rep']}")
        wds = glob.glob(pat)
        tail = ""
        if wds:
            log = os.path.join(wds[0], "run.log")
            if os.path.exists(log):
                tail = "".join(open(log, errors="ignore").readlines()[-10:])[-600:]
        out.append({"task": r["task"], "tail": tail})
        if len(out) >= limit:
            break
    return out


def build_space(dims: dict) -> str:
    parts = []
    for name, d in dims.items():
        if d.get("kind") == "prompt" and name == "prompt_variant":
            continue  # the governor body is proposed directly, not via variant
        if "values" in d:
            parts.append(f"{name}: {d['values']}")
        elif "fields" in d:
            parts.append(f"{name}: fields {list(d['fields'])}")
    return "; ".join(parts)


def propose(k: int, traces: list[dict], call) -> list[tuple[str, str, dict]]:
    gov = open(LIVE_GOV).read()
    fails = "\n\n".join(f"TASK {t['task']} (trace tail):\n{t['tail'] or '(no tail)'}" for t in traces) or "(no failing traces)"
    sysmsg = PROPOSE_SYS.format(k=k, space=build_space(load_dims()))
    user = f"CURRENT GOVERNOR:\n---\n{gov}\n---\n\nFAILING TRACES:\n{fails}\n\nPropose {k} candidates now."
    return parse_candidates(call(sysmsg, user))


# ---------- 2. schema-reject ----------

def validate(cands: list[tuple[str, str, dict]], dims: dict) -> tuple[list[dict], list[str]]:
    kept, rejected = [], []
    seen_bodies = set()
    for i, (op, body, delta) in enumerate(cands, 1):
        tag = f"cand{i}[{op}]"
        if op not in OPERATORS:
            rejected.append(f"{tag}: unknown operator"); continue
        bad = None
        for key, val in (delta or {}).items():
            d = dims.get(key)
            if not d:
                bad = f"unknown dim {key}"; break
            if "values" in d and val not in d["values"]:
                bad = f"{key}={val!r} not in {d['values']}"; break
            if "fields" in d and isinstance(val, dict) and not set(val) <= set(d["fields"]):
                bad = f"{key} has unknown fields {set(val) - set(d['fields'])}"; break
        if bad:
            rejected.append(f"{tag}: {bad}"); continue
        if body == "UNCHANGED" and not delta:
            rejected.append(f"{tag}: no-op (UNCHANGED, no delta)"); continue
        fp = (body, json.dumps(delta, sort_keys=True))
        if fp in seen_bodies:
            rejected.append(f"{tag}: duplicate"); continue
        seen_bodies.add(fp)
        kept.append({"id": f"c{i}", "operator": op, "gov": body, "delta": delta or {}})
    return kept, rejected


# ---------- 3. smoke-screen (one real_gate rep on a fast provider) ----------

def write_config(cand: dict, outdir: str) -> str:
    os.makedirs(outdir, exist_ok=True)
    cfg = {"prompt_variant": "A", "format": "md", "scaffold": "none"}
    if cand["gov"] != "UNCHANGED":
        gov_path = os.path.join(outdir, f"{cand['id']}.gov.md")
        open(gov_path, "w").write(cand["gov"])
        cfg["prompt_variant"] = gov_path
    cfg.update(cand["delta"])
    path = os.path.join(outdir, f"{cand['id']}.config.json")
    json.dump(cfg, open(path, "w"))
    return path


def smoke_real(cfg_path: str, gen: str, task: str) -> dict:
    """One rep of one task via real_gate --calibrate on the SCREEN provider."""
    env = {**os.environ,
           "GEN": gen, "N": "1", "BASE": cfg_path, "RESULTS_MODE": "truncate",
           "RUNID": uuid.uuid4().hex[:6],
           "MODEL_CONTROL": "pi-native", "GATE_NETWORK": "open",
           "PI_PROVIDER": os.environ.get("SCREEN_PROVIDER", "cerebras"),
           "PI_MODEL": os.environ.get("SCREEN_MODEL", "gemma-4-31b")}
    rc = subprocess.call(["bash", os.path.join(HERE, "real_gate.sh"), "--calibrate", "--exploratory", task],
                         env=env, cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = os.path.join(LAB, "results", gen + ".jsonl")
    if rc != 0 or not os.path.exists(out):
        return {"ok": False, "why": f"gate exit {rc}"}
    rows = [json.loads(l) for l in open(out) if l.strip()]
    if not rows:
        return {"ok": False, "why": "no row"}
    r = rows[-1]
    return {"ok": True, "score": r.get("score", 0), "out_chars": r.get("out_chars", 0)}


# ---------- 4. rank + emit ----------

def rank(base: dict, results: list[tuple[dict, dict]]) -> list[tuple[dict, dict]]:
    """Pass beats fail; among passes, fewer out_chars (cheaper) ranks higher.
    Smoke failures (429s etc.) sink to the bottom but are kept visible."""
    def key(item):
        _, s = item
        if not s.get("ok"):
            return (2, 0)
        return (0 if s["score"] == 1 else 1, s.get("out_chars", 0))
    return sorted(results, key=key)


def run(gen: str, traces_gen: str, k: int, top: int, task: str, call, smoke_fn) -> dict:
    dims = load_dims()
    traces = failing_traces(traces_gen) if traces_gen else []
    cands = propose(k, traces, call)
    kept, rejected = validate(cands, dims)
    outdir = os.path.join(PROPOSALS, f"screen-{gen}")
    base_cfg = os.path.join(LAB, "configs", "baseline.json")
    print(f"proposed {len(cands)}, kept {len(kept)}, rejected {len(rejected)}")
    for r in rejected:
        print(f"  reject: {r}")
    print(f"smoking baseline + {len(kept)} candidates (1 rep of {task} each, sequential)…")
    base_smoke = smoke_fn(base_cfg, f"{gen}-sbase", task)
    results = []
    for cand in kept:
        cfg = write_config(cand, outdir)
        s = smoke_fn(cfg, f"{gen}-{cand['id']}", task)
        results.append((cand, s))
        print(f"  {cand['id']} [{cand['operator']}]: {s}")
        time.sleep(float(os.environ.get("SCREEN_SLEEP", "5")))
    ranked = rank(base_smoke, results)
    report = {
        "gen": gen, "task": task, "screen_model": os.environ.get("SCREEN_MODEL", "gemma-4-31b"),
        "baseline_smoke": base_smoke,
        "ranking": [{"id": c["id"], "operator": c["operator"], "delta": c["delta"],
                     "gov_changed": c["gov"] != "UNCHANGED", "smoke": s} for c, s in ranked],
        "top": [c["id"] for c, _ in ranked[:top]],
        "caveats": [
            "screen ranks only — Fisher on the real gate is the adoption authority",
            "1-rep smoke = selection on noise (winner's curse); treat ranking as exploratory",
            f"smoke model is {os.environ.get('SCREEN_MODEL', 'gemma-4-31b')}, NOT the adoption target — transfer unproven",
        ],
    }
    os.makedirs(outdir, exist_ok=True)
    json.dump(report, open(os.path.join(outdir, "screen-report.json"), "w"), indent=2)
    print(f"\n== screen ranking (baseline smoke: {base_smoke}) ==")
    for c, s in ranked:
        print(f"  {c['id']:4} [{c['operator']:20}] {s}")
    print(f"top-{top} -> {report['top']}  (configs in {outdir})")
    for cv in report["caveats"]:
        print(f"  caveat: {cv}")
    return report


# ---------- selftest (offline: injected frontier + smoke) ----------

def selftest():
    reply = """### CANDIDATE
OPERATOR: tighten
RATIONALE: shorter governor
--- PROMPT ---
Short governor text.
--- END ---
### CANDIDATE
OPERATOR: switch-format
RATIONALE: xml wrap
CONFIG: {"format": "xml"}
--- PROMPT ---
UNCHANGED
--- END ---
### CANDIDATE
OPERATOR: bogus-op
RATIONALE: should be rejected
--- PROMPT ---
whatever
--- END ---
### CANDIDATE
OPERATOR: switch-format
RATIONALE: invalid value
CONFIG: {"format": "yaml"}
--- PROMPT ---
UNCHANGED
--- END ---
### CANDIDATE
OPERATOR: remove-bloat
RATIONALE: no-op
--- PROMPT ---
UNCHANGED
--- END ---"""
    parsed = parse_candidates(reply)
    kept, rejected = validate(parsed, load_dims())
    assert [c["operator"] for c in kept] == ["tighten", "switch-format"], kept
    # parse_candidates itself drops unknown operators and UNCHANGED no-ops; the
    # schema layer catches invalid dim VALUES. Between the two, 3 of 5 die.
    assert len(parsed) + 0 <= 4, parsed          # bogus-op / no-op never reach validate
    assert any("yaml" in r for r in rejected), rejected
    # ranking: pass beats fail beats smoke-error; cheaper pass first
    fake = [({"id": "a", "operator": "x", "delta": {}, "gov": "g"}, {"ok": True, "score": 0, "out_chars": 10}),
            ({"id": "b", "operator": "x", "delta": {}, "gov": "g"}, {"ok": True, "score": 1, "out_chars": 500}),
            ({"id": "c", "operator": "x", "delta": {}, "gov": "g"}, {"ok": False, "why": "429"}),
            ({"id": "d", "operator": "x", "delta": {}, "gov": "g"}, {"ok": True, "score": 1, "out_chars": 100})]
    order = [c["id"] for c, _ in rank({}, fake)]
    assert order == ["d", "b", "a", "c"], order
    # config writer: governor candidate gets a file; config-only keeps variant A
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p1 = write_config({"id": "c1", "operator": "t", "gov": "New gov", "delta": {}}, td)
        cfg1 = json.load(open(p1))
        assert cfg1["prompt_variant"].endswith("c1.gov.md")
        p2 = write_config({"id": "c2", "operator": "t", "gov": "UNCHANGED", "delta": {"format": "xml"}}, td)
        cfg2 = json.load(open(p2))
        assert cfg2["prompt_variant"] == "A" and cfg2["format"] == "xml"
    print("propose_screen selftest: OK (parse/validate, rank order, config writer)")


def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    def opt(name, default):
        return args[args.index(name) + 1] if name in args else default
    from judge import frontier_call
    gen = opt("--gen", "s1")
    run(gen, opt("--traces", ""), int(opt("--k", "8")), int(opt("--top", "3")),
        opt("--task", "parens"), frontier_call, smoke_real)


if __name__ == "__main__":
    main()
