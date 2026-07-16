#!/usr/bin/env python3
"""Prompt-equivalence consistency and paired one-shot lift report."""
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
VARIANTS = ["canonical", "equivalent-1", "equivalent-2", "equivalent-3"]


def selected(rows, arm, variant):
    split = "val" if variant == "canonical" and arm != "one-shot" else "robustness"
    return [r for r in rows if r.get("arm", r.get("pattern")) == arm and r.get("split") == split
            and (r.get("prompt") or {}).get("variant", "canonical") == variant]


def metrics(rows, arm):
    rates = {}
    cells = collections.defaultdict(dict)
    for variant in VARIANTS:
        part = selected(rows, arm, variant)
        rates[variant] = (sum(r["score"] for r in part) / len(part)) if part else None
        for row in part:
            cells[(row.get("model"), row.get("task"), row.get("rep", row.get("repetition")))][variant] = row["score"]
    complete = [v for v in cells.values() if all(x in v for x in VARIANTS)]
    consistent = sum(len(set(v.values())) == 1 for v in complete) / len(complete) if complete else None
    present = [v for v in rates.values() if v is not None]
    return {"rates": rates, "worst": min(present) if present else None,
            "spread": max(present) - min(present) if present else None,
            "consistent": consistent, "paired_cells": len(complete)}


def paired_lift(rows, arm):
    harness = {(r.get("model"), r["task"], r.get("rep", r.get("repetition"))): r["score"]
               for r in selected(rows, arm, "canonical")}
    control = {(r.get("model"), r["task"], r.get("rep", r.get("repetition"))): r["score"]
               for r in selected(rows, "one-shot", "canonical") if r.get("status") != "ineligible"}
    keys = sorted(harness.keys() & control.keys())
    return ((sum(harness[k] - control[k] for k in keys) / len(keys)) if keys else None, len(keys))


def render(gen, baseline, candidate):
    path = HERE / "results" / f"{gen}.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    lines = [f"# robustness {gen}", "", "| arm | canonical | eq-1 | eq-2 | eq-3 | worst | spread | identical paired cells |",
             "|---|---:|---:|---:|---:|---:|---:|---:|"]
    fmt = lambda x: "—" if x is None else f"{x:.0%}"
    for arm in (baseline, candidate, "one-shot"):
        stat = metrics(rows, arm); r = stat["rates"]
        lines.append(f"| {arm} | {fmt(r['canonical'])} | {fmt(r['equivalent-1'])} | {fmt(r['equivalent-2'])} | {fmt(r['equivalent-3'])} | {fmt(stat['worst'])} | {fmt(stat['spread'])} | {fmt(stat['consistent'])} (n={stat['paired_cells']}) |")
    lines += ["", "## Paired harness lift over one-shot", ""]
    for arm in (baseline, candidate):
        lift, n = paired_lift(rows, arm); lines.append(f"- {arm}: {fmt(lift)} (n={n}; diagnostic only)")
    lines += ["", "Canonical `val` rows remain the only adoption evidence; equivalence and one-shot rows are diagnostic.", ""]
    out = HERE / "results" / f"{gen}-ROBUSTNESS.md"; out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines)); return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("gen"); ap.add_argument("--baseline", default="base"); ap.add_argument("--candidate", default="cand")
    args = ap.parse_args(); render(args.gen, args.baseline, args.candidate)


if __name__ == "__main__": main()
