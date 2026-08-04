import { lookup } from "node:dns/promises";

export type LookupAddress = { address: string; family: number };
export type DnsLookup = (host: string) => Promise<LookupAddress[]>;
export type RedirectFetch = (url: string, signal?: AbortSignal) => Promise<{ status: number; location: string | null; close(): Promise<void> }>;

function ipv4Number(value: string): number | null {
	const parts = value.split(".");
	if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p) || Number(p) > 255)) return null;
	return parts.reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

function ipv6Number(value: string): bigint | null {
	let input = value.toLowerCase().split("%", 1)[0];
	if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
	if (!input || (input.match(/::/g)?.length ?? 0) > 1) return null;
	const dotted = /(^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(input);
	if (dotted) {
		const v4 = ipv4Number(dotted[2]);
		if (v4 === null) return null;
		input = `${input.slice(0, dotted.index + dotted[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
	}
	const halves = input.split("::");
	const left = halves[0] ? halves[0].split(":") : [];
	const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
	if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
	const parts = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
	if (parts.length !== 8) return null;
	return parts.reduce((n, part) => (n << 16n) | BigInt(Number.parseInt(part, 16)), 0n);
}

function inV6(value: bigint, prefix: bigint, bits: number): boolean {
	return bits === 0 || (value >> BigInt(128 - bits)) === (prefix >> BigInt(128 - bits));
}

export function isPrivateAddress(address: string): boolean {
	const lower = address.toLowerCase().split("%")[0];
	const v4 = ipv4Number(lower);
	if (v4 !== null) {
		return (v4 >>> 24) === 0 || (v4 >>> 24) === 10 || (v4 >>> 24) === 127 ||
			(v4 >>> 22) === 0x191 || // carrier-grade NAT 100.64/10
			(v4 >>> 16) === 0xa9fe || (v4 >>> 20) === 0xac1 || (v4 >>> 16) === 0xc0a8 ||
			(v4 >>> 8) === 0xc00000 || (v4 >>> 8) === 0xc00002 || (v4 >>> 8) === 0xc05863 || (v4 >>> 15) === 0x18c24 ||
			(v4 >>> 8) === 0xc63364 || (v4 >>> 8) === 0xcb0071 ||
			(v4 >>> 24) >= 224 || v4 === 0xffffffff;
	}
	const v6 = ipv6Number(lower);
	if (v6 === null) return true; // malformed DNS data is never treated as public
	const prefix = (s: string) => ipv6Number(s)!;
	return !inV6(v6, prefix("2000::"), 3) || // only assigned global-unicast space can pass
		v6 >> 32n === 0n || // unspecified, loopback, and IPv4-compatible ::/96
		v6 >> 32n === 0xffffn || // IPv4-mapped ::ffff:0:0/96
		inV6(v6, prefix("64:ff9b::"), 96) || inV6(v6, prefix("64:ff9b:1::"), 48) ||
		inV6(v6, prefix("100::"), 64) || inV6(v6, prefix("2001::"), 32) ||
		inV6(v6, prefix("2001:2::"), 48) || inV6(v6, prefix("2001:db8::"), 32) ||
		inV6(v6, prefix("2001:10::"), 28) || inV6(v6, prefix("2001:20::"), 28) ||
		inV6(v6, prefix("2002::"), 16) || inV6(v6, prefix("3fff::"), 20) ||
		inV6(v6, prefix("5f00::"), 16) || inV6(v6, prefix("fc00::"), 7) ||
		inV6(v6, prefix("fe80::"), 10) || inV6(v6, prefix("fec0::"), 10) ||
		inV6(v6, prefix("ff00::"), 8);
}

async function defaultLookup(host: string): Promise<LookupAddress[]> {
	return lookup(host, { all: true, verbatim: true });
}

async function defaultRedirectFetch(url: string, signal?: AbortSignal) {
	const response = await fetch(url, {
		method: "GET",
		redirect: "manual",
		headers: { Range: "bytes=0-0", "User-Agent": "pi-munchkin-url-guard/1" },
		signal,
	});
	return {
		status: response.status,
		location: response.headers.get("location"),
		close: async () => { try { await response.body?.cancel(); } catch { /* ignore */ } },
	};
}

async function validateHop(raw: string, dnsLookup: DnsLookup): Promise<URL> {
	let url: URL;
	try { url = new URL(raw); } catch { throw new Error("URL is malformed"); }
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only public HTTP(S) URLs are allowed");
	if (url.username || url.password) throw new Error("URL credentials are not allowed");
	if (!url.hostname || url.hostname.toLowerCase() === "localhost" || url.hostname.endsWith(".localhost")) {
		throw new Error("local hostnames are not allowed");
	}
	let addresses: LookupAddress[];
	const literal = url.hostname.replace(/^\[|\]$/g, "");
	const literalV4 = ipv4Number(literal);
	const literalV6 = literal.includes(":") ? ipv6Number(literal) : null;
	if (literalV4 !== null || literalV6 !== null) {
		addresses = [{ address: literal, family: literalV4 !== null ? 4 : 6 }];
	} else {
		try { addresses = await dnsLookup(url.hostname); } catch {
			throw new Error("DNS lookup failed");
		}
	}
	if (!addresses.length) throw new Error("DNS returned no addresses");
	const blocked = addresses.some((a) =>
		(a.family !== 4 && a.family !== 6) ||
		(a.family === 4 ? ipv4Number(a.address) === null : ipv6Number(a.address) === null) ||
		isPrivateAddress(a.address));
	if (blocked) throw new Error("host resolves to a non-public address");
	return url;
}

/** Validate DNS and every redirect hop, returning the final public URL.
 *
 * BEST-EFFORT PREFLIGHT ONLY. This blocks naive private/loopback/credentialed
 * destinations and validates the redirect hops IT can see, but it cannot
 * prevent DNS rebinding or a differential response: any downstream fetcher
 * (e.g. the ketch scraper) re-resolves DNS and re-follows redirects on its own
 * socket, so end-to-end SSRF safety depends on that fetcher's own hardening,
 * not on this guard. Pass `signal` so the preflight is bounded/cancellable. */
export async function resolvePublicHttpUrl(
	raw: string,
	options: { lookup?: DnsLookup; fetchRedirect?: RedirectFetch; maxRedirects?: number; signal?: AbortSignal } = {},
): Promise<string> {
	const dnsLookup = options.lookup ?? defaultLookup;
	const fetchRedirect = options.fetchRedirect ?? defaultRedirectFetch;
	const maxRedirects = options.maxRedirects ?? 5;
	let current = (await validateHop(raw, dnsLookup)).toString();
	for (let redirects = 0; ; redirects++) {
		const response = await fetchRedirect(current, options.signal);
		try {
			if (response.status < 300 || response.status >= 400) return current;
			if (!response.location) throw new Error(`redirect ${response.status} omitted Location`);
			if (redirects >= maxRedirects) throw new Error(`too many redirects (max ${maxRedirects})`);
			current = (await validateHop(new URL(response.location, current).toString(), dnsLookup)).toString();
		} finally { await response.close(); }
	}
}
