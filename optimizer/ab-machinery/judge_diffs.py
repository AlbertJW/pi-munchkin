#!/usr/bin/env python3
"""ab-machinery solution-quality judge (optional, off the hot path).

For a task BOTH arms passed the gate on, the deterministic metrics tie on
correctness — so judge the soft dimension: which arm's change is cleaner / more
minimal? Diff each arm's final src/ against the pristine pi-test/src/ and hand
the two diffs to prompt-lab/judge.py's already-tested judge_pair (pairwise,
randomized order). Needs FRONTIER_* env; run manually after a sweep.

Usage:  judge_diffs.py <arm_a_workdir> <arm_b_workdir> --task <taskfile>
        judge_diffs.py --selftest      # no network, no disk
"""
import difflib, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "prompt-lab"))
FIXTURE_SRC = os.path.expanduser("~/LLM/pi-test/src")

def dir_diff(orig, new):
    """Unified diff between two {relpath: content} maps. Stdlib, testable off-disk."""
    out = []
    for path in sorted(set(orig) | set(new)):
        a = orig.get(path, "").splitlines(keepends=True)
        b = new.get(path, "").splitlines(keepends=True)
        out.extend(difflib.unified_diff(a, b, fromfile=f"a/{path}", tofile=f"b/{path}"))
    return "".join(out)

def read_src(d):
    files = {}
    for root, _, names in os.walk(d):
        for n in names:
            p = os.path.join(root, n)
            files[os.path.relpath(p, d)] = open(p, encoding="utf-8", errors="replace").read()
    return files

def selftest():
    orig = {"a.js": "const x = 1;\n"}
    changed = {"a.js": "const x = 2;\n"}
    d = dir_diff(orig, changed)
    assert "const x = 1;" in d and "const x = 2;" in d and d.strip(), "diff should be non-empty and show both"
    assert dir_diff(orig, orig) == "", "no change -> empty diff"
    # verdict mapping is judge.py's tested path; confirm it imports + runs with a stub.
    import judge
    win1 = lambda s, u: "WINNER: 1\nWHY: stub"
    assert judge.judge_pair("task", "diffA", "diffB", order="AB", call=win1)[0] == "A"
    print("judge_diffs selftest: OK (dir_diff non-empty on change, empty on no-change; judge_pair reused)")

def main():
    if "--selftest" in sys.argv:
        selftest(); return
    import judge
    a_dir, b_dir = sys.argv[1], sys.argv[2]
    task_path = sys.argv[sys.argv.index("--task") + 1]
    task = open(task_path).read().strip()
    orig = read_src(FIXTURE_SRC)
    diff_a = dir_diff(orig, read_src(os.path.join(a_dir, "src")))
    diff_b = dir_diff(orig, read_src(os.path.join(b_dir, "src")))
    rubric = "the cleaner, more minimal change that fully accomplishes the task without unrelated edits"
    winner, slot, order = judge.judge_pair(task, diff_a, diff_b, rubric=rubric)
    print(f"task: {task[:60]}…")
    print(f"A={a_dir}\nB={b_dir}")
    print(f"winner: {winner} (judged slot {slot}, order {order})")

if __name__ == "__main__":
    main()
