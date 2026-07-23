#!/usr/bin/env python3
"""prompt-lab: single-shot prompt-pattern screening against the local llama-server.

Karpathy-loop screening layer: each cell = (pattern, task) sampled n times at
production settings (server temp/thinking), scored deterministically. Results
append to results/<gen>.jsonl (resumable); summary matrix + Wilson CIs printed
and written to results/<gen>-REPORT.md.

Usage:  ./promptlab.py [gen0] [--n 8] [--dry]
Server: http://127.0.0.1:8080 (override LLAMA_URL).
"""
import hashlib, json, os, re, sys, time, math, urllib.request

BASE = os.environ.get("LLAMA_URL", "http://127.0.0.1:8080")
LAB = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(LAB))  # optimizer/prompt-lab -> optimizer -> repo root
# Reproducibility: default to the repo's own version-controlled harness/ dir, not the
# mutable live ~/.pi/agent installation every consumer of GOV/EXPLORER/VERIFIER used
# to silently bind to at import time (verified byte-identical to ~/.pi/agent at the
# time this was written, 2026-07-23 -- the two can drift apart during normal dev
# iteration, which is exactly the silent-drift this default now avoids). PI_AGENT_ROOT
# still overrides explicitly, e.g. to point at the live install when that's genuinely
# what's needed.
AGENT = os.path.expanduser(os.environ.get("PI_AGENT_ROOT", os.path.join(REPO_ROOT, "harness")))

# ---------- llama-server ----------

def server_model(base=BASE):
    """The model the server actually has loaded (its --alias), via GET /v1/models.
    This is the real 'which model' signal: llama-server serves one GGUF and the
    request body's `model` field is cosmetic. Returns None if unreachable."""
    try:
        with urllib.request.urlopen(base + "/v1/models", timeout=5) as r:
            data = json.load(r).get("data") or []
        return data[0]["id"] if data else None
    except Exception:
        return None

