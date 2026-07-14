#!/usr/bin/env python3
"""fleet_verdict: stitch per-model munchkin gen-families into per-CANDIDATE fleet
verdicts. munchkin runs one model per gen (f4a=4B, f4b=2B, f4c=mellum) and its
candidate INDEX ordering differs per gen — candidate identity comes from each
gen's ledger (operator "static:<name>"), never from file names.

  ./fleet_verdict.py f4a f4b f4c        # full verdicts (needs completed gens)
  ./fleet_verdict.py --selftest         # offline

Per candidate: per-model Wilson/Fisher classification + the fleet decision
(reused from fleet_report), cross-model sign direction, and mechanism metrics
(retried conversions from rows; per-arm telemetry via sk keys).

Decision hardening (audit 2026-07-13 — the verdict layer previously verdicted on
whatever arms happened to exist):
  INCOMPLETE     — a ledger-declared candidate arm is missing rows, or its
                   (task, rep) cells don't match its gen's baseline cells. An
                   interrupted fleet can no longer produce an adoption verdict.
  MIXED-SIGNS    — an ADOPT-* from decide() is HELD when any model's point
                   estimate moved down: cross-model sign consistency is part of
                   the decision function, not display.
  TASK-REGRESSION— an ADOPT-* is HELD when any single (model, task) stratum
                   significantly regresses (Fisher within-task): the Simpson
                   guard as a rule, not a manual habit.
  exploratory    — any ADOPT-* from a round with >1 candidate is stamped
                   exploratory: confirm in a single-candidate round before live
                   adoption (multiplicity control by procedure).
Telemetry joins prefer the rows' `run` id ({gen_arm}-{run}-) when present —
exact per-run; legacy rows fall back to the bare arm prefix."""
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


def cells(rows):
    """The (task, rep) grid a result file covers, WITH multiplicities — a set let
    duplicated rows (the orphaned-gate incident class) pass as complete (audit-2)."""
    return collections.Counter((r["task"], r["rep"]) for r in rows)


def run_ids(rows):
    return {r.get("run") for r in rows if r.get("run")}


def run_consistency(rows):
    """'ok' | 'mixed-ids' | 'mixed-legacy' — an arm must be ALL-legacy (no run
    fields at all) or ALL rows sharing exactly one run id. Some-legacy-some-current
    looked like a single run to a non-empty-ids check (audit-3)."""
    with_run = sum(1 for r in rows if r.get("run"))
    ids = run_ids(rows)
    if with_run == 0:
        return "ok"  # fully legacy
    if with_run < len(rows):
        return "mixed-legacy"
    return "ok" if len(ids) == 1 else "mixed-ids"


def _tel_prefix(g, arm, rows):
    """Exact per-run telemetry key when rows carry `run`, else the legacy prefix
    (legacy-only: multi-run arms are INCOMPLETE before reaching telemetry)."""
    runs = run_ids(rows)
    return f"{g}-r0-{arm}-{runs.pop()}-" if len(runs) == 1 else f"{g}-r0-{arm}"


def task_regressions(brows, crows):
    """(model-agnostic) tasks where the candidate SIGNIFICANTLY regresses within-task
    — the Simpson guard. Returns [(task, bk, bn, ck, cn)]."""
    hits = []
    for task in sorted({r["task"] for r in brows}):
        bt = [r for r in brows if r["task"] == task]
        ct = [r for r in crows if r["task"] == task]
        if not bt or not ct:
            continue
        bk, bn = sum(r["score"] for r in bt), len(bt)
        ck, cn = sum(r["score"] for r in ct), len(ct)
        if classify(bk, bn, ck, cn)[0] == "worse":
            hits.append((task, bk, bn, ck, cn))
    return hits


