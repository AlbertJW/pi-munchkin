#!/usr/bin/env node
// Render .pi/plan-state.json (schema_version 3) to a self-contained HTML artifact for
// lavish-axi review: status table + Mermaid dependency graph + uncertainties.
// Usage: node render-plan.mjs [path/to/plan-state.json] [out.html]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const src = process.argv[2] || ".pi/plan-state.json";
const out = process.argv[3] || "artifacts/plan-review.html";
const plan = JSON.parse(readFileSync(src, "utf8"));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Mermaid node labels: quotes break the parser; keep labels short and quote-free.
const mLabel = (s) => String(s ?? "").replace(/["`;]/g, "'").slice(0, 60);

const items = plan.items ?? [];
const byTitle = new Map(items.map((it, i) => [it.title, `n${i}`]));
const STATUS_ICON = { done: "✅", in_progress: "🔄", blocked: "⛔", pending: "⬜" };

const rows = items.map((it) => `<tr>
  <td>${STATUS_ICON[it.status] ?? "⬜"} ${esc(it.status)}</td>
  <td><b>${esc(it.title)}</b>${it.note ? `<br><small>${esc(it.note)}</small>` : ""}</td>
  <td>${esc(it.gate ?? "")}${it.gate_fails ? ` <small>(fails: ${it.gate_fails})</small>` : ""}</td>
</tr>`).join("\n");

const edges = items.flatMap((it, i) =>
  (it.depends_on ?? []).map((dep) => `${byTitle.get(dep) ?? "unknown"} --> n${i}`));
const nodes = items.map((it, i) => `n${i}["${mLabel(it.title)}"]`);
const mermaid = `flowchart TD\n  ${[...nodes, ...edges].join("\n  ")}`;

const uncertainties = (plan.uncertainties ?? []).map((u) => `<li>${esc(typeof u === "string" ? u : JSON.stringify(u))}</li>`).join("");

const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Plan review — ${esc(plan.run_id ?? "")}</title>
<style>
 body{font:15px/1.5 system-ui;margin:2rem auto;max-width:60rem;padding:0 1rem}
 table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left;vertical-align:top}
 small{color:#666} .meta{color:#444}
</style></head><body>
<h1>Plan: ${esc(plan.request ?? "(no request)")}</h1>
<p class="meta">phase: <b>${esc(plan.phase)}</b> · autonomy: ${esc(plan.autonomy ?? "?")} · updated: ${esc(plan.updated_at ?? "?")}</p>
${plan.summary ? `<p>${esc(plan.summary)}</p>` : ""}
<h2>Items</h2>
<table><tr><th>status</th><th>item</th><th>gate</th></tr>
${rows}
</table>
<h2>Dependencies</h2>
<pre class="mermaid">
${mermaid}
</pre>
${uncertainties ? `<h2>Uncertainties</h2><ul>${uncertainties}</ul>` : ""}
<script type="module">
 import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
 mermaid.initialize({ startOnLoad: true });
</script>
</body></html>`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(out);
