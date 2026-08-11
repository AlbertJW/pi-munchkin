#!/usr/bin/env python3
"""shadow_report: read the shadow instruments and answer the three checkpoint
questions with numbers instead of impressions.

The run-kernel series ships observational-only: the kernel, the control arbiter,
the run capsule and the semantic failure-episode tracker all record what they
WOULD have done without doing it. Before any of them is armed, three questions
have to be answered from real sessions:

  1. Does the kernel agree with the legacy mechanisms it might one day replace?
     Disagreements are not automatically legacy defects — a kernel blind spot
     produces them too (one such gap, plan gates, was found and fixed 2026-08-11).
     So this reports disagreement RATES per dimension for a human to explain,
     and refuses to call it a pass on its own.
  2. Are semantic failure episodes exposed often enough to study? If almost no
     session exposes one, an intervention trial is underpowered by construction
     and the round would be wasted box time.
  3. Do runs reach settlement, i.e. is the instrument seeing whole sessions?

Session identity and population discipline (2026-08-11 finding):

  - A session is identified by the envelope's `si` field — one random id per pi
    process (telemetry.ts). `run_id` is NOT identity: it falls back to the cwd
    key for interactive rows and can carry plan/experiment ids from detail, so
    keying on it both collapsed forty runs into one observation (the 29% bug)
    and can split one session into pseudo-sessions. Rows without `si` (written
    before the field existed) are counted and EXCLUDED — inventing identity for
    them produced two wrong exposure numbers in a row (29%, then 0%).
  - All rates are computed within ONE harness surface hash (default: the most
    recent one in the stream). Pooling across surface hashes violates the
    boundary-row rule.

Every rate is therefore over identity-sound sessions on the bound surface, or
it is reported as UNKNOWN — never a number computed on a mixed population.

Thresholds are declared here, before the data is read.

  ./shadow_report.py                       # the live interactive stream
  ./shadow_report.py --file path.jsonl     # a specific capture
  ./shadow_report.py --source gate         # gate rows instead of interactive
  ./shadow_report.py --surface <sha256>    # bind a specific surface hash
  ./shadow_report.py --selftest            # offline
"""
import argparse
import collections
import json
import os
import sys

MIN_SESSIONS = 30            # below this, every rate below is noise
MIN_EXPOSURE_SHARE = 0.20    # sessions exposing >=1 failure episode
MAX_DISAGREEMENT_SHARE = 0.25  # per dimension, above this the kernel is suspect


def default_path():
    agent_dir = os.environ.get("PI_CODING_AGENT_DIR") or os.path.expanduser("~/.pi/agent")
    return os.path.join(agent_dir, "telemetry", "events.jsonl")


def load(path, source):
    rows = []
    with open(path) as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue  # a crash-truncated tail is not evidence
            if source and row.get("source") != source:
                continue
            rows.append(row)
    return rows


def bind_surface(rows, surface=None):
    """Keep only rows from one harness surface hash.

    Default: the most recent surface seen in the stream (rows are appended in
    time order). Returns (bound_rows, surface, excluded_row_count). Rows with
    no surface hash at all are excluded too — they cannot be attributed.
    """
    if surface is None:
        for row in reversed(rows):
            candidate = row.get("harness_surface_sha256")
            if candidate:
                surface = candidate
                break
    if surface is None:
        return [], None, len(rows)
    bound = [r for r in rows if r.get("harness_surface_sha256") == surface]
    return bound, surface, len(rows) - len(bound)


def split_by_identity(rows):
    """Partition rows into identity-sound (carrying `si`) and legacy.

    Only `si` counts: one random id per pi process, immune to the cwd-collapse
    (sk), the fallback aliasing (run_id == sk), and detail-supplied run ids.
    """
    sound, legacy = [], []
    for row in rows:
        (sound if isinstance(row.get("si"), str) and row["si"] else legacy).append(row)
    return sound, legacy