def verdicts(gens, results_dir=RESULTS, telemetry_file=TELEMETRY, manifest=None):
    """{candidate_name: {"stats": {model: (bk,bn,ck,cn)}, "decision": (label, why),
    "per_model": {model: (label, delta)}, "mech": {...}}}. See module docstring for
    the INCOMPLETE / MIXED-SIGNS / TASK-REGRESSION / exploratory hardening.

    manifest (audit-3): {"candidates": {name: [gens]}} declares the expected
    candidate x gen matrix — a candidate entirely absent from a declared gen's
    LEDGER is unknowable from ledgers alone and previously produced an
    adoption-shaped verdict on the subset that happened to exist. Without a
    manifest, completeness is relative to ledgers only (a caveat is emitted)."""
    # baseline per gen (each gen = one model)
    base = {}  # gen -> (model, rows)
    for g in gens:
        rows = load_rows(os.path.join(results_dir, f"{g}-r0-base.jsonl"))
        if rows:
            base[g] = (rows[0]["model"], rows)
    # candidate name -> {gen: rows}; ledger-declared arms with missing/mismatched
    # cells are recorded as incomplete, not silently skipped
    cand_rows = collections.defaultdict(dict)
    incomplete = collections.defaultdict(list)  # name -> [reason]
    for g in gens:
        for idx, name in ledger_candidates(g, results_dir):
            rows = load_rows(os.path.join(results_dir, f"{g}-r0-c{idx}.jsonl"))
            if not rows:
                incomplete[name].append(f"{g}: ledger declares c{idx} but no rows")
                continue
            if g not in base:
                # audit-2: a candidate with rows but NO baseline gen was silently
                # skipped later — it must be a named incompleteness, not an omission
                incomplete[name].append(f"{g}: candidate rows exist but the gen has no baseline rows")
                continue
            rc, bc = run_consistency(rows), run_consistency(base[g][1])
            if rc != "ok" or bc != "ok":
                # audit-2/3: rows from more than one gate invocation, or a mix of
                # legacy and run-stamped rows — either way not ONE clean run
                incomplete[name].append(f"{g}: run-id inconsistency (arm={rc}, base={bc})")
                continue
            if cells(rows) != cells(base[g][1]):
                missing = sum((cells(base[g][1]) - cells(rows)).values())
                extra = sum((cells(rows) - cells(base[g][1])).values())
                incomplete[name].append(f"{g}: cells mismatch base (missing {missing}, extra/dup {extra})")
                continue
            cand_rows[name][g] = (idx, rows)
    # manifest check: declared (candidate, gen) pairs the ledgers never mention
    if manifest:
        for name, mgens in (manifest.get("candidates") or {}).items():
            seen_gens = set(cand_rows.get(name, {})) | {r.split(":", 1)[0] for r in incomplete.get(name, [])}
            for g in mgens:
                if g in gens and g not in seen_gens:
                    incomplete[name].append(f"{g}: manifest declares this candidate but the gen's ledger has no trace of it")
    multi_candidate_round = len(set(cand_rows) | set(incomplete)) > 1
    out = {}
    for name in sorted(set(cand_rows) | set(incomplete)):
        per_gen = cand_rows.get(name, {})
        stats, mech, task_hits = {}, {}, []
        for g, (idx, rows) in per_gen.items():
            if g not in base:
                continue
            model, brows = base[g]
            bk, bn, _, _ = arm_stats(brows)
            ck, cn, rf, rc = arm_stats(rows)
            stats[model] = (bk, bn, ck, cn)
            task_hits += [(model, *h) for h in task_regressions(brows, rows)]
            m = {"retry_fired": rf, "retry_converted": rc} if rf else {}
            tel = telemetry_counts(_tel_prefix(g, f"c{idx}", rows), telemetry_file)
            base_tel = telemetry_counts(_tel_prefix(g, "base", brows), telemetry_file)
            for key in ("verify-gate.unverified-end", "span-tools.search", "span-tools.read", "loop-breaker.outcome-abort"):
                if tel.get(key) or base_tel.get(key):
                    m[key] = f"{base_tel.get(key, 0)}->{tel.get(key, 0)}"
            if m:
                mech[model] = m
        per_model = {m: classify(*s) for m, s in stats.items()}
        ups = sum(1 for bk, bn, ck, cn in stats.values() if cn and bn and ck / cn > bk / bn)
        downs = sum(1 for bk, bn, ck, cn in stats.values() if cn and bn and ck / cn < bk / bn)
        # ---- the decision, hardened ----
        if incomplete.get(name):
            label, why = "INCOMPLETE", "; ".join(incomplete[name]) + " — no verdict on partial fleets"
        elif not stats:
            label, why = "NO-DATA", "no arms"
        else:
            # decide() wants a "daily driver" hard-gate; in fleet context the ANCHOR
            # model (first gen listed) plays that role — its regression is a hard
            # reject, everyone else is covered by the do-no-harm clause anyway.
            label, why = decide(stats, dd_model=next(iter(stats), "?"))
            if label.startswith("ADOPT") and downs > 0:
                label, why = "MIXED-SIGNS", (f"gain exists but {downs} model(s) moved down — "
                                             f"cross-model sign consistency gates adoption; was: {label} ({why})")
            elif label.startswith("ADOPT") and task_hits:
                det = "; ".join(f"{m}/{t} {bk}/{bn}->{ck}/{cn}" for m, t, bk, bn, ck, cn in task_hits)
                label, why = "TASK-REGRESSION", f"pooled gain hides a within-task regression ({det}); was: {label}"
            elif label.startswith("ADOPT") and multi_candidate_round:
                why += " [exploratory: multi-candidate round — confirm in a single-candidate round before live adoption]"
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
        row = lambda m, s, r=0, task="t", rep=1, run=None: {"model": m, "score": s, "task": task, "rep": rep,
                                                            "retried": r, **({"run": run} if run else {})}
        # 4 distinct reps per arm so completeness cells match (task fixed, reps 1-4)
        reps = lambda m, scores, r=0: [row(m, s, r if i == 2 else 0, rep=i + 1) for i, s in enumerate(scores)]
        w("gA-r0-base.jsonl", reps("M1", [0, 0, 1, 0]))
        w("gA-r0-c0.jsonl", reps("M1", [0, 0, 0, 0]))                # x: worse on M1
        w("gA-r0-c1.jsonl", reps("M1", [1, 1, 1, 0], r=1))           # y: better, 1 retry->pass
        w("gB-r0-base.jsonl", reps("M2", [1, 0, 0, 0]))
        w("gB-r0-c0.jsonl", reps("M2", [1, 1, 1, 1]))                # y on M2: better
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

        # INCOMPLETE: ledger declares an arm with no rows -> no verdict, ever
        w("munchkin-gC.jsonl", [{"round": 0, "cand": 0, "operator": "static:z", "pass": "0/0"}])
        w("gC-r0-base.jsonl", reps("M3", [1, 0, 1, 0]))
        v = verdicts(["gC"], results_dir=td, telemetry_file=tel)
        assert v["z"]["decision"][0] == "INCOMPLETE", v["z"]["decision"]

        # INCOMPLETE: rows exist but (task, rep) cells don't match the baseline grid
        w("munchkin-gD.jsonl", [{"round": 0, "cand": 0, "operator": "static:p", "pass": "2/2"}])
        w("gD-r0-base.jsonl", reps("M4", [1, 0, 1, 0]))
        w("gD-r0-c0.jsonl", reps("M4", [1, 1])[:2])                  # only reps 1-2: interrupted arm
        v = verdicts(["gD"], results_dir=td, telemetry_file=tel)
        assert v["p"]["decision"][0] == "INCOMPLETE" and "cells mismatch" in v["p"]["decision"][1], v["p"]["decision"]

        # MIXED-SIGNS: significant gain on one model + a (non-significant) decline on
        # another used to ADOPT; sign consistency now holds it.
        w("munchkin-gE.jsonl", [{"round": 0, "cand": 0, "operator": "static:q", "pass": "x"}])
        w("munchkin-gF.jsonl", [{"round": 0, "cand": 0, "operator": "static:q", "pass": "x"}])
        n12 = lambda m, k, r=0: [row(m, 1 if i < k else 0, rep=i + 1) for i in range(12)]
        w("gE-r0-base.jsonl", n12("M5", 2)); w("gE-r0-c0.jsonl", n12("M5", 10))   # up, significant
        w("gF-r0-base.jsonl", n12("M6", 10)); w("gF-r0-c0.jsonl", n12("M6", 9))   # down, noise
        v = verdicts(["gE", "gF"], results_dir=td, telemetry_file=tel)
        assert v["q"]["decision"][0] == "MIXED-SIGNS", v["q"]["decision"]

        # TASK-REGRESSION: pooled significant gain hiding a significant within-task loss
        w("munchkin-gG.jsonl", [{"round": 0, "cand": 0, "operator": "static:s", "pass": "x"}])
        tk = lambda m, task, k, n: [row(m, 1 if i < k else 0, task=task, rep=i + 1) for i in range(n)]
        w("gG-r0-base.jsonl", tk("M7", "a", 0, 20) + tk("M7", "b", 10, 10))
        w("gG-r0-c0.jsonl", tk("M7", "a", 20, 20) + tk("M7", "b", 4, 10))
        v = verdicts(["gG"], results_dir=td, telemetry_file=tel)
        assert v["s"]["decision"][0] == "TASK-REGRESSION", v["s"]["decision"]

        # exploratory stamp: a clean ADOPT in a multi-candidate round carries the caveat
        w("munchkin-gH.jsonl", [{"round": 0, "cand": 0, "operator": "static:u", "pass": "x"},
                                {"round": 0, "cand": 1, "operator": "static:v", "pass": "x"}])
        w("gH-r0-base.jsonl", n12("M8", 2))
        w("gH-r0-c0.jsonl", n12("M8", 11)); w("gH-r0-c1.jsonl", n12("M8", 2))
        v = verdicts(["gH"], results_dir=td, telemetry_file=tel)
        assert v["u"]["decision"][0].startswith("ADOPT") and "exploratory" in v["u"]["decision"][1], v["u"]["decision"]

        # run-exact telemetry: same gen label, two runs — only the rows' run id counts
        w("munchkin-gI.jsonl", [{"round": 0, "cand": 0, "operator": "static:t9", "pass": "x"}])
        w("gI-r0-base.jsonl", [row("M9", 0, rep=i + 1, run="new123") for i in range(4)])
        w("gI-r0-c0.jsonl", [row("M9", 1, rep=i + 1, run="new123") for i in range(4)])
        with open(tel, "w") as f:
            f.write(json.dumps({"sk": "gI-r0-c0-old999-M9-x-t-1", "ext": "verify-gate", "kind": "unverified-end"}) + "\n")
            f.write(json.dumps({"sk": "gI-r0-c0-new123-M9-x-t-1", "ext": "verify-gate", "kind": "unverified-end"}) + "\n")
            f.write(json.dumps({"sk": "gI-r0-c0-new123-M9-x-t-2", "ext": "verify-gate", "kind": "unverified-end"}) + "\n")
        v = verdicts(["gI"], results_dir=td, telemetry_file=tel)
        assert v["t9"]["mech"]["M9"]["verify-gate.unverified-end"] == "0->2", v["t9"]["mech"]

        # audit-2 completeness: DUPLICATED rows must mismatch (sets passed them)
        w("munchkin-gJ.jsonl", [{"round": 0, "cand": 0, "operator": "static:dup", "pass": "x"}])
        w("gJ-r0-base.jsonl", reps("MA", [1, 0, 1, 0]))
        w("gJ-r0-c0.jsonl", reps("MA", [1, 1, 1, 0]) + [row("MA", 1, rep=1)])  # rep 1 duplicated
        v = verdicts(["gJ"], results_dir=td, telemetry_file=tel)
        assert v["dup"]["decision"][0] == "INCOMPLETE" and "extra/dup" in v["dup"]["decision"][1], v["dup"]["decision"]

        # audit-2: candidate rows but NO baseline gen -> INCOMPLETE, not silence
        w("munchkin-gK.jsonl", [{"round": 0, "cand": 0, "operator": "static:nb", "pass": "x"}])
        w("gK-r0-c0.jsonl", reps("MB", [1, 1, 1, 1]))
        v = verdicts(["gK"], results_dir=td, telemetry_file=tel)
        assert v["nb"]["decision"][0] == "INCOMPLETE" and "no baseline" in v["nb"]["decision"][1], v["nb"]["decision"]

        # audit-2: mixed run ids in one arm -> INCOMPLETE (no broad telemetry fallback)
        w("munchkin-gL.jsonl", [{"round": 0, "cand": 0, "operator": "static:mr", "pass": "x"}])
        w("gL-r0-base.jsonl", [row("MC", 1, rep=i + 1, run="aaa111") for i in range(4)])
        w("gL-r0-c0.jsonl", [row("MC", 1, rep=i + 1, run="aaa111" if i < 2 else "bbb222") for i in range(4)])
        v = verdicts(["gL"], results_dir=td, telemetry_file=tel)
        assert v["mr"]["decision"][0] == "INCOMPLETE" and "mixed-ids" in v["mr"]["decision"][1], v["mr"]["decision"]

        # audit-3: SOME legacy rows + SOME run-stamped rows looked like one clean run
        w("munchkin-gM.jsonl", [{"round": 0, "cand": 0, "operator": "static:ml", "pass": "x"}])
        w("gM-r0-base.jsonl", [row("MD", 1, rep=i + 1, run="ccc333") for i in range(4)])
        w("gM-r0-c0.jsonl", [row("MD", 1, rep=i + 1, run="ccc333" if i < 2 else None) for i in range(4)])
        v = verdicts(["gM"], results_dir=td, telemetry_file=tel)
        assert v["ml"]["decision"][0] == "INCOMPLETE" and "mixed-legacy" in v["ml"]["decision"][1], v["ml"]["decision"]

        # audit-3: manifest declares a candidate x gen the ledger never mentions
        w("munchkin-gN.jsonl", [{"round": 0, "cand": 0, "operator": "static:mf", "pass": "x"}])
        w("gN-r0-base.jsonl", reps("ME", [1, 0, 1, 0]))
        w("gN-r0-c0.jsonl", reps("ME", [1, 1, 1, 1]))
        w("munchkin-gO.jsonl", [])  # gO ran but its ledger never declared mf
        w("gO-r0-base.jsonl", reps("MF", [1, 0, 1, 0]))
        man = {"candidates": {"mf": ["gN", "gO"]}}
        v = verdicts(["gN", "gO"], results_dir=td, telemetry_file=tel, manifest=man)
        assert v["mf"]["decision"][0] == "INCOMPLETE" and "no trace" in v["mf"]["decision"][1], v["mf"]["decision"]
        # without the manifest, the same data yields a verdict on the subset (the audit-3 gap)
        v = verdicts(["gN", "gO"], results_dir=td, telemetry_file=tel)
        assert v["mf"]["decision"][0] != "INCOMPLETE", "ledger-only view cannot know gO was expected"
    print("fleet_verdict selftest: OK (identity mapping; sign; retry mech; INCOMPLETE x6 incl. "
          "dup-rows/no-baseline/mixed-ids/mixed-legacy/manifest; MIXED-SIGNS; TASK-REGRESSION; "
          "exploratory stamp; run-exact telemetry)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        gens = [a for a in sys.argv[1:] if not a.startswith("-")]
        if not gens:
            raise SystemExit("usage: fleet_verdict.py <gen> [gen...] [--manifest m.json] | --selftest")
        manifest = None
        if "--manifest" in sys.argv:
            manifest = json.load(open(sys.argv[sys.argv.index("--manifest") + 1]))
        else:
            print("[fleet_verdict] no --manifest: completeness is relative to what the ledgers declare only")
        render(verdicts(gens, manifest=manifest))
