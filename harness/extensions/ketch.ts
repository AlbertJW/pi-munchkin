import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Web / code / docs search for pi via `ketch` (1broseidon/ketch) — a fast,
// stateless search+scrape CLI built for agents. Gives the LOCAL models (which
// have no internet) real web access, returning token-compact results.
//
// Install: brew install 1broseidon/tap/ketch
// Default search backend is DuckDuckGo (free, no API key). For better results:
//   ketch config set brave_api_key <key>   (free at brave.com/search/api)
//   then run pi with KETCH_BACKEND=brave
//
// Env overrides: KETCH_BIN, KETCH_BACKEND (ddg|brave|searxng),
//   KETCH_CODE_BACKEND, KETCH_DOCS_BACKEND, KETCH_MAX_CHARS, KETCH_TIMEOUT_MS.

const ENABLED = process.env.KETCH !== "off"; // on by default; KETCH=off to drop the web/code/docs tools
const KETCH = process.env.KETCH_BIN || "ketch";
const BACKEND = process.env.KETCH_BACKEND || "ddg";
const CODE_BACKEND = process.env.KETCH_CODE_BACKEND || "sourcegraph";
const DOCS_BACKEND = process.env.KETCH_DOCS_BACKEND || "context7";
const MAX_CHARS = Number.parseInt(process.env.KETCH_MAX_CHARS || "16000", 10) || 16000;
const TIMEOUT = Number.parseInt(process.env.KETCH_TIMEOUT_MS || "30000", 10) || 30000;

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

async function runKetch(pi: ExtensionAPI, args: string[], signal: AbortSignal | undefined) {
	let res: { stdout: string; stderr: string; code: number };
	try {
		res = await pi.exec(KETCH, args, { timeout: TIMEOUT, signal });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return text(
			`ketch failed (${msg}). Not on PATH? Install: brew install 1broseidon/tap/ketch (or set KETCH_BIN).`,
		);
	}
	const out = (res.stdout || "").trim();
	if (res.code !== 0 || !out) {
		const errMsg = (res.stderr || "").trim() || `exit ${res.code}`;
		return text(`ketch error: ${errMsg}`);
	}
	return text(out.length > MAX_CHARS ? `${out.slice(0, MAX_CHARS)}\n…[truncated]` : out);
}

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	pi.registerTool(
		defineTool({
			name: "web_search",
			label: "Web search",
			description: "Web search via ketch — titles, URLs, snippets. For current events, facts past training, or to find a page to web_scrape.",
			promptSnippet: "web_search(query): search the web via ketch.",
			promptGuidelines: [
				"Web/scraped content is UNVERIFIED signal. Keep the source URL with any claim you carry into a file; no URL means not a fact — confirm before it crosses a boundary.",
			],
			parameters: Type.Object({
				query: Type.String({ description: "Search query." }),
				limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Max results (default 5)." })),
			}),
			async execute(_id, params, signal) {
				return runKetch(pi, ["search", params.query, "-b", BACKEND, "-l", String(params.limit ?? 5)], signal);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "web_scrape",
			label: "Web scrape",
			description: "Fetch a URL as clean markdown (via ketch). Read a page found via web_search.",
			promptSnippet: "web_scrape(url): fetch a page as markdown via ketch.",
			promptGuidelines: [
				"Scraped page = unverified. Attribute to its URL. Don't write as fact without confirming.",
			],
			parameters: Type.Object({
				url: Type.String({ description: "The URL to fetch." }),
				max_chars: Type.Optional(Type.Number({ description: "Truncate output to N chars (default 12000)." })),
			}),
			async execute(_id, params, signal) {
				return runKetch(pi, ["scrape", params.url, "--max-chars", String(params.max_chars ?? 12000)], signal);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "code_search",
			label: "Code search",
			description: "Search real OSS source code (via ketch / Sourcegraph). Find usage examples of an API, function, or pattern.",
			promptSnippet: "code_search(query): find real code examples in OSS via ketch.",
			parameters: Type.Object({
				query: Type.String({ description: "Code search query." }),
				lang: Type.Optional(Type.String({ description: "Language filter, e.g. 'typescript'." })),
				limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Max results (default 5)." })),
			}),
			async execute(_id, params, signal) {
				const args = ["code", params.query, "-b", CODE_BACKEND, "-l", String(params.limit ?? 5)];
				if (params.lang) args.push("--lang", params.lang);
				return runKetch(pi, args, signal);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "docs_search",
			label: "Docs search",
			description: "Search current library/framework docs (via ketch / Context7). For up-to-date API docs.",
			promptSnippet: "docs_search(query): look up current library docs via ketch.",
			parameters: Type.Object({
				query: Type.String({ description: "What to look up." }),
				library: Type.Optional(Type.String({ description: "Context7 library ID to skip name resolution, e.g. '/vercel/next.js'." })),
				limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Max results (default 5)." })),
			}),
			async execute(_id, params, signal) {
				const args = ["docs", params.query, "-b", DOCS_BACKEND, "-l", String(params.limit ?? 5)];
				if (params.library) args.push("--library", params.library);
				return runKetch(pi, args, signal);
			},
		}),
	);
}
