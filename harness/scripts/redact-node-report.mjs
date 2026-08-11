// redact-node-report — strip a Node diagnostic report down to the sections a
// stall diagnosis needs, IN PLACE. The raw report embeds environmentVariables
// (every API key) and the full commandLine (which may hold the prompt); a
// diagnostic bundle must never be the most credential-dense file on the disk.
// Unparsable input is DELETED, never kept raw. Called by pi-watchdog.sh and
// covered by harness/tests/watchdog-redaction.test.ts.
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
	console.error("usage: redact-node-report.mjs <report.json>");
	process.exit(2);
}
try {
	const full = JSON.parse(readFileSync(path, "utf8"));
	const h = full.header ?? {};
	writeFileSync(path, JSON.stringify({
		redacted: "environmentVariables, commandLine, and all unlisted sections removed by pi-watchdog",
		header: { event: h.event, trigger: h.trigger, nodejsVersion: h.nodejsVersion,
		          platform: h.platform, arch: h.arch, dumpEventTime: h.dumpEventTime },
		javascriptStack: full.javascriptStack ?? null,
		libuv: full.libuv ?? null,
		resourceUsage: full.resourceUsage ?? null,
	}, null, 1));
} catch {
	rmSync(path, { force: true }); // unparsable: delete, never keep raw
}
