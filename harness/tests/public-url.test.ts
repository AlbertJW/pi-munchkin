import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateAddress, resolvePublicHttpUrl, type DnsLookup } from "../lib/public-url.ts";

test("private and special-use IP ranges are rejected", () => {
	for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.2.3", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
		assert.equal(isPrivateAddress(ip), true, ip);
	}
	assert.equal(isPrivateAddress("93.184.216.34"), false);
	assert.equal(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946"), false);
});

test("public URL guard rejects protocols, credentials, localhost, mixed DNS, and private redirects", async () => {
	const publicDns: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];
	const noFetch = async () => { throw new Error("must not fetch"); };
	for (const url of ["file:///etc/passwd", "http://u:p@example.com", "http://localhost/x"]) {
		await assert.rejects(resolvePublicHttpUrl(url, { lookup: publicDns, fetchRedirect: noFetch }));
	}
	await assert.rejects(resolvePublicHttpUrl("https://example.com", {
		lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }], fetchRedirect: noFetch,
	}), /non-public/);
	await assert.rejects(resolvePublicHttpUrl("https://example.com", {
		lookup: async (host) => [{ address: host === "internal.test" ? "10.0.0.2" : "93.184.216.34", family: 4 }],
		fetchRedirect: async () => ({ status: 302, location: "http://internal.test/admin", close: async () => {} }),
	}), /non-public/);
});

test("public URL guard validates redirect DNS and returns the final URL", async () => {
	const seen: string[] = [];
	const final = await resolvePublicHttpUrl("https://example.com/start", {
		lookup: async (host) => { seen.push(host); return [{ address: "93.184.216.34", family: 4 }]; },
		fetchRedirect: async (url) => url.endsWith("/start")
			? { status: 301, location: "/final", close: async () => {} }
			: { status: 200, location: null, close: async () => {} },
	});
	assert.equal(final, "https://example.com/final");
	assert.deepEqual(seen, ["example.com", "example.com"]);
});
