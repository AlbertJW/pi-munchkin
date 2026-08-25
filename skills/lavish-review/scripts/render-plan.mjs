#!/usr/bin/env node
// Render an explicitly exported Pi Munchkin plan (schema 4 or 5) to a
// self-contained HTML artifact for lavish-axi review.
// Usage: node render-plan.mjs [path/to/plan-state.json] [out.html]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const src = process.argv[2] || ".pi/plan-review.json";
const out = process.argv[3] || "artifacts/plan-review.html";
const plan = JSON.parse(readFileSync(src, "utf8"));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Mermaid node labels sit inside raw HTML (<pre class="mermaid">), so they are an
// HTML injection surface, not just a Mermaid-parser one. ALLOWLIST, never denylist:
// a title like `</pre><img onerror=...>` must come out inert.
const mLabel = (s) => String(s ?? "").replace(/[^A-Za-z0-9 ._/()+:-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

const items = plan.items ?? [];
const byId = new Map(items.map((it, i) => [it.id, `n${i}`]));
const STATUS_ICON = { done: "✅", in_progress: "🔄", blocked: "⛔", deferred: "⏸️", pending: "⬜" };

const rows = items.map((it) => `<tr>
  <td>${STATUS_ICON[it.status] ?? "⬜"} ${esc(it.status)}</td>
  <td><b>${esc(it.title)}</b>${it.note ? `<br><small>${esc(it.note)}</small>` : ""}</td>
  <td>${it.budget ? `${esc(it.budget.used?.searches ?? 0)}/${esc(it.budget.allocated?.searches ?? 0)} searches · ${esc(it.budget.used?.reads ?? 0)}/${esc(it.budget.allocated?.reads ?? 0)} reads` : ""}</td>
  <td>${esc((it.evidence_gaps ?? []).join(" · "))}</td>
</tr>`).join("\n");

const edges = items.flatMap((it, i) => it.parent_id && byId.has(it.parent_id) ? [`${byId.get(it.parent_id)} --> n${i}`] : []);
const nodes = items.map((it, i) => `n${i}["${mLabel(it.title)}"]`);
const mermaid = `flowchart TD\n  ${[...nodes, ...edges].join("\n  ")}`;

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
<table><tr><th>status</th><th>item</th><th>budget</th><th>evidence gaps</th></tr>
${rows}
</table>
<h2>Plan graph</h2>
<pre class="mermaid">
${mermaid}
</pre>
<script type="module">
 import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
 mermaid.initialize({ startOnLoad: true });
</script>
</body></html>`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(out);
