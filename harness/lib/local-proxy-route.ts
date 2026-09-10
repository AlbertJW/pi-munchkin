/**
 * Pi providers differ: some send `/chat/completions` relative to `baseUrl`,
 * others send the base path again.  A local qualification proxy must forward
 * both shapes exactly once rather than turning `/v1/...` into `/v1/v1/...`.
 */
export function localProxyTarget(baseUrl: string, requestPath: string): string {
	const base = new URL(baseUrl);
	if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("unsupported proxy base protocol");
	if (!requestPath.startsWith("/")) throw new Error("proxy request path must be absolute");
	const basePath = base.pathname.replace(/\/+$/, "") || "/";
	if (basePath !== "/" && (requestPath === basePath || requestPath.startsWith(`${basePath}/`))) {
		return new URL(requestPath, base.origin).toString();
	}
	return new URL(`${basePath === "/" ? "" : basePath}${requestPath}`, base.origin).toString();
}
