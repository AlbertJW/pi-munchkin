import { lookup } from "node:dns/promises";

export type LookupAddress = { address: string; family: number };
export type DnsLookup = (host: string) => Promise<LookupAddress[]>;
export type RedirectFetch = (url: string) => Promise<{ status: number; location: string | null; close(): Promise<void> }>;

function ipv4Number(value: string): number | null {
	const parts = value.split(".");
	if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p) || Number(p) > 255)) return null;
	return parts.reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

export function isPrivateAddress(address: string): boolean {
	const lower = address.toLowerCase().split("%")[0];
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
	const v4 = ipv4Number(mapped?.[1] ?? lower);
	if (v4 !== null) {
		return (v4 >>> 24) === 0 || (v4 >>> 24) === 10 || (v4 >>> 24) === 127 ||
			(v4 >>> 22) === 0x191 || // carrier-grade NAT 100.64/10
			(v4 >>> 16) === 0xa9fe || (v4 >>> 20) === 0xac1 || (v4 >>> 16) === 0xc0a8 ||
			(v4 >>> 8) === 0xc00000 || (v4 >>> 8) === 0xc00002 || (v4 >>> 15) === 0x18c24 ||
			(v4 >>> 8) === 0xc63364 || (v4 >>> 8) === 0xcb0071 ||
			(v4 >>> 24) >= 224 || v4 === 0xffffffff;
	}
	return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") ||
		/^fe[89ab]/.test(lower) || lower.startsWith("ff") || lower.startsWith("2001:db8:");
}

async function defaultLookup(host: string): Promise<LookupAddress[]> {
	return lookup(host, { all: true, verbatim: true });
}

async function defaultRedirectFetch(url: string) {
	const response = await fetch(url, {
		method: "GET",
		redirect: "manual",
		headers: { Range: "bytes=0-0", "User-Agent": "pi-munchkin-url-guard/1" },
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
	try { addresses = await dnsLookup(url.hostname); } catch (err) {
		throw new Error(`DNS lookup failed for ${url.hostname}: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!addresses.length) throw new Error(`DNS returned no addresses for ${url.hostname}`);
	const blocked = addresses.find((a) => isPrivateAddress(a.address));
	if (blocked) throw new Error(`host ${url.hostname} resolves to non-public address ${blocked.address}`);
	return url;
}

/** Validate DNS and every redirect hop, returning the final public URL. This is
 * a preflight defense around a third-party scraper; callers must pass the
 * returned final URL rather than the original redirector. */
export async function resolvePublicHttpUrl(
	raw: string,
	options: { lookup?: DnsLookup; fetchRedirect?: RedirectFetch; maxRedirects?: number } = {},
): Promise<string> {
	const dnsLookup = options.lookup ?? defaultLookup;
	const fetchRedirect = options.fetchRedirect ?? defaultRedirectFetch;
	const maxRedirects = options.maxRedirects ?? 5;
	let current = (await validateHop(raw, dnsLookup)).toString();
	for (let redirects = 0; ; redirects++) {
		const response = await fetchRedirect(current);
		try {
			if (response.status < 300 || response.status >= 400) return current;
			if (!response.location) throw new Error(`redirect ${response.status} omitted Location`);
			if (redirects >= maxRedirects) throw new Error(`too many redirects (max ${maxRedirects})`);
			current = (await validateHop(new URL(response.location, current).toString(), dnsLookup)).toString();
		} finally { await response.close(); }
	}
}
