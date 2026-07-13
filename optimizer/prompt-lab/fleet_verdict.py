#!/usr/bin/env python3
"""fleet_verdict: stitch per-model munchkin gen-families into per-CANDIDATE fleet
verdicts. munchkin runs one model per gen (f4a=4B, f4b=2B, f4c=mellum) and its
candidate INDEX ordering differs per gen — candidate identity comes from each
gen's ledger (operator "static:<name>"), never from file names.

  ./fleet_verdict.py f4a f4b f4c        # full verdicts (needs completed gens)
  ./fleet_verdict.py --selftest         # offline

Per candidate: per-model Wilson/Fisher classification + the fleet decision
(reused from fleet_report), cross-model sign direction, and mechanism metrics
(retried conversions from rows; per-arm telemetry via sk keys)."""
import collections, json, os, sys

LAB = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, LAB)
from fleet_report import classify, decide  # noqa: E402

RESULTS = os.path.join(LAB, "results")
TELEMETRY = os.environ.get("TELEMETRY_FILE", os.path.expanduser("~/.pi/agent/telemetry/events.jsonl"))


def load_rows(path):
    if not os.path.exists(path):
        return []
    return [json.loads(l) for l in open(path) if l.strip()]


def ledger_candidates(gen, results_dir=RESULTS):
    """[(cand_idx, name)] from the gen's munchkin ledger."""
    out = []
    for r in load_rows(os.path.join(results_dir, f"munchkin-{gen}.jsonl")):
        if "cand" in r and r.get("operator", "").startswith("static:"):
            out.append((r["cand"], r["operator"].split(":", 1)[1]))
    return out


def arm_stats(rows):
    """(passes, total, retried_fired, retried_converted) for a result file's rows."""
    k = sum(r["score"] for r in rows)
    rf = [r for r in rows if r.get("retried")]
    return k, len(rows), len(rf), sum(r["score"] for r in rf)


def telemetry_counts(gen_arm_prefix, telemetry_file=TELEMETRY):
    counts = collections.Counter()
    if not os.path.exists(telemetry_file):
        return counts
    for line in open(telemetry_file):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if (e.get("sk") or "").startswith(gen_arm_prefix):
            counts[f"{e.get('ext', '?')}.{e.get('kind', '?')}"] += 1
    return counts


def verdicts(gens, results_dir=RESULTS, telemetry_file=TELEMETRY):
    """{candidate_name: {"stats": {model: (bk,bn,ck,cn)}, "decision": (label, why),
    "per_model": {model: (label, delta)}, "mech": {...}}}"""
    # baseline per gen (each gen = one model)
    base = {}  # gen -> (model, rows)
    for g in gens:
        rows = load_rows(os.path.join(results_dir, f"{g}-r0-base.jsonl"))
        if rows:
            base[g] = (rows[0]["model"], rows)
    # candidate name -> {gen: rows}
    cand_rows = collections.defaultdict(dict)
    for g in gens:
        for idx, name in ledger_candidates(g, results_dir):
            rows = load_rows(os.path.join(results_dir, f"{g}-r0-c{idx}.jsonl"))
            if rows:
                cand_rows[name][g] = (idx, rows)
    out = {}
    for name, per_gen in sorted(cand_rows.items()):
        stats, mech = {}, {}
        for g, (idx, rows) in per_gen.items():
            if g not in base:
                continue
            model, brows = base[g]
            bk, bn, _, _ = arm_stats(brows)
            ck, cn, rf, rc = arm_stats(rows)
            stats[model] = (bk, bn, ck, cn)
            m = {"retry_fired": rf, "retry_converted": rc} if rf else {}
            tel = telemetry_counts(f"{g}-r0-c{idx}", telemetry_file)
            base_tel = telemetry_counts(f"{g}-r0-base", telemetry_file)
            for key in ("verify-gate.unverified-end", "span-tools.search", "span-tools.read", "loop-breaker.outcome-abort"):
                if tel.get(key) or base_tel.get(key):
                    m[key] = f"{base_tel.get(key, 0)}->{tel.get(key, 0)}"
            if m:
                mech[model] = m
        per_model = {m: classify(*s) for m, s in stats.items()}
        # sign direction: how many models moved up vs down (raw, not significance)
        ups = sum(1 for bk, bn, ck, cn in stats.values() if cn and bn and ck / cn > bk / bn)
        downs = sum(1 for bk, bn, ck, cn in stats.values() if cn and bn and ck / cn < bk / bn)
        # decide() wants a "daily driver" hard-gate; in fleet context the ANCHOR
        # model (first gen listed, the 4B) plays that role — its regression is a
        # hard reject, everyone else is covered by the do-no-harm clause anyway.
        label, why = decide(stats, dd_model=next(iter(stats), "?")) if stats else ("NO-DATA", "no arms")
        out[name] = {"stats": stats, "per_model": per_model, "decision": (label, why),
                     "sign": f"{ups} up / {downs} down / {len(stats) - ups - downs} flat", "mech": mech}
    return out