def analyse(rows, surface=None):
    bound, surface, excluded_other_surface = bind_surface(rows, surface)
    sound, legacy = split_by_identity(bound)

    sessions = collections.defaultdict(lambda: {
        "disagreements": collections.Counter(), "episodes_opened": 0,
        "episodes_exposed": 0, "recovered": 0, "settled": False, "kernel_receipts": 0,
    })
    for row in sound:
        session = sessions[row["si"]]
        ext, kind = row.get("ext"), row.get("kind")
        if ext == "run-kernel" and kind == "legacy-disagreement":
            session["disagreements"][row.get("dimension", "?")] += 1
        elif ext == "run-kernel" and kind == "receipt":
            session["kernel_receipts"] += 1
        elif ext == "run-kernel" and kind == "settled":
            session["settled"] = True
        elif ext == "failure-episode" and kind == "opened":
            session["episodes_opened"] += 1
        elif ext == "failure-episode" and kind == "observed":
            session["episodes_exposed"] += 1
        elif ext == "failure-episode" and kind == "recovered":
            session["recovered"] += 1

    population = {
        "surface": surface,
        "rows_excluded_other_or_no_surface": excluded_other_surface,
        "rows_excluded_no_session_identity": len(legacy),
        "identity_sound_rows": len(sound),
    }
    total = len(sessions)
    if not total:
        return {"sessions": 0, "population": population, "verdict": "unknown",
                "reason": "no identity-sound sessions on the bound surface — "
                          "accumulate sessions written by a harness that emits `si` "
                          "before citing any rate"}

    # Count SESSIONS per dimension, not rows: a session that disagrees five times
    # on one dimension is one disagreeing session, and rows/sessions produced a
    # "share" above 1.0 the first time this ran against real data.
    dimensions = collections.Counter()
    dimension_rows = collections.Counter()
    sessions_with_disagreement = 0
    for session in sessions.values():
        if session["disagreements"]:
            sessions_with_disagreement += 1
        for dimension, count in session["disagreements"].items():
            dimensions[dimension] += 1
            dimension_rows[dimension] += count

    exposed = sum(1 for s in sessions.values() if s["episodes_exposed"] > 0)
    opened = sum(1 for s in sessions.values() if s["episodes_opened"] > 0)
    recovered = sum(s["recovered"] for s in sessions.values())
    settled = sum(1 for s in sessions.values() if s["settled"])
    observed = sum(1 for s in sessions.values() if s["kernel_receipts"] > 0)

    # A dimension's rate is over sessions where the KERNEL was actually observing;
    # dividing by all sessions would flatter a kernel that simply never ran.
    denominator = observed or total
    per_dimension = {
        dimension: {"sessions": count, "rows": dimension_rows[dimension],
                    "share_of_observed_sessions": round(count / denominator, 3)}
        for dimension, count in dimensions.most_common()
    }
    hot = [d for d, stats in per_dimension.items()
           if stats["share_of_observed_sessions"] > MAX_DISAGREEMENT_SHARE]

    return {
        "sessions": total,
        "population": population,
        "sessions_with_kernel_receipts": observed,
        "q1_kernel_agreement": {
            "sessions_with_any_disagreement": sessions_with_disagreement,
            "share": round(sessions_with_disagreement / denominator, 3),
            "per_dimension": per_dimension,
            "dimensions_over_threshold": hot,
        },
        "q2_episode_exposure": {
            "sessions_opening_an_episode": opened,
            "sessions_exposing_an_episode": exposed,
            "exposure_share": round(exposed / total, 3),
            "recoveries": recovered,
            "sufficient": exposed / total >= MIN_EXPOSURE_SHARE,
        },
        "q3_settlement": {
            # Over ALL sessions: settlement is emitted by the run capsule as well as
            # the kernel, so dividing by kernel-observed sessions gave shares > 1.
            "sessions_settled": settled,
            "share": round(settled / total, 3),
        },
        "enough_sessions": total >= MIN_SESSIONS,
    }


def verdict_lines(report):
    if not report.get("sessions"):
        reason = report.get("reason", "run some real sessions first")
        return [f"UNKNOWN — {reason}."]
    lines = []
    excluded = report["population"]["rows_excluded_no_session_identity"]
    if excluded:
        lines.append(f"NOTE: {excluded} row(s) without session identity excluded — "
                     "rates below cover only identity-sound sessions.")
    if not report["enough_sessions"]:
        lines.append(f"HOLD: {report['sessions']} sessions < {MIN_SESSIONS}; every rate here is noise.")
    q1, q2 = report["q1_kernel_agreement"], report["q2_episode_exposure"]
    if q1["dimensions_over_threshold"]:
        lines.append("EXPLAIN: disagreement above threshold on " + ", ".join(q1["dimensions_over_threshold"]) +
                     " — determine whether the KERNEL or the legacy path is wrong before arming anything.")
    else:
        lines.append("Kernel agreement within threshold on every dimension (still requires a human read).")
    if q2["sufficient"]:
        lines.append(f"Episode exposure {q2['exposure_share']:.0%} >= {MIN_EXPOSURE_SHARE:.0%}: a loop-intervention trial is powerable.")
    else:
        lines.append(f"UNDERPOWERED: episode exposure {q2['exposure_share']:.0%} < {MIN_EXPOSURE_SHARE:.0%}; "
                     "an intervention trial would measure almost nothing. Harder fixtures first.")
    lines.append("This report NEVER authorizes arming a mechanism on its own — it says whether a trial is worth box time.")
    return lines


