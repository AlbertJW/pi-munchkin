import { beginProviderRequest } from "../lib/intervention-receipts.ts";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../lib/agent-dir.ts";
import { discoverEntryPoints } from "../lib/surface-walk.ts";
import { buildRuntimeReceipt, type ProviderIdentity } from "../lib/runtime-receipt.ts";
import { runtimeIdentity } from "../lib/runtime-ownership.ts";
import { capabilityRoster } from "../lib/capability-surface.ts";
// Loaded-surface receipt: records the launcher-computed HARNESS_SURFACE_SHA256 (set
// by real_gate.sh's surface-hash.ts step, BEFORE this process ever started) into the
// authenticated telemetry channel, so a gate run's provenance can prove which
// harness code actually ran instead of just declaring it. No-op — and no telemetry
// write at all — when the env var is unset, so interactive/non-gate sessions are
// unaffected.
//
// Trust boundary: this extension only RELAYS a value it has no way to fabricate
// convincingly — the hash was computed before this session existed, and the only
// way it becomes evidence is by surviving record()'s HMAC signing (lib/telemetry.ts,
// keyed via TELEMETRY_HMAC_FD, which this process can read but never write to
// argv/env). A session that just prints a number to stdout doesn't touch any row.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { record } from "../lib/telemetry.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export default function (pi: ExtensionAPI) {
 let observedProvider: ProviderIdentity | null = null;
 let request = 0;
 pi.on("session_start", async () => { observedProvider = null; request = 0; });
 pi.on("before_provider_request", async (_event, ctx) => {
  const model = ctx.model;
  const correlation = beginProviderRequest(pi.events); request = correlation.request;
  pi.appendEntry("pi-munchkin:request-identity/v1", { v: 1, ...correlation, ...runtimeIdentity(pi.events),
   requestedProvider: model ? { provider: model.provider, model: model.id, api: model.api } : null,
   registeredTools: pi.getAllTools().map(tool => tool.name), activeTools: pi.getActiveTools(),
   sourceHash: SHA256_HEX.test(process.env.HARNESS_SURFACE_SHA256 ?? "") ? process.env.HARNESS_SURFACE_SHA256 : null });
 });
 pi.on("message_end", async event => {
  if (event.message.role !== "assistant") return;
  const identity = { provider: String(event.message.provider), model: event.message.model, api: String(event.message.api) };
  if (JSON.stringify(identity) === JSON.stringify(observedProvider)) return;
  observedProvider = identity;
  pi.appendEntry("pi-munchkin:observed-provider/v1", { v: 1, request, ...identity });
 });
 pi.registerCommand("runtime-receipt", { description: "Inspect source provenance, actual tools, and observed provider identity.", handler: async (_args, ctx) => {
  try {
   const discovered = await discoverEntryPoints(agentDir(), ctx.cwd);
   const receipt = await buildRuntimeReceipt({ piVersion: VERSION, baseDir: agentDir(), entryPoints: discovered.orderedEntryPoints,
    evidence: "discovered", registeredTools: pi.getAllTools().map(tool => tool.name), activeTools: pi.getActiveTools(),
    ...runtimeIdentity(pi.events), env: process.env, requestedProvider: ctx.model ? { provider: ctx.model.provider, model: ctx.model.id, api: ctx.model.api } : null,
    effectiveProvider: observedProvider });
   pi.appendEntry("pi-munchkin:runtime-receipt/v1", receipt);
   ctx.ui.notify(JSON.stringify({ ...receipt, capabilities: capabilityRoster(pi.getAllTools(), pi.getActiveTools()) }, null, 2), "info");
  } catch { ctx.ui.notify("Runtime receipt unavailable: resolve missing or unreadable extension/package sources before comparing outcomes.", "error"); }
 }});

	pi.on("session_start", async () => {
		const hash = process.env.HARNESS_SURFACE_SHA256;
		if (hash && SHA256_HEX.test(hash)) record("surface-receipt", "surface", { sha256: hash });
	});
}
