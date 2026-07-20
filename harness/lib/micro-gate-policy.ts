// micro-gate-policy: pure logic for the post-edit micro-gate (c21).
// After a turn that mutated source files, run the CHEAPEST deterministic check
// on just the changed files and surface the FIRST actionable error — never the
// full test suite. Motivated by the gauntlet baseline: an unnoticed bad edit
// (edit-noop fault) cost the 4B 9 turns / ~16k tokens of flailing; a parse
// check would have surfaced it in one observation.

export type Check = { file: string; kind: "node" | "python" | "json" };

const CHECKERS: Record<string, Check["kind"]> = {
	".js": "node",
	".mjs": "node",
	".cjs": "node",
	".py": "python",
	".json": "json",
};

const HEADER_RE = /\[([^\[\]#\n]+)#[0-9A-Za-z-]+\]/g;

// Paths a single edit-style tool call mutates: hashline input headers, or the
// builtin edit/write path argument.
export function changedPaths(toolName: string, input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	const args = input as Record<string, unknown>;
	if (toolName === "edit" && typeof args.input === "string") {
		const out = new Set<string>();
		for (const m of args.input.matchAll(HEADER_RE)) out.add(m[1]);
		if (out.size) return [...out];
	}
	if (toolName === "bash" && typeof args.command === "string") {
		// Conservative shell mutation coverage. Capture explicit source/config
		// paths from common in-place writes; do not pretend arbitrary scripts are
		// statically knowable.
		const cmd = args.command;
		if (!/(?:\bsed\s+-[^\n;]*i|\bperl\s+-[^\n;]*i|\btee\b|>>?|\bmv\b|\bcp\b)/.test(cmd)) return [];
		const out = new Set<string>();
		for (const m of cmd.matchAll(/(?:^|[\s'"=])([^\s'";|<>]+\.(?:[cm]?js|py|json))(?:$|[\s'";|])/g)) out.add(m[1]);
		return [...out];
	}
	if (typeof args.path === "string" && args.path) return [args.path];
	return [];
}

// The checks for one turn's changed files: dedup, checkable extensions only,
// bounded to `cap` files (cheapest-first is meaningless at n<=3; keep order).
export function checksFor(paths: string[], cap = 3): Check[] {
	const seen = new Set<string>();
	const out: Check[] = [];
	for (const p of paths) {
		if (seen.has(p)) continue;
		seen.add(p);
		const ext = p.slice(p.lastIndexOf("."));
		const kind = CHECKERS[ext];
		if (kind) out.push({ file: p, kind });
		if (out.length >= cap) break;
	}
	return out;
}

// First actionable error, bounded — the model needs the location, not a wall.
export function firstError(outputs: Array<{ file: string; err: string }>): string | null {
	for (const { file, err } of outputs) {
		const t = err.trim();
		if (t) return `${file}: ${t.split("\n").slice(0, 6).join("\n").slice(0, 600)}`;
	}
	return null;
}

// ---------- anti-slop checks (MICRO_GATE_SLOP, c29) ----------
// loopgate's preferences.py idea: deterministic detection of the shortcut
// patterns small models overproduce — error swallowing, type-escape hatches,
// suppression comments. Steer-only, never a hard block: some hits are
// legitimate, and the point is to make the model reconsider, not to fight it.

export function slopKindFor(path: string): "python" | "js" | null {
	const ext = path.slice(path.lastIndexOf("."));
	if (ext === ".py") return "python";
	if ([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx"].includes(ext)) return "js";
	return null;
}

// python3 -c source: prints `line:rule` findings to stdout, ALWAYS exits 0 —
// findings live on stdout so a crashed checker (non-zero) is distinguishable
// from a clean file. Stdlib ast only.
export const PYTHON_SLOP_SCRIPT = `
import ast, sys
try:
    tree = ast.parse(open(sys.argv[1], encoding="utf-8").read(), filename=sys.argv[1])
except Exception:
    sys.exit(0)  # unparseable files belong to the parse gate, not the slop gate
finds = []
def annotation_has_any(node):
    return node is not None and any(isinstance(n, ast.Name) and n.id == "Any" for n in ast.walk(node))
def direct_continue(body):
    for stmt in body:
        for node in ast.walk(stmt):
            if isinstance(node, (ast.For, ast.While)) and node is not stmt:
                break
            if isinstance(node, ast.Continue):
                return node
    return None
for node in ast.walk(tree):
    if isinstance(node, ast.ExceptHandler) and node.type is None and len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
        finds.append((node.lineno, "bare-except-pass"))
    elif isinstance(node, ast.Assert) and isinstance(node.test, ast.Constant) and node.test.value in (True, 1):
        finds.append((node.lineno, "lazy-assert"))
    elif isinstance(node, ast.While):
        hit = direct_continue(node.body)
        if hit is not None:
            finds.append((hit.lineno, "continue-in-while"))
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        if node.args.vararg or node.args.kwarg:
            finds.append((node.lineno, "args-kwargs-signature"))
        if annotation_has_any(node.returns) or any(annotation_has_any(a.annotation) for a in node.args.args):
            finds.append((node.lineno, "any-annotation"))
    elif isinstance(node, ast.AnnAssign) and annotation_has_any(node.annotation):
        finds.append((node.lineno, "any-annotation"))
for line, rule in sorted(set(finds))[:10]:
    print(f"{line}:{rule}")
`;

// JS/TS slop: regex-honest only (no parser dependency) — suppression comments,
// type-escape casts, and empty catch blocks are all reliably line-detectable;
// deeper structural checks would need an AST we don't ship.
const JS_SLOP_PATTERNS: Array<{ rule: string; re: RegExp }> = [
	{ rule: "ts-suppression", re: /@ts-(?:ignore|nocheck)\b/ },
	{ rule: "eslint-disable", re: /eslint-disable/ },
	{ rule: "as-any", re: /\bas\s+any\b/ },
];

export function jsSlopFindings(source: string): string[] {
	const findings: string[] = [];
	const lines = source.split("\n");
	for (let i = 0; i < lines.length; i += 1) {
		for (const { rule, re } of JS_SLOP_PATTERNS) {
			if (re.test(lines[i])) findings.push(`${i + 1}:${rule}`);
		}
	}
	// empty catch: multi-line aware, matched on the whole source
	for (const match of source.matchAll(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g)) {
		const line = source.slice(0, match.index).split("\n").length;
		findings.push(`${line}:empty-catch`);
	}
	return [...new Set(findings)].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)).slice(0, 10);
}

// Bounded steer body: first 3 findings across files.
export function formatSlop(outputs: Array<{ file: string; findings: string[] }>): string | null {
	const flat = outputs.flatMap(({ file, findings }) => findings.map((finding) => `${file}:${finding}`));
	if (flat.length === 0) return null;
	return flat.slice(0, 3).join("\n");
}