def selftest():
    seq_counter = {"n": 0}

    def row(si, ext, kind, surface="hashA", **extra):
        seq_counter["n"] += 1
        base = dict(sk="myrepo", ext=ext, kind=kind, source="interactive",
                    seq=seq_counter["n"], harness_surface_sha256=surface, **extra)
        if si is not None:
            base["si"] = si
        return base

    unknown = analyse([])
    assert unknown["sessions"] == 0 and unknown["verdict"] == "unknown"
    assert any("UNKNOWN" in line for line in verdict_lines(unknown))

    rows = []
    for index in range(10):
        session = f"s{index}"
        rows.append(row(session, "run-kernel", "receipt"))
        rows.append(row(session, "run-kernel", "settled"))
        if index < 3:
            rows.append(row(session, "failure-episode", "opened"))
            rows.append(row(session, "failure-episode", "observed"))
        if index < 1:
            rows.append(row(session, "run-kernel", "legacy-disagreement", dimension="verify_ok"))
    report = analyse(rows)
    assert report["sessions"] == 10, report
    assert report["q2_episode_exposure"]["exposure_share"] == 0.3
    assert report["q2_episode_exposure"]["sufficient"] is True
    assert report["q1_kernel_agreement"]["per_dimension"]["verify_ok"] == {"sessions": 1, "rows": 1, "share_of_observed_sessions": 0.1}
    assert report["q1_kernel_agreement"]["dimensions_over_threshold"] == []
    assert report["enough_sessions"] is False, "10 sessions must not read as enough"

    # A kernel that disagrees on most sessions must be flagged, not averaged away.
    noisy = [row(f"n{i}", "run-kernel", "receipt") for i in range(10)]
    noisy += [row(f"n{i}", "run-kernel", "legacy-disagreement", dimension="verify_mutated") for i in range(9)]
    noisy_report = analyse(noisy)
    assert noisy_report["q1_kernel_agreement"]["dimensions_over_threshold"] == ["verify_mutated"]
    for stats in noisy_report["q1_kernel_agreement"]["per_dimension"].values():
        assert stats["share_of_observed_sessions"] <= 1.0, stats

    # No exposure at all must read as underpowered, not as a clean bill of health.
    quiet = [row(f"q{i}", "run-kernel", "receipt") for i in range(40)]
    quiet_report = analyse(quiet)
    assert quiet_report["enough_sessions"] is True
    assert 0.0 <= quiet_report["q3_settlement"]["share"] <= 1.0, "a share must be a share"
    assert quiet_report["q2_episode_exposure"]["sufficient"] is False
    assert any("UNDERPOWERED" in line for line in verdict_lines(quiet_report))

    # SESSION identity is `si` and nothing else. Forty rows sharing one sk (and
    # forty run_ids, which detail can forge) but distinct si are forty sessions...
    forty = [row(f"proc{i}", "run-kernel", "receipt", run_id=f"r{i}") for i in range(40)]
    assert analyse(forty)["sessions"] == 40

    # ...one si carrying MANY run_ids (plan ids in detail) is ONE session, not
    # several pseudo-sessions — the run_id-splitting bug.
    one = [row("proc0", "run-kernel", "receipt", run_id=f"plan{i}") for i in range(5)]
    assert analyse(one)["sessions"] == 1, "run_id must not split one process into pseudo-sessions"

    # Rows WITHOUT si are excluded and counted, never guessed at: a mixed
    # population must not produce a numeric exposure claim from legacy rows.
    legacy_only = [dict(sk="myrepo", ext="failure-episode", kind="observed",
                        source="interactive", seq=i + 1, run_id="myrepo",
                        harness_surface_sha256="hashA") for i in range(50)]
    legacy_report = analyse(legacy_only)
    assert legacy_report["sessions"] == 0 and legacy_report["verdict"] == "unknown", \
        "legacy rows without si must yield UNKNOWN, not a rate (the 29%-then-0% bug)"
    assert legacy_report["population"]["rows_excluded_no_session_identity"] == 50

    # Surface binding: rows from an older surface hash never pool into the rates.
    mixed = [row(f"new{i}", "run-kernel", "receipt", surface="hashB") for i in range(3)]
    mixed += [row(f"old{i}", "failure-episode", "observed", surface="hashA") for i in range(30)]
    mixed_report = analyse(mixed)  # binds hashA: the most RECENT surface in the stream
    assert mixed_report["population"]["surface"] == "hashA"
    assert mixed_report["sessions"] == 30
    assert mixed_report["population"]["rows_excluded_other_or_no_surface"] == 3
    pinned = analyse(mixed, surface="hashB")
    assert pinned["sessions"] == 3 and pinned["population"]["surface"] == "hashB"

    print("shadow_report selftest: ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", default=None)
    parser.add_argument("--source", default="interactive", help="telemetry source filter ('' for all)")
    parser.add_argument("--surface", default=None, help="harness surface sha256 to bind (default: most recent in stream)")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return 0
    path = args.file or default_path()
    if not os.path.exists(path):
        print(f"no telemetry at {path}")
        return 1
    report = analyse(load(path, args.source or None), surface=args.surface)
    print(json.dumps(report, indent=2))
    print()
    for line in verdict_lines(report):
        print(f"  {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
