import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../lib/agent-dir.ts";
import { captureInitialToolSurface } from "../lib/session-bootstrap.ts";
import { discoverEntryPoints, hashSurface, walkRelativeImports } from "../lib/surface-walk.ts";
import { beginSession, record, telemetrySource } from "../lib/telemetry.ts";

const SURFACE_HASH = /^[a-f0-9]{64}$/;

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		// This extension is first in the manifest. Keep minting synchronous and
		// first: every later handler belongs to exactly this session identity.
		beginSession();

		if (telemetrySource() === "gate") {
			if (!SURFACE_HASH.test(process.env.HARNESS_SURFACE_SHA256 ?? "")) {
				delete process.env.HARNESS_SURFACE_SHA256;
			}
		} else {
			// Interactive /new, resume, fork and /reload are new generations. Never
			// retain a hash computed by the previous runner.
			delete process.env.HARNESS_SURFACE_SHA256;
			try {
				const dir = agentDir();
				const discovered = await discoverEntryPoints(dir, ctx.cwd);
				const files = await walkRelativeImports(discovered.orderedEntryPoints);
				for (const entry of discovered.entries) files.add(entry);
				process.env.HARNESS_SURFACE_SHA256 = await hashSurface(dir, {
					orderedEntryPoints: discovered.orderedEntryPoints,
					files,
					npmIdentities: discovered.npmIdentities,
				});
			} catch {
				delete process.env.HARNESS_SURFACE_SHA256;
			}
		}

		captureInitialToolSurface(pi);
		if (!SURFACE_HASH.test(process.env.HARNESS_SURFACE_SHA256 ?? "")) {
			record("session-bootstrap", "surface-unavailable", { reason: "surface_unavailable" });
		}
	});
}