def render(v):
    for name, d in v.items():
        print(f"\n== {name} ==  decision: {d['decision'][0]}  ({d['decision'][1]})")
        print(f"   cross-model direction: {d['sign']}")
        for model, (bk, bn, ck, cn) in sorted(d["stats"].items()):
            lab = d["per_model"].get(model, ("?", 0))
            print(f"   {model:28} base {bk}/{bn}  cand {ck}/{cn}   {lab[0]} ({lab[1]:+.0%})")
        for model, m in sorted(d["mech"].items()):
            print(f"   mech[{model}]: {m}")


def selftest():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        def w(name, rows):
            with open(os.path.join(td, name), "w") as f:
                f.write("".join(json.dumps(r) + "\n" for r in rows))
        # gen gA: model M1, candidate order [x, y]; gen gB: model M2, order [y]
        w("munchkin-gA.jsonl", [{"round": 0, "cand": 0, "operator": "static:x", "pass": "1/4"},
                                {"round": 0, "cand": 1, "operator": "static:y", "pass": "3/4"}])
        w("munchkin-gB.jsonl", [{"round": 0, "cand": 0, "operator": "static:y", "pass": "4/4"}])
        row = lambda m, s, r=0: {"model": m, "score": s, "task": "t", "rep": 1, "retried": r}
        w("gA-r0-base.jsonl", [row("M1", 0), row("M1", 0), row("M1", 1), row("M1", 0)])
        w("gA-r0-c0.jsonl", [row("M1", 0)] * 4)                      # x: worse on M1
        w("gA-r0-c1.jsonl", [row("M1", 1), row("M1", 1), row("M1", 1, 1), row("M1", 0)])  # y: better, 1 retry->pass
        w("gB-r0-base.jsonl", [row("M2", 1), row("M2", 0), row("M2", 0), row("M2", 0)])
        w("gB-r0-c0.jsonl", [row("M2", 1)] * 4)                      # y on M2: better
        tel = os.path.join(td, "tel.jsonl")
        open(tel, "w").write("")
        v = verdicts(["gA", "gB"], results_dir=td, telemetry_file=tel)
        assert set(v) == {"x", "y"}, v.keys()
        assert v["y"]["stats"]["M1"] == (1, 4, 3, 4) and v["y"]["stats"]["M2"] == (1, 4, 4, 4), v["y"]["stats"]
        assert v["y"]["sign"] == "2 up / 0 down / 0 flat"
        assert v["x"]["sign"] == "0 up / 1 down / 0 flat"
        assert v["y"]["mech"]["M1"]["retry_fired"] == 1 and v["y"]["mech"]["M1"]["retry_converted"] == 1
        # candidate identity crossed gens correctly despite different index orderings
        assert "M2" not in v["x"]["stats"], "x never ran on M2"
    print("fleet_verdict selftest: OK (ledger identity mapping; sign; retry mechanism; per-gen indices)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        gens = [a for a in sys.argv[1:] if not a.startswith("-")]
        if not gens:
            raise SystemExit("usage: fleet_verdict.py <gen> [gen...] | --selftest")
        render(verdicts(gens))
