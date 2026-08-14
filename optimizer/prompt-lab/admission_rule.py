"""The ONE fixture-admission rule — mechanical binding of PREREG_FIXTURE_ADMISSION_2026-08.md.

Thresholds are preregistered constants; no caller may restate them locally
(failure_episode_trial.calibration() delegates here, as does the calibration
report path). Changing any value requires a new preregistration document that
names the current one as superseded, committed before the data it governs.

Two deliberately separate questions:
  core_admission(sample)      -> is this fixture a discriminating instrument
                                 for this model tier at all? (all fixtures)
  episode_eligibility(sample) -> may it additionally feed a
                                 semantic_failure_overrun study? (loop cohort
                                 only — E1 is trial eligibility, NOT admission;
                                 conflating the two was the 2026-08-13 scope
                                 error this module corrects)
"""

# Preregistered thresholds — PREREG_FIXTURE_ADMISSION_2026-08.md, verbatim.
N_REQUIRED = 6            # base-arm sessions per fixture per model tier
COVERAGE_MIN = 5          # A1: rows carrying subscores (of N_REQUIRED)
BAND_LOW, BAND_HIGH = 0.20, 0.80   # A2: graded_rate mean band, inclusive
SD_MIN = 0.15             # A3: graded_rate sample-SD floor
BINARY_LOW, BINARY_HIGH = 2, 4     # transitional clause, grader-less fixtures
EPISODE_SESSIONS_MIN = 2  # E1: sessions with >=1 failure episode
SLATE_ADMITTED_MIN = 2    # slate readiness

VERDICTS = ("ADMITTED", "SATURATED", "FLOORED", "DEGENERATE", "UNMEASURABLE", "INSUFFICIENT_N")


def graded_rate(row):
    """subscores.fixed/total for one row, or None when absent/refused/malformed.

    A subscores_blocked row is a grader refusal, never a zero — scoring a
    refusal as 0.0 would let a broken grader masquerade as a hard fixture.
    """
    subscores = row.get("subscores")
    if not isinstance(subscores, dict):
        return None
    fixed, total = subscores.get("fixed"), subscores.get("total")
    if not isinstance(fixed, int) or not isinstance(total, int) or total <= 0 or not 0 <= fixed <= total:
        return None
    return fixed / total


def _sample_sd(values):
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return (sum((v - mean) ** 2 for v in values) / (len(values) - 1)) ** 0.5


def core_admission(sample):
    """Apply the core rule to one fixture's base-arm rows for one model tier.

    Returns {"verdict", "path", ...evidence}. The caller supplies exactly the
    rows it means to judge (same fixture, same model, base arm, one canonical
    generation, authoritative+complete) — population discipline is the caller's
    contract, deliberately outside this function, so the rule itself stays a
    pure arithmetic statement of the prereg.
    """
    if len(sample) != N_REQUIRED:
        return {"verdict": "INSUFFICIENT_N", "path": None, "n": len(sample)}

    graded_attempted = any(("subscores" in row) or ("subscores_blocked" in row) for row in sample)
    if graded_attempted:
        rates = [rate for rate in (graded_rate(row) for row in sample) if rate is not None]
        coverage = len(rates)
        if coverage < COVERAGE_MIN:
            return {"verdict": "UNMEASURABLE", "path": "graded", "coverage": coverage}
        mean = sum(rates) / len(rates)
        sd = _sample_sd(rates)
        evidence = {"path": "graded", "coverage": coverage,
                    "mean": round(mean, 4), "sd": round(sd, 4)}
        if mean > BAND_HIGH:
            return {"verdict": "SATURATED", **evidence}
        if mean < BAND_LOW:
            return {"verdict": "FLOORED", **evidence}
        if sd < SD_MIN:
            return {"verdict": "DEGENERATE", **evidence}
        return {"verdict": "ADMITTED", **evidence}

    # Transitional clause: no grader anywhere in the sample -> binary gate bit.
    # Expires when the last grader-less fixture leaves the slate; new fixtures
    # may not be authored grader-less (fixture_admission enforces the manifest side).
    correct = sum(1 for row in sample if row.get("score") == 1)
    evidence = {"path": "binary", "correct": correct}
    if correct > BINARY_HIGH:
        return {"verdict": "SATURATED", **evidence}
    if correct < BINARY_LOW:
        return {"verdict": "FLOORED", **evidence}
    return {"verdict": "ADMITTED", **evidence}


