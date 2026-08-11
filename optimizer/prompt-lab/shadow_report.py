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

Thresholds are declared here, before the data is read.

  ./shadow_report.py                       # the live interactive stream
  ./shadow_report.py --file path.jsonl     # a specific capture
  ./shadow_report.py --source gate         # gate rows instead of interactive
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


def session_keys(rows):
    """One key per SESSION, not per working directory.

    `sk` is the cwd basename (telemetry.ts:32) — unique per gate rep, but every
    interactive session in the same repository shares it, so keying on sk alone
    collapsed forty runs into one observation and silently invalidated the
    30-session floor. `seq` is a per-process counter (telemetry.ts:77) that
    restarts with each pi process, and for the sessions this report counts a
    process IS the session. Key: run_id when the row carries one (gate rows),
    else sk + a process epoch that increments whenever seq stops increasing.
    """
    keys = []
    epochs = collections.defaultdict(int)      # sk -> current epoch
    last_seq = {}                              # sk -> last seq seen
    for row in rows:
        sk = row.get("sk") or "unknown"
        run_id = row.get("run_id")
        seq = row.get("seq")
        if isinstance(seq, (int, float)):
            if sk in last_seq and seq <= last_seq[sk]:
                epochs[sk] += 1
            last_seq[sk] = seq
        keys.append(str(run_id) if run_id else f"{sk}#p{epochs[sk]}")
    return keys


def analyse(rows):
    sessions = collections.defaultdict(lambda: {
        "disagreements": collections.Counter(), "episodes_opened": 0,
        "episodes_exposed": 0, "recovered": 0, "settled": False, "kernel_receipts": 0,
    })
    keys = session_keys(rows)
    for key, row in zip(keys, rows):
        session = sessions[key]
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

    total = len(sessions)
    if not total:
        return {"sessions": 0, "verdict": "no data"}

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
        return ["NO DATA — run some real sessions first."]
    lines = []
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

    def row(sk, ext, kind, **extra):
        seq_counter["n"] += 1
        return dict(sk=sk, ext=ext, kind=kind, source="interactive", seq=seq_counter["n"], **extra)

    assert analyse([])["sessions"] == 0
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
    # SESSION keying, not working-directory keying (the forty-runs-one-repo bug):
    # forty rows sharing one sk but carrying distinct run_ids are forty sessions.
    forty = [dict(sk="myrepo", ext="run-kernel", kind="receipt", source="interactive",
                  seq=i + 1, run_id=f"r{i}") for i in range(40)]
    assert analyse(forty)["sessions"] == 40, "distinct run_ids must not collapse into one sk bucket"

    # ...and without run_ids, a seq RESET marks a new pi process = new session.
    resets = []
    for process_index in range(3):
        for seq in (1, 2, 3):
            resets.append(dict(sk="myrepo", ext="run-kernel", kind="receipt",
                               source="interactive", seq=seq))
    assert analyse(resets)["sessions"] == 3, "seq resets are process/session boundaries"

    print("shadow_report selftest: ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", default=None)
    parser.add_argument("--source", default="interactive", help="telemetry source filter ('' for all)")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return 0
    path = args.file or default_path()
    if not os.path.exists(path):
        print(f"no telemetry at {path}")
        return 1
    report = analyse(load(path, args.source or None))
    print(json.dumps(report, indent=2))
    print()
    for line in verdict_lines(report):
        print(f"  {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
