#!/usr/bin/env python3
"""sql_eval: deterministic text-to-SQL eval on the prompt/governor surface.

Execution IS the judge: run the model's SQL against an in-memory copy of the
fixture DB, compare the result set (as a multiset) to the gold query's result
set. No human, no LLM judge — the adopt/reject decision is the Wilson CI.

Each variant is a system-prompt arm (A = live APPEND_SYSTEM governor, F = none,
or --prompt-file <path>). The delta between arms is purely the system prompt, so
the score answers "does our always-on governor help or hurt text-to-SQL?".

Usage:  ./sql_eval.py [gen] [--variants A,F] [--prompt-file P=path ...]
        ./sql_eval.py --selftest          # no server, no network
Server: http://127.0.0.1:8080 (override LLAMA_URL), reused from promptlab.
"""
import json, os, re, sqlite3, sys

LAB = os.path.dirname(os.path.abspath(__file__))
SQL_DIR = os.path.join(LAB, "sql")

# ---------- fixture DB ----------

def load_db():
    """Fresh in-memory DB built from schema.sql (schema + seed)."""
    conn = sqlite3.connect(":memory:")
    with open(os.path.join(SQL_DIR, "schema.sql")) as f:
        conn.executescript(f.read())
    return conn

def schema_ddl():
    """Just the CREATE TABLE statements — structure for the prompt, not the seed."""
    with open(os.path.join(SQL_DIR, "schema.sql")) as f:
        text = f.read()
    return "\n\n".join(s.strip() + ";" for s in text.split(";") if s.strip().upper().lstrip().startswith("CREATE"))

def questions():
    with open(os.path.join(SQL_DIR, "questions.json")) as f:
        return json.load(f)

# ---------- SQL extraction + result-set compare ----------

def extract_sql(text):
    """Pull a single SQL statement out of a model reply: fenced ```sql block
    first, else any ``` block, else the first SELECT/WITH … ; statement."""
    m = re.search(r"```sql\s*(.+?)```", text, re.S | re.I) or re.search(r"```\s*(.+?)```", text, re.S)
    body = m.group(1) if m else text
    m2 = re.search(r"\b(WITH|SELECT)\b.+?(;|$)", body, re.S | re.I)
    return (m2.group(0).strip().rstrip(";").strip() if m2 else body.strip().rstrip(";").strip())

def result_set(conn, sql):
    """Execute read-only; return sorted list of row tuples, or None on error."""
    try:
        rows = conn.execute(sql).fetchall()
    except Exception:
        return None
    # multiset compare, order-insensitive. ponytail: tighten only if an ORDER BY
    # question needs strict ordering — none here do.
    return sorted((tuple(r) for r in rows), key=lambda t: repr(t))

def score(conn_gold, conn_pred, gold_sql, pred_text):
    gold = result_set(conn_gold, gold_sql)
    pred = result_set(conn_pred, extract_sql(pred_text))
    if pred is None:
        return 0, "sql error / no query"
    if gold is None:
        return 0, "BUG: gold_sql failed"
    return (1, "ok") if pred == gold else (0, f"rows {pred[:3]} != gold {gold[:3]}")

# ---------- variants ----------

def variant_system(p, prompt_files):
    if p in prompt_files:
        with open(prompt_files[p]) as f:
            return f.read()
    if p == "F":
        return None
    if p == "A":
        from promptlab import GOV  # lazy: avoids promptlab import side effects in --selftest
        return GOV
    raise SystemExit(f"unknown variant {p!r} (use A, F, or --prompt-file {p}=<path>)")

def user_prompt(q):
    return (f"{schema_ddl()}\n\nQuestion: {q['question']}\n\n"
            "Write a single SQLite query that answers the question. "
            "Output ONLY the SQL query, no explanation.")

# ---------- run ----------

