#!/usr/bin/env bash
# Read-only sanity check for the pi.dev harness. No writes, no model calls.
# Exit 0 if everything checks out, 1 otherwise. Run: npm run health
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "pi-health: $ROOT"

# A clean clone has examples only; an installed harness may have local config files.
SETTINGS="settings.json"
MODELS="models.json"
[ -f "$SETTINGS" ] || SETTINGS="settings.example.json"
[ -f "$MODELS" ] || MODELS="models.example.json"

# 1. Config JSON parses
for f in "$SETTINGS" "$MODELS"; do
  if node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$f" 2>/dev/null; then ok "$f parses"; else bad "$f invalid JSON"; fi
done

# 2. Every extension + lib TypeScript file parses (syntax only)
ts_bad=0
for f in extensions/*.ts lib/*.ts vendor/pi-subagent/*.ts; do
  [ -e "$f" ] || continue
  node --experimental-strip-types --check "$f" 2>/dev/null || { bad "TS syntax: $f"; ts_bad=1; }
done
[ "$ts_bad" = 0 ] && ok "extensions/ + lib/ TS syntax"

# 3. Every settings.packages entry resolves on disk
node - "$SETTINGS" "$REPO_ROOT" <<'JS' || fail=1
const fs = require("node:fs");
const path = require("node:path");
const [settingsFile, repoRoot] = process.argv.slice(2);
const packages = JSON.parse(fs.readFileSync(settingsFile, "utf8")).packages ?? [];
const missing = packages.filter((entry) => {
  if (!entry.startsWith("npm:")) {
    const local = entry.startsWith("./") ? entry.slice(2) : entry;
    return !fs.existsSync(path.resolve(local));
  }
  const spec = entry.slice(4);
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  return !fs.existsSync(path.join(repoRoot, "node_modules", name)) &&
    !fs.existsSync(path.join("npm", "node_modules", name));
});
if (missing.length) {
  console.error(`  FAIL  packages missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`  ok    packages resolve: ${packages.join(", ") || "(none)"}`);
JS

# 4. Type-check the curated set if tsc is installed
if [ -x "$REPO_ROOT/node_modules/.bin/tsc" ]; then
  if "$REPO_ROOT/node_modules/.bin/tsc" -p .typecheck --noEmit >/dev/null 2>&1; then ok "full TypeScript typecheck"; else bad "full TypeScript typecheck (run 'npm run typecheck' for details)"; fi
else
  echo "  skip  tsc not installed (run 'npm ci')"
fi

# 5. Config drift: models.json contextWindow vs each launcher's CTX default.
# A stale contextWindow silently mis-times compaction (seen: 30720 vs -c 65536 →
# compaction fired at half the real window). Convention: ctx-8192 ≤ cw ≤ ctx.
LLM_DIR="${LLM_DIR:-}"
if [ -n "$LLM_DIR" ] && [ -d "$LLM_DIR" ]; then
  python3 - "$LLM_DIR" "$MODELS" <<'PY' || fail=1
import json, re, sys, glob, os
llm = sys.argv[1]
models_file = sys.argv[2]
models = {m["id"]: m["contextWindow"]
          for prov in json.load(open(models_file))["providers"].values()
          for m in prov.get("models", [])}
drift, checked = [], 0
for sh in glob.glob(os.path.join(llm, "run-*.sh")):
    text = open(sh).read()
    alias = re.search(r"--alias\s+(\S+)", text)
    ctx = re.search(r'CTX="\$\{CTX:-(\d+)\}"', text)
    if not alias or not ctx:
        continue
    mid, c = alias.group(1).strip('"'), int(ctx.group(1))
    if mid not in models:
        continue  # launcher for a model not in the fleet config — not drift
    checked += 1
    cw = models[mid]
    if not (c - 8192 <= cw <= c):
        drift.append(f"{mid}: models.json={cw} launcher CTX={c}")
if drift:
    print("  FAIL  ctx drift:", "; ".join(drift)); sys.exit(1)
print(f"  ok    models.json ctx in sync with {checked} launcher(s)")
PY
else
  echo "  skip  ctx-drift check (set LLM_DIR to a launcher directory)"
fi

# 6. Default model must exist in models.json (only for the local provider —
# an external default like openai-codex is not ours to validate).
python3 - "$SETTINGS" "$MODELS" <<'PY' || fail=1
import json, sys
s = json.load(open(sys.argv[1]))
if s.get("defaultProvider") != "local-llamacpp":
    print(f"  ok    defaultModel check skipped (provider {s.get('defaultProvider')!r} is external)"); sys.exit(0)
ids = {m["id"] for prov in json.load(open(sys.argv[2]))["providers"].values() for m in prov.get("models", [])}
dm = s.get("defaultModel")
if dm in ids:
    print(f"  ok    defaultModel {dm!r} exists in models.json"); sys.exit(0)
print(f"  FAIL  defaultModel {dm!r} not in models.json ({sorted(ids)})"); sys.exit(1)
PY

# 7. Role descriptions: budget + orthogonality. A role's frontmatter
# `description` is its entire lexical trigger surface — over-long or
# vocabulary-colliding descriptions break subagent routing on small models
# (same vocabulary definition as lib/role-routing.ts + role-routing.test.ts).
if [ -d agents ]; then
  node --experimental-strip-types - <<'JS' || fail=1
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { roleVocabulary, vocabularyJaccard } = require(join(process.cwd(), "lib", "role-routing.ts"));
const problems = [];
const roles = [];
for (const name of readdirSync("agents").filter((f) => f.endsWith(".md"))) {
  const source = readFileSync(join("agents", name), "utf8");
  const front = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
  const roleName = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "";
  const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "";
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(roleName)) problems.push(`${name}: bad role name ${JSON.stringify(roleName)}`);
  if (roleName !== name.replace(/\.md$/, "")) problems.push(`${name}: name '${roleName}' != filename stem`);
  if (!description) problems.push(`${name}: missing description`);
  if (description.length > 400) problems.push(`${name}: description ${description.length} chars (max 400)`);
  roles.push(roleVocabulary(roleName, description));
}
for (let i = 0; i < roles.length; i += 1) for (let j = i + 1; j < roles.length; j += 1) {
  const jac = vocabularyJaccard(roles[i].words, roles[j].words);
  if (jac > 0.5) problems.push(`${roles[i].name}/${roles[j].name}: descriptions share ${(jac * 100).toFixed(0)}% vocabulary`);
}
if (problems.length) { console.error(`  FAIL  role descriptions: ${problems.join("; ")}`); process.exit(1); }
console.log(`  ok    role descriptions (${roles.length}): budget + orthogonality`);
JS
else
  echo "  skip  role-description check (no agents/ dir)"
fi

# 8. Telemetry sink is writable without creating or touching anything.
tdir="$ROOT/telemetry"
if [ -d "$tdir" ]; then
  if [ -w "$tdir" ]; then ok "telemetry dir writable"; else bad "telemetry dir not writable: $tdir"; fi
elif [ -w "$ROOT" ]; then
  ok "telemetry parent writable (directory created lazily at runtime)"
else
  ok "telemetry directory absent (read-only checkout; runtime sink will fail open)"
fi

if [ "$fail" = 0 ]; then echo "PASS"; exit 0; else echo "FAIL"; exit 1; fi
