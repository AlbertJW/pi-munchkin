"""Graded subscores from `node --test` TAP reporter output — graded-by-default.

The reboot's D3: instead of every fixture authoring a grader artifact, real_gate
re-runs ONLY the hidden fail-to-pass suite with `--test-reporter=tap
--test-reporter-destination=<file OUTSIDE the workdir>` and this module parses
the per-test results into the same shape `grade_artifact.extract` produces:

    subscores = {"fixed": int, "total": int, "source": "tap-reporter",
                 "detail": {test_name: bool, ...}}

Refusal ladder (never a guess, mirrors grade_artifact):
    missing TAP file            -> subscores_blocked "missing"
    no TAP header / no results  -> subscores_blocked "unparseable"
    every test skipped/todo     -> subscores_blocked "no_gradeable_tests"

Honesty notes:
- Only TOP-LEVEL TAP results are graded (fixtures author flat `test()` suites;
  the graded run points at exactly one hidden file, so top level = its tests).
- If model-authored src crashes the suite at import, TAP shows the single
  failing file entry: fixed=0, total=1. graded_rate is correctly 0.0, but the
  recorded total under-reports the suite's true size — read `detail` before
  comparing totals across rows.
- Forgery bar (SECURITY_BOUNDARY.md): the demonstrated import-time
  `writeFileSync`-at-the-pinned-name forgery does not translate — the reporter
  destination is outside the workdir and written by the runner, and stdout from
  model code does not reach it. Residual: code running inside the test process
  can sniff `process.execArgv` for the destination path and race a write; the
  named full fix remains an out-of-process verifier (deferred, documented).
"""

import re

SKIP_RE = re.compile(r"#\s*(?:SKIP|TODO)", re.IGNORECASE)
RESULT_RE = re.compile(r"^(not )?ok\s+\d+\s+-\s+(.*?)\s*(#.*)?$")
MAX_NAME_CHARS = 200
MAX_TESTS = 500


def extract_tap(text):
    """Parse TAP text -> (subscores, subscores_blocked); exactly one is set."""
    if text is None:
        return None, "missing"
    lines = text.splitlines()
    if not any(line.startswith("TAP version") for line in lines[:5]):
        return None, "unparseable"
    detail = {}
    skipped = 0
    for line in lines:
        match = RESULT_RE.match(line)  # top-level only: indented subtests don't match ^
        if not match:
            continue
        failed, raw_name, directive = match.group(1), match.group(2), match.group(3)
        if directive and SKIP_RE.search(directive):
            skipped += 1
            continue
        name = raw_name[:MAX_NAME_CHARS]
        if name in detail:
            name = f"{name}#{sum(1 for existing in detail if existing.startswith(name)) + 1}"
        detail[name] = not failed
        if len(detail) > MAX_TESTS:
            return None, "unparseable"
    if not detail:
        return None, "no_gradeable_tests" if skipped else "unparseable"
    return {"fixed": sum(detail.values()), "total": len(detail),
            "source": "tap-reporter", "detail": detail}, None


def extract(tap_path):
    """File-path front end used by real_gate's row builder."""
    try:
        with open(tap_path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return None, "missing"
    return extract_tap(text)


def selftest():
    # Vendored sample from node v26 (`--test-reporter=tap`), trimmed diagnostics.
    real = """TAP version 13
# Subtest: alpha passes
ok 1 - alpha passes
  ---
  duration_ms: 0.37
  ...
# Subtest: beta fails
not ok 2 - beta fails
  ---
  failureType: 'testCodeFailure'
  error: '1 == 2'
  ...
1..2
# tests 2
# pass 1
# fail 1
"""
    subscores, blocked = extract_tap(real)
    assert blocked is None and subscores == {
        "fixed": 1, "total": 2, "source": "tap-reporter",
        "detail": {"alpha passes": True, "beta fails": False}}, subscores
    # Nested subtests are NOT graded — only top-level results count.
    nested = "TAP version 13\n# Subtest: suite\n    ok 1 - inner\nok 1 - suite\n1..1\n"
    subscores, _ = extract_tap(nested)
    assert subscores == {"fixed": 1, "total": 1, "source": "tap-reporter", "detail": {"suite": True}}
    # Skip/todo are excluded; all-skipped is a refusal, not a perfect score.
    skippy = "TAP version 13\nok 1 - a # SKIP flaky\nok 2 - b # TODO later\n1..2\n"
    assert extract_tap(skippy) == (None, "no_gradeable_tests")
    part = "TAP version 13\nok 1 - a # SKIP\nnot ok 2 - b\n1..2\n"
    subscores, _ = extract_tap(part)
    assert subscores["total"] == 1 and subscores["fixed"] == 0
    # Refusals: missing, headerless, empty — never a score.
    assert extract_tap(None) == (None, "missing")
    assert extract_tap("random stdout the model printed\nok 1 - forged\n") == (None, "unparseable")
    assert extract_tap("TAP version 13\n# nothing ran\n") == (None, "unparseable")
    # Duplicate names stay distinct rather than last-wins.
    dup = "TAP version 13\nok 1 - same\nnot ok 2 - same\n1..2\n"
    subscores, _ = extract_tap(dup)
    assert subscores["total"] == 2 and subscores["fixed"] == 1
    # A suite-load crash grades as fixed=0 (model broke the suite), not a refusal.
    crash = "TAP version 13\n# Subtest: test/hidden.test.js\nnot ok 1 - test/hidden.test.js\n1..1\n"
    subscores, _ = extract_tap(crash)
    assert subscores == {"fixed": 0, "total": 1, "source": "tap-reporter",
                         "detail": {"test/hidden.test.js": False}}
    print("grade_reporter selftest: OK")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        selftest()
    elif len(sys.argv) > 1:
        print(extract(sys.argv[1]))
    else:
        print(__doc__)
