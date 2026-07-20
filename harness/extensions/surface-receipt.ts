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
	pi.on("session_start", async () => {
		const hash = process.env.HARNESS_SURFACE_SHA256;
		if (hash && SHA256_HEX.test(hash)) record("surface-receipt", "surface", { sha256: hash });
	});
}