def run(gen, variants, prompt_files, n_repeat=1, model=None):
    from promptlab import chat, wilson, server_model  # lazy
    # The tag for THIS run = whichever model the server has loaded (or --model
    # override). Results carry it so a fleet sweep (one model at a time on :8080)
    # stays distinguishable and resumable per model.
    tag = model or server_model() or "unknown"
    out = os.path.join(LAB, "results", gen + ".jsonl")
    done = set()
    if os.path.exists(out):
        for line in open(out):
            try:
                d = json.loads(line); done.add((d["task"], d["pattern"], d["rep"], d.get("model")))
            except Exception:
                pass
    qs = questions()
    gold_conn = load_db()
    todo = [(rep, q, p) for rep in range(n_repeat) for q in qs for p in variants
            if (q["id"], p, rep, tag) not in done]
    print(f"{gen}: {len(todo)} calls ({len(done)} done) · model={tag} · {len(variants)} variant(s)")
    with open(out, "a") as f:
        for i, (rep, q, p) in enumerate(todo):
            r = chat(variant_system(p, prompt_files), user_prompt(q), model=tag)
            sc, detail = score(gold_conn, load_db(), q["gold_sql"], r["content"])
            rec = {"task": q["id"], "pattern": p, "rep": rep, "model": tag,
                   "split": q.get("split", "val"), "score": sc, "detail": detail,
                   "difficulty": q["difficulty"], "wall": r["wall"],
                   "sql": extract_sql(r["content"])[:500],
                   "out_chars": len(r["content"]), "think_chars": len(r["reasoning"])}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n"); f.flush()
            print(f"[{i+1}/{len(todo)}] {q['id']} {p} {tag} rep{rep} -> {sc} ({r['wall']}s) {detail[:50]}")
    # summary: per (model, variant)
    agg = {}
    for line in open(out):
        d = json.loads(line)
        agg.setdefault((d.get("model", "?"), d["pattern"]), []).append(d["score"])
    lines = [f"# sql_eval {gen} — exec-accuracy by model × variant\n", "| model | variant | accuracy (Wilson 95%) |", "|---|---|---|"]
    for (mdl, p) in sorted(agg):
        s = agg[(mdl, p)]
        pr, lo, hi = wilson(sum(s), len(s))
        lines.append(f"| {mdl} | {p} | {sum(s)}/{len(s)} = {pr:.0%} ({lo:.0%}–{hi:.0%}) |")
    report = "\n".join(lines) + "\n"
    with open(os.path.join(LAB, "results", gen + "-REPORT.md"), "w") as f:
        f.write(report)
    print("\n" + report)
    print("Cross-model adoption: run fleet_report.py on this gen (daily-driver hard gate + do-no-harm).")

# ---------- selftest (no server, no network) ----------

def selftest():
    gold_conn = load_db()
    qs = questions()
    # 1. every gold_sql runs and returns a result (scalar count is a row too).
    for q in qs:
        rows = result_set(gold_conn, q["gold_sql"])
        assert rows is not None and len(rows) >= 1, f"gold_sql empty/failed: {q['id']}"
    assert len(qs) >= 15, f"expected a real question set, got {len(qs)}"

    # 2. extractor handles fences and prose.
    assert extract_sql("```sql\nSELECT name FROM customers;\n```") == "SELECT name FROM customers"
    assert extract_sql("Here you go:\nSELECT 1;") == "SELECT 1"
    assert extract_sql("```\nSELECT city FROM customers\n```") == "SELECT city FROM customers"

    # 3. scoring: correct rows -> 1, wrong rows -> 0, un-runnable -> 0.
    q1 = next(q for q in qs if q["id"] == "q01")  # London customers
    ok = "```sql\n" + q1["gold_sql"] + "\n```"
    assert score(gold_conn, load_db(), q1["gold_sql"], ok) == (1, "ok")
    wrong = "SELECT name FROM customers WHERE city = 'Madrid';"
    assert score(gold_conn, load_db(), q1["gold_sql"], wrong)[0] == 0
    broken = "SELECT name FROM nonexistent_table;"
    assert score(gold_conn, load_db(), q1["gold_sql"], broken)[0] == 0

    # 4. multi-model substrate: every question carries a split; held-out exists;
    #    server_model fails open to None when no server is up (don't crash a sweep).
    from promptlab import server_model
    assert all(q.get("split") in ("val", "heldout") for q in qs), "every question needs a split"
    assert sum(q["split"] == "heldout" for q in qs) >= 3, "need a held-out set for the overfit guard"
    assert server_model("http://127.0.0.1:9") is None, "server_model must fail open when unreachable"

    print(f"sql_eval selftest: OK ({len(qs)} questions, "
          f"{sum(q['split']=='heldout' for q in qs)} held-out; gold_sql/extractor/scorer/split pass)")

# ---------- cli ----------

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    gen = next((a for a in args if not a.startswith("-")), "sql0")
    variants = (args[args.index("--variants") + 1].split(",") if "--variants" in args else ["A", "F"])
    model = args[args.index("--model") + 1] if "--model" in args else None
    prompt_files = {}
    i = 0
    while i < len(args):
        if args[i] == "--prompt-file":
            k, _, path = args[i + 1].partition("=")
            prompt_files[k] = os.path.expanduser(path); i += 2
        else:
            i += 1
    run(gen, variants, prompt_files, model=model)

if __name__ == "__main__":
    main()
