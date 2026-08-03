"""Read a fixture's PINNED grader artifact. Single source of truth for real_gate.sh.

real_gate.sh used to glob `$wd/.*-grade.json` and read `sorted(...)[0]`. The workdir is
model-writable for the whole session (`gate.sb` grants `file-write*`; GATE_BASE_TOOLS
includes write/edit/bash), and `.a-grade.json` sorts ahead of `.audit-grade.json` — so a
decoy would have been read INSTEAD of the grader's own output, and under
`effort_report.py --graded` that artifact is the round's primary outcome.

`rm -f` before grading does NOT close this: `node --test` runs OUTSIDE the sandbox and
imports model-authored `src/`, so model code executes *during* grading and can write the
decoy at import time. The only durable fix is a contract — the fixture declares its
artifact name in the manifest (`tests.fail_to_pass.grade_artifact`, carried to the row
builder as `row-context.grade_artifact`), and anything that does not match it is a
REFUSAL, never a pick. A decoy must cost the session its subscores; it must never forge
them.

Refusal is always fail-safe: no subscores block, `score` (the strict binary gate bit) is
untouched, and the reason lands on the row as `subscores_blocked` so a silent zero-graded
round is distinguishable from a fixture that simply has no grader.

WHAT THIS DOES NOT DO (stated exactly, because an earlier version of this docstring claimed
"a decoy must cost the session its subscores; it must never forge them", which overpromises).
Pinning the NAME cannot authenticate CONTENT written to a path the adversary controls. Model
code that writes the *pinned* name and then aborts the grader before it overwrites — any throw
at import of model-authored `src/` — yields a forged `subscores` with no refusal. Demonstrated
2026-08-03: prepending a `writeFileSync(".audit-grade.json", {fixed:8,total:8})` plus a throw to
audit-sweep's `src/db.js` produced a full 8/8 with `blocked=None`.

The obvious hardening does not work: an HMAC or an inherited fd cannot help, because
model-authored `src/` is imported into the SAME node process as the grader and can read the key
or write the fd (also measured). Closing it properly needs the grader to run somewhere the
model's code does not — a separate process over a serialized result, which is a real change to
`real_gate.sh` and out of scope for a parked instrument.

So the guarantee is exactly: **decoy-at-another-name picking is closed; forgery at the pinned
name is not.** That residual is accepted under the same threat model as the writable gate
transcript (`docs/SECURITY_BOUNDARY.md`) — it needs deliberate adversarial behaviour from the
measured model, and `audit-sweep` has never been run, so no existing measurement depends on it.
"""
import glob
import json
import os


def extract(workdir, expected):
    """-> (subscores | None, blocked_reason | None). Never raises; never picks."""
    try:
        hits = sorted(os.path.basename(p) for p in glob.glob(os.path.join(workdir, ".*-grade.json")))
        if not expected:
            # An artifact nobody declared. Not necessarily an attack — could be a fixture
            # that grew a grader and never pinned it — but it must not be scored silently.
            return None, ("unpinned:%d" % len(hits) if hits else None)
        if expected not in hits:
            return None, "missing"
        if len(hits) > 1:
            return None, "ambiguous:%d" % len(hits)
        g = json.loads(open(os.path.join(workdir, expected), encoding="utf-8").read())
        fixed, total = g.get("fixed"), g.get("total")
        # bool is a subclass of int: `{"fixed": true}` would otherwise score 1/total.
        if isinstance(fixed, bool) or isinstance(total, bool):
            return None, "malformed"
        if not (isinstance(fixed, int) and isinstance(total, int) and total > 0 and 0 <= fixed <= total):
            return None, "malformed"
        out = {"fixed": fixed, "total": total, "source": expected}
        d = g.get("defects")
        if isinstance(d, dict) and all(isinstance(v, bool) for v in d.values()):
            out["detail"] = d
        return out, None
    except Exception as e:  # a malformed artifact must never fail a row
        return None, "error:%s" % type(e).__name__