def episode_eligibility(sample):
    """E1: eligible for semantic_failure_overrun studies (loop cohort only)."""
    exposed = sum(
        1 for row in sample
        if (((row.get("context") or {}).get("failure_episodes") or {}).get("total_episodes", 0) or 0) > 0
    )
    return {"eligible": exposed >= EPISODE_SESSIONS_MIN, "exposed_sessions": exposed}


def slate_ready(verdicts):
    """>= SLATE_ADMITTED_MIN fixtures ADMITTED for the tier under test."""
    admitted = sum(1 for verdict in verdicts if verdict.get("verdict") == "ADMITTED")
    return {"ready": admitted >= SLATE_ADMITTED_MIN, "admitted": admitted}


def selftest():
    def graded_row(fixed, total=8, episodes=0):
        return {"score": 1 if fixed == total else 0,
                "subscores": {"fixed": fixed, "total": total},
                "context": {"failure_episodes": {"total_episodes": episodes}}}

    def binary_row(score, episodes=0):
        return {"score": score, "context": {"failure_episodes": {"total_episodes": episodes}}}

    # ADMITTED: mid-band mean with real variance.
    mixed = [graded_row(f) for f in (1, 2, 3, 4, 5, 6)]
    verdict = core_admission(mixed)
    assert verdict["verdict"] == "ADMITTED" and verdict["path"] == "graded", verdict
    # SATURATED / FLOORED at the graded band edges (boundaries inclusive stay admitted).
    assert core_admission([graded_row(8) for _ in range(6)])["verdict"] == "SATURATED"
    assert core_admission([graded_row(0) for _ in range(6)])["verdict"] == "FLOORED"
    boundary = core_admission([graded_row(1), graded_row(1), graded_row(1),
                               graded_row(1), graded_row(1), graded_row(4)])
    assert boundary["verdict"] in ("ADMITTED", "FLOORED"), boundary  # mean .1875 -> FLOORED
    assert boundary["verdict"] == "FLOORED"
    # DEGENERATE: identical mid-band scores discriminate nothing.
    assert core_admission([graded_row(4) for _ in range(6)])["verdict"] == "DEGENERATE"
    # UNMEASURABLE: grader attempted but refused too often; refusals never score 0.
    refused = [graded_row(4), graded_row(5)] + [{"score": 0, "subscores_blocked": "malformed"} for _ in range(4)]
    assert core_admission(refused)["verdict"] == "UNMEASURABLE"
    # INSUFFICIENT_N is a verdict, not an exception — partial rounds are visible.
    assert core_admission(mixed[:4])["verdict"] == "INSUFFICIENT_N"
    # Transitional binary clause only when NO row attempted grading.
    assert core_admission([binary_row(1)] * 3 + [binary_row(0)] * 3)["verdict"] == "ADMITTED"
    assert core_admission([binary_row(1)] * 5 + [binary_row(0)])["verdict"] == "SATURATED"
    assert core_admission([binary_row(1)] + [binary_row(0)] * 5)["verdict"] == "FLOORED"
    # E1 is separate from admission and counts sessions, not episodes.
    sample = [binary_row(1, episodes=3), binary_row(0, episodes=1)] + [binary_row(1)] * 4
    assert episode_eligibility(sample) == {"eligible": True, "exposed_sessions": 2}
    assert episode_eligibility([binary_row(1, episodes=9)] + [binary_row(0)] * 5)["eligible"] is False
    # Slate readiness.
    assert slate_ready([{"verdict": "ADMITTED"}, {"verdict": "ADMITTED"}, {"verdict": "FLOORED"}])["ready"]
    assert not slate_ready([{"verdict": "ADMITTED"}, {"verdict": "SATURATED"}])["ready"]
    # Malformed subscores are refusals, not zeros.
    bad = [{"score": 0, "subscores": {"fixed": 9, "total": 8}}] * 6
    assert core_admission(bad)["verdict"] == "UNMEASURABLE"
    print("admission_rule selftest: OK")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        selftest()
    else:
        print(__doc__)
