import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { flushTelemetry } from "../lib/telemetry.ts";

/** Interactive async telemetry is observational, but settlement/shutdown are
 * durability boundaries. Authoritative FD/gate telemetry remains synchronous. */
export default function (pi: ExtensionAPI): void {
	pi.on("agent_settled", async () => flushTelemetry());
	pi.on("session_shutdown", async () => flushTelemetry());
}