def chat(system, user, max_tokens=6000, model="promptlab"):
    msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
    body = {"model": model, "messages": msgs, "max_tokens": max_tokens}
    req = urllib.request.Request(BASE + "/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.load(r)
    m = d["choices"][0]["message"]
    return {"content": m.get("content") or "", "reasoning": m.get("reasoning_content") or "",
            "wall": round(time.time() - t, 1), "usage": d.get("usage", {})}

# ---------- prompt material ----------

def read(p):
    with open(p) as f:
        return f.read()

GOV = read(os.path.join(AGENT, "APPEND_SYSTEM.md"))
HDR = {k: read(os.path.join(LAB, "headers", k + ".txt")) for k in "BCDE"}
NOVA = {k: read(os.path.join(LAB, "headers", "nova-" + k + ".md")) for k in ("gov", "explorer", "verifier")}

def strip_frontmatter(text):
    parts = text.split("---", 2)
    return parts[2].lstrip("\n") if len(parts) == 3 and text.startswith("---") else text

EXPLORER = strip_frontmatter(read(os.path.join(AGENT, "agents", "explorer.md")))
VERIFIER = strip_frontmatter(read(os.path.join(AGENT, "agents", "verifier.md")))

# Resolved-surface binding: hash of the actual AGENT-sourced content this run
# used (governor + role prompts), so a results row can be checked against a
# specific AGENT tree instead of trusting the path alone.
AGENT_SURFACE_SHA256 = hashlib.sha256(json.dumps(
    {"APPEND_SYSTEM.md": GOV, "agents/explorer.md": EXPLORER, "agents/verifier.md": VERIFIER},
    sort_keys=True).encode()).hexdigest()

AGENT_LINES = {
    "explorer": {"B": "explorer ≡ ⟨🔍📖⟩ ∩ 🔒 → ⟨🎯💎⟩",
                 "D": "explorer is a locked, read-only scout: find it, prove it, distill it."},
    "verifier": {"B": "verifier ≡ ⟨🕵️⚔️⟩ ⨷ ⟨claim→🔨→🔨²⟩ → ⟨✅∪❌∪❓⟩",
                 "D": "verifier is a tooled skeptic: restate the claim, attack it, audit the attack."},
}

# Register-tint candidate (pattern "R"), from the emoji-glyph guide: a single glyph
# riding alongside a register WORD, appended to the UNCHANGED word-based role prompt.
# This is the guide's reliable use ("words instruct, glyph colours the register") and is
# DISTINCT from the measured-rejected symbolect ENCODING in AGENT_LINES B/D
# (see AB_SYMBOLECT.md). It's a test variant only — A/B it; adopt only if it wins.
REGISTER_TINT = {
    "explorer": "Work in an exploratory, searching register. 🔍",
    "verifier": "Work in a skeptical, adversarial register. ⚠️",
}

def gov_variant(p):
    if p == "A": return GOV
    if p == "F": return None  # no governor at all
    if p == "G": return NOVA["gov"]  # full Nova-style structural port (content-faithful)
    return HDR[p].rstrip("\n") + "\n\n" + GOV

def agent_variant(base, name, p):
    if p == "A": return base
    if p == "C": return HDR["C"].rstrip("\n") + "\n\n" + base
    if p == "G": return NOVA[name]
    if p == "F":  # strip the MODE role-anchor line
        return "\n".join(l for l in base.splitlines() if not l.startswith("MODE:")) .lstrip("\n")
    if p == "R":  # register tint: glyph alongside a register word, on the unchanged base
        return base + "\n\n" + REGISTER_TINT[name]
    return AGENT_LINES[name][p] + "\n\n" + base

# ---------- fixtures ----------

HASHLINE_DESC = """Edit files with a hashline patch. ONE param `input`:

*** Begin Patch
[src/app.ts#3F2A9C01]
replace 12..13:
+const x = load();
+use(x);
insert after 20:
+log("done");
delete 30..31
*** End Patch

Ops: replace N..M: · insert before N: / after N: / head: / tail: · delete N..M. Body rows start with "+" and are the FINAL content (never old lines, never context). "+" alone = blank line. TAG + line numbers come from your LATEST read or edit response.
Critical: (1) COPY the #TAG character-for-character from that read/edit header — never type one from memory, never this example's. (2) every edit mints a fresh #TAG and renumbers the file — take the next edit's numbers from the edit response or a fresh read, never memory. (3) Ranges tight: only lines whose content changes. (4) Multiple files = multiple [path#TAG] sections in one patch."""

CONFIG_READ = """[config/server.js#7E4F9A2B]
1:// server configuration
2:const HOST = '127.0.0.1';
3:
4:const PORT = 3000;
5:const RETRIES = 3;
6:
7:const LEGACY_MODE = true; // dead: no longer read
8:
9:export { HOST, PORT, RETRIES, LEGACY_MODE };"""

ALIGN_READ = """[src/align.js#3C9D71E4]
1:// Column alignment helpers (tab-indented house style)
2:
3:export function alignLeft(s, width) {
4:\tif (s.length >= width) {\t
5:\t\treturn s;
6:\t}
7:\treturn s + ' '.repeat(width - s.length);
8:}
9:
10:export function alignRight(s, width) {
11:\tif (s.length >= width) {\t
12:\t\treturn s;
13:\t}
14:\treturn s + ' '.repeat(width - s.length);
15:}
16:
17:export function center(s, width) {
18:\tif (s.length >= width) {\t
19:\t\treturn s;
20:\t}
21:\tconst extra = width - s.length;
22:\tconst left = Math.ceil(extra / 2);
23:\tconst right = extra - left;
24:\treturn ' '.repeat(left) + s + ' '.repeat(right);
25:}"""

ALIGN_FAILS = """✖ alignRight pads on the left
  AssertionError: Expected '   ab' but got 'ab   '   (alignRight('ab', 5))
✖ center puts the smaller pad on the left
  AssertionError: Expected ' ab  ' but got '  ab '   (center('ab', 5))"""

INDEX_READ_LINES = []
_fixture = os.path.expanduser(os.environ.get("PI_TEST_FIXTURE", os.path.join(LAB, "..", "pi-test")))
with open(os.path.join(_fixture, "src", "index.js")) as _f:
    for _i, _l in enumerate(_f.read().rstrip("\n").split("\n"), 1):
        INDEX_READ_LINES.append(f"{_i}:{_l}")
INDEX_READ = "[src/index.js#5B8C2D1F]\n" + "\n".join(INDEX_READ_LINES)

# ---------- patch parsing / scorers ----------

HUNK_RE = re.compile(r"^(replace|delete)\s+(\d+)(?:\.\.(\d+))?:?\s*$|^insert\s+(before|after)\s+(\d+):\s*$|^insert\s+(head|tail):\s*$", re.M)

def parse_patch(text):
    """Return (tag, hunks=[(op, start, end, [body...])]) of the FIRST file section, or None."""
    m = re.search(r"\[([^\]#]+)#([0-9A-Fa-f]{4,8})\]", text)
    if not m: return None
    tag = m.group(2)
    lines = text[m.end():].splitlines()
    hunks, cur = [], None
    for l in lines:
        if l.startswith("*** End Patch") or re.match(r"\[[^\]#]+#[0-9A-Fa-f]{4,8}\]", l):
            break
        hm = re.match(r"^(replace|delete)\s+(\d+)(?:\.\.(\d+))?:?\s*$", l.strip())
        im = re.match(r"^insert\s+(before|after|head|tail)\s*(\d+)?:\s*$", l.strip())
        if hm:
            cur = [hm.group(1), int(hm.group(2)), int(hm.group(3) or hm.group(2)), []]
            hunks.append(cur)
        elif im:
            cur = ["insert-" + im.group(1), int(im.group(2) or 0), int(im.group(2) or 0), []]
            hunks.append(cur)
        elif l.startswith("+") and cur is not None:
            cur[3].append(l[1:])
    return (tag, hunks) if hunks else None

def touched(hunks):
    out = set()
    for op, s, e, _ in hunks:
        if op in ("replace", "delete"):
            out.update(range(s, e + 1))
        else:
            out.add(s)
    return out

def score_hashline_edit(r):
    p = parse_patch(r["content"])
    if not p: return 0, "no parsable patch"
    tag, hunks = p
    if tag.upper() == "A1B2": return 0, "copied example tag"
    if tag.upper() != "7E4F9A2B": return 0, f"wrong tag {tag}"
    t = touched(hunks)
    port_ok = any(op == "replace" and s <= 4 <= e and any("const PORT = 8080;" == b.strip() or "const PORT = 8080" in b for b in body)
                  for op, s, e, body in hunks)
    del_ok = any(op == "delete" and s <= 7 <= e for op, s, e, b in hunks)
    extra = t - {4, 7} - ({6, 8} if del_ok else set())  # tolerate blank-line absorption around the delete
    if port_ok and del_ok and not (t - {4, 7}): return 1, "ok"
    if port_ok and del_ok and not extra: return 1, "ok (blank-line absorbed)"
    return 0, f"port={port_ok} del={del_ok} touched={sorted(t)}"

def score_ws_trap(r):
    p = parse_patch(r["content"])
    if not p: return 0, "no parsable patch"
    tag, hunks = p
    if tag.upper() != "3C9D71E4": return 0, f"wrong tag {tag}"
    t = touched(hunks)
    fix14 = any(op == "replace" and s <= 14 <= e and any(re.match(r"^\treturn ' '\.repeat\(width - s\.length\) \+ s;\s*$", b) for b in body)
                for op, s, e, body in hunks)
    fix22 = any(op == "replace" and s <= 22 <= e and any("Math.floor" in b and b.startswith("\t") for b in body)
                for op, s, e, body in hunks)
    if fix14 and fix22 and not (t - {14, 22}): return 1, "ok"
    return 0, f"fix14={fix14} fix22={fix22} touched={sorted(t)}"

FLUFF = re.compile(r"\b(sure|certainly|happy to|hope this helps|basically|in conclusion)\b", re.I)

def score_brevity(r):
    c = r["content"].strip()
    has = ("-mtime -1" in c) or ("-newermt" in c) or ("-mtime 0" in c)
    return (1, "ok") if has and len(c) <= 250 and not FLUFF.search(c) else \
           (0, f"has_answer={has} len={len(c)} fluff={bool(FLUFF.search(c))}")

def score_explorer(r):
    c = r["content"]
    res = re.search(r"^\s*\**\s*RESULT:\s*(.+)$", c, re.M)
    ev = re.search(r"^\s*\**\s*EVIDENCE:", c, re.M)
    fi = re.search(r"^\s*\**\s*FINDINGS:", c, re.M)
    correct = bool(res and "csvToJson" in res.group(1) and re.search(r"\b(2|two)\b", res.group(1)))
    if res and ev and fi and correct: return 1, "ok"
    return 0, f"fmt={bool(res and ev and fi)} correct={correct}"

def score_verifier(r):
    c = r["content"]
    v = re.search(r"^\s*\**\s*VERDICT:\s*\**\s*refuted", c, re.M | re.I)
    ev = re.search(r"^\s*\**\s*EVIDENCE:", c, re.M)
    wh = re.search(r"^\s*\**\s*WHY:", c, re.M)
    if v and ev and wh: return 1, "ok"
    return 0, f"verdict={bool(v)} evidence={bool(ev)} why={bool(wh)}"

# ---------- task table ----------

TASKS = {
    "hashline_edit": {
        "kind": "gov", "patterns": list("ABCDEFG"), "score": score_hashline_edit,
        "user": f"{HASHLINE_DESC}\n\nCurrent file:\n{CONFIG_READ}\n\nChange PORT to 8080 (line 4) and delete the dead LEGACY_MODE line (line 7). Leave everything else untouched, including the export line. Output ONLY the patch.",
    },
    "ws_trap": {
        "kind": "gov", "patterns": list("ABCDEFG"), "score": score_ws_trap,
        "user": f"{HASHLINE_DESC}\n\nCurrent file:\n{ALIGN_READ}\n\nFailing tests:\n{ALIGN_FAILS}\n\nFix both bugs with minimal edits — preserve the file's tab indentation exactly. Output ONLY the patch.",
    },
    "brevity": {
        "kind": "gov", "patterns": list("ABCDEFG"), "score": score_brevity,
        "user": "Quick one-liner: find all files under the current directory modified in the last 24 hours?",
    },
    "explorer_contract": {
        "kind": "explorer", "patterns": list("ABCDFGR"), "score": score_explorer,
        "user": f"Question: which exported function in src/index.js converts parsed CSV data to a JSON string, and with what indentation?\n\n{INDEX_READ}",
    },
    "verifier_verdict": {
        "kind": "verifier", "patterns": list("ABCDFGR"), "score": score_verifier,
        "user": f"CLAIM: src/index.js exports a function named parseJSON that parses a JSON string into row objects.\n\nEvidence available:\n{INDEX_READ}\n\nYou cannot run tools in this check — judge from the file content shown.",
    },
}

def system_for(task, p):
    kind = TASKS[task]["kind"]
    if kind == "gov": return gov_variant(p)
    if kind == "explorer": return agent_variant(EXPLORER, "explorer", p)
    return agent_variant(VERIFIER, "verifier", p)

# ---------- run ----------

def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0, c - h), min(1, c + h))

