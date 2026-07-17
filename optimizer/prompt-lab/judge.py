#!/usr/bin/env python3
"""judge: frontier-model pairwise judge for NON-executable ("soft") surfaces.

NOT for SQL — that's deterministically scored by execution (see sql_eval.py).
This grades dimensions execution can't: answer quality, and (later) agentic
solution quality beyond gate-pass. Pairwise A-vs-B with RANDOMIZED order to
cancel position bias; the judge is a layer on top of deterministic scoring,
never the sole signal (judges have position/verbosity/self-preference biases).

Frontier endpoint via env (no auth-store parsing):
  FRONTIER_BASE_URL  e.g. https://.../v1   (OpenAI-compatible)
  FRONTIER_API_KEY
  FRONTIER_MODEL     default gpt-5.5

Usage:  ./judge.py [gen] [--variants A,F]
        ./judge.py --selftest          # no network
Local model answers are generated via promptlab.chat (llama-server :8080).
"""
import json, os, re, sys, random, urllib.request

LAB = os.path.dirname(os.path.abspath(__file__))
SOFT_DIR = os.path.join(LAB, "soft")

RUBRIC = ("correctness, clarity, and concision — penalize padding, hedging, and "
          "anything wrong or unsafe")

JUDGE_SYS = ("You are a strict, impartial judge of two answers to the same question. "
             "Pick the better one on: {rubric}. Length is not quality. "
             "Reply with exactly one line 'WINNER: 1' or 'WINNER: 2' or 'WINNER: tie', "
             "then one line 'WHY: <short reason>'.")

# ---------- frontier call ----------

def frontier_call(system, user):
    base = os.environ.get("FRONTIER_BASE_URL")
    key = os.environ.get("FRONTIER_API_KEY")
    model = os.environ.get("FRONTIER_MODEL", "gpt-5.5")
    if not base or not key:
        raise SystemExit("set FRONTIER_BASE_URL and FRONTIER_API_KEY (OpenAI-compatible) to run the judge live")
    body = {"model": model, "messages": [{"role": "system", "content": system},
                                          {"role": "user", "content": user}]}
    req = urllib.request.Request(base.rstrip("/") + "/chat/completions",
                                 data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          # bare urllib UA gets Cloudflare-blocked (Cerebras, 403 code 1010)
                                          "User-Agent": "prompt-lab-judge/1",
                                          "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    return d["choices"][0]["message"].get("content") or ""

# ---------- verdict parsing + pairwise judging ----------

def parse_verdict(reply):
    """-> '1' | '2' | 'tie'. Malformed/ambiguous -> 'tie' (conservative)."""
    m = re.search(r"WINNER:\s*(1|2|tie)\b", reply, re.I)
    if m:
        return m.group(1).lower()
    return "tie"

def judge_pair(question, ans_a, ans_b, rubric=RUBRIC, order=None, call=frontier_call):
    """Show A/B in randomized slots, judge, map the slot verdict back to A/B.
    Returns (winner in {'A','B','tie'}, slot_verdict, order)."""
    if order is None:
        order = random.choice(("AB", "BA"))
    first, second = (ans_a, ans_b) if order == "AB" else (ans_b, ans_a)
    user = (f"Question:\n{question}\n\nAnswer 1:\n{first}\n\nAnswer 2:\n{second}")
    v = parse_verdict(call(JUDGE_SYS.format(rubric=rubric), user))
    if v == "tie":
        return "tie", v, order
    # slot "1" is whichever letter `order` put first
    winner_slot_is_a = (v == "1") == (order == "AB")
    return ("A" if winner_slot_is_a else "B"), v, order

# ---------- run ----------

def questions():
    with open(os.path.join(SOFT_DIR, "questions.json")) as f:
        return json.load(f)

def variant_system(p):
    if p == "F":
        return None
    if p == "A":
        from promptlab import GOV
        return GOV
    raise SystemExit(f"unknown variant {p!r} (judge runner supports A and F)")

def run(gen, variants):
    from promptlab import chat, wilson, server_model
    assert len(variants) == 2, "pairwise judge compares exactly two variants"
    a, b = variants
    tag = server_model() or "unknown"  # which local model produced the answers
    out = os.path.join(LAB, "results", gen + ".jsonl")
    qs = questions()
    tally = {"A": 0, "B": 0, "tie": 0}
    with open(out, "w") as f:
        for q in qs:
            ans_a = chat(variant_system(a), q["question"], model=tag)["content"]
            ans_b = chat(variant_system(b), q["question"], model=tag)["content"]
            winner, slot, order = judge_pair(q["question"], ans_a, ans_b)
            tally[winner] += 1
            rec = {"task": q["id"], "model": tag, "a": a, "b": b, "winner": winner, "order": order,
                   "a_chars": len(ans_a), "b_chars": len(ans_b)}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n"); f.flush()
            print(f"{q['id']}: {a}-vs-{b} -> {winner} (order {order})")
    decided = tally["A"] + tally["B"]
    pr, lo, hi = wilson(tally["A"], decided) if decided else (0, 0, 1)
    report = (f"# judge {gen} — pairwise {a} vs {b} (frontier judge, randomized order)\n\n"
              f"{a} wins: {tally['A']} · {b} wins: {tally['B']} · ties: {tally['tie']}\n\n"
              f"{a} win-rate among decided: {tally['A']}/{decided} = {pr:.0%} (Wilson {lo:.0%}–{hi:.0%})\n\n"
              f"Adopt {a} over {b} only if its win-rate CI sits clear of 50%.\n")
    with open(os.path.join(LAB, "results", gen + "-REPORT.md"), "w") as f:
        f.write(report)
    print("\n" + report)

# ---------- selftest (no network) ----------

def selftest():
    # stub judge that always prefers slot 1 -> winner must follow the order mapping.
    win1 = lambda s, u: "WINNER: 1\nWHY: stub"
    assert judge_pair("q", "ansA", "ansB", order="AB", call=win1)[0] == "A"
    assert judge_pair("q", "ansA", "ansB", order="BA", call=win1)[0] == "B"
    win2 = lambda s, u: "WINNER: 2\nWHY: stub"
    assert judge_pair("q", "ansA", "ansB", order="AB", call=win2)[0] == "B"
    assert judge_pair("q", "ansA", "ansB", order="BA", call=win2)[0] == "A"
    # verdict parsing
    assert parse_verdict("WINNER: tie\nWHY: same") == "tie"
    assert parse_verdict("winner: 2") == "2"
    assert parse_verdict("the answer is unclear") == "tie"   # malformed -> tie
    # randomized order is one of the two valid slots
    assert judge_pair("q", "x", "y", call=win1)[2] in ("AB", "BA")
    print("judge selftest: OK (order round-trips A/B under both slottings; malformed -> tie)")

# ---------- cli ----------

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    gen = next((a for a in args if not a.startswith("-")), "judge0")
    variants = (args[args.index("--variants") + 1].split(",") if "--variants" in args else ["A", "F"])
    run(gen, variants)

if __name__ == "__main__":
    main()