def main():
    argv = sys.argv[1:]
    gen = next((a for a in argv if not a.startswith("-")), "gen0")
    n = int(argv[argv.index("--n") + 1]) if "--n" in argv else 8
    dry = "--dry" in argv
    # multi-model: tag rows with the loaded alias (or --model); restrict patterns
    # for cheap fleet sweeps (e.g. --patterns A,F = governor on vs off).
    tag = argv[argv.index("--model") + 1] if "--model" in argv else (server_model() or "promptlab")
    only = set(argv[argv.index("--patterns") + 1].split(",")) if "--patterns" in argv else None
    only_tasks = set(argv[argv.index("--tasks") + 1].split(",")) if "--tasks" in argv else None
    out = os.path.join(LAB, "results", gen + ".jsonl")
    done = set()
    if os.path.exists(out):
        for line in open(out):
            try:
                d = json.loads(line); done.add((d["task"], d["pattern"], d["rep"], d.get("model")))
            except Exception: pass
    cells = [(rep, t, p) for rep in range(n) for t in TASKS if only_tasks is None or t in only_tasks
             for p in TASKS[t]["patterns"] if only is None or p in only]
    todo = [c for c in cells if (c[1], c[2], c[0], tag) not in done]
    print(f"{gen}: {len(todo)} calls to run ({len(done)} done) · model={tag}" + (f" · patterns={','.join(sorted(only))}" if only else ""))
    if dry:
        for rep, t, p in todo[:10]: print("  would run:", t, p, "rep", rep, "model", tag)
        return
    with open(out, "a") as f:
        for i, (rep, t, p) in enumerate(todo):
            r = chat(system_for(t, p), TASKS[t]["user"], model=tag)
            score, detail = TASKS[t]["score"](r)
            rec = {"task": t, "pattern": p, "rep": rep, "model": tag, "split": "val",
                   "score": score, "detail": detail,
                   "wall": r["wall"], "content": r["content"][:2000],
                   "out_chars": len(r["content"]), "think_chars": len(r["reasoning"]),
                   "agent_root": AGENT, "agent_surface_sha256": AGENT_SURFACE_SHA256}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n"); f.flush()
            print(f"[{i+1}/{len(todo)}] {t:18} {p} {tag} rep{rep} -> {score} ({r['wall']}s) {detail[:50]}")
    # summary: one score matrix per model
    agg = {}
    for line in open(out):
        d = json.loads(line)
        agg.setdefault((d.get("model", "?"), d["task"], d["pattern"]), []).append(d["score"])
    models = sorted({k[0] for k in agg})
    rep_lines = [f"# prompt-lab {gen} — score matrix (per model)\n"]
    for mdl in models:
        rep_lines += [f"## {mdl}", "| task | " + " | ".join("ABCDEFGR") + " |", "|---|" + "---|" * 8]
        for t in TASKS:
            row = [t]
            for p in "ABCDEFGR":
                s = agg.get((mdl, t, p), [])
                row.append(f"{sum(s)}/{len(s)} ({wilson(sum(s),len(s))[1]:.0%}–{wilson(sum(s),len(s))[2]:.0%})" if s else "—")
            rep_lines.append("| " + " | ".join(row) + " |")
        rep_lines.append("")
    report = "\n".join(rep_lines) + "\n"
    with open(os.path.join(LAB, "results", gen + "-REPORT.md"), "w") as f:
        f.write(report)
    print("\n" + report)

if __name__ == "__main__":
    main()
