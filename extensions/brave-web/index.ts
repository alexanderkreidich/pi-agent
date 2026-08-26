import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type OutputFormat = "markdown" | "text";
type ExtractMode = "auto" | "basic" | "readability";

type BraveSearchParams = {
	query: string;
	count?: number;
	offset?: number;
	country?: string;
	search_lang?: string;
	ui_lang?: string;
	safe_search?: "off" | "moderate" | "strict";
	freshness?: string;
};

type BraveSearchResult = {
	title: string;
	url: string;
	description?: string;
	age?: string;
	language?: string;
	family_friendly?: boolean;
};

type WebFetchParams = {
	url: string;
	format?: OutputFormat;
	extract?: ExtractMode;
	max_chars?: number;
	max_bytes?: number;
	timeout_ms?: number;
};

type SearchFetchParams = BraveSearchParams & {
	fetch_count?: number;
	format?: OutputFormat;
	extract?: ExtractMode;
	max_chars_per_page?: number;
	max_bytes_per_page?: number;
	timeout_ms?: number;
};

type LimitedFetchResult = {
	finalUrl: string;
	status: number;
	statusText: string;
	contentType: string;
	body: string;
	bytesRead: number;
	fetchTruncated: boolean;
	redirects: number;
};

type ExtractedPage = {
	url: string;
	finalUrl: string;
	status: number;
	contentType: string;
	title?: string;
	text: string;
	extraction: "html-basic" | "readability" | "raw" | "json";
	bytesRead: number;
	fetchTruncated: boolean;
	outputTruncated: boolean;
	redirects: number;
};

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_USER_AGENT =
	"Pi Brave Web Extension/1.0 (+https://github.com/earendil-works/pi-coding-agent)";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const HARD_MAX_BYTES = 8_000_000;
const DEFAULT_MAX_CHARS = 20_000;
const HARD_MAX_CHARS = 80_000;
const MAX_REDIRECTS = 5;

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	const num = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
	return Math.min(max, Math.max(min, num));
}

function assertHttpUrl(value: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`Invalid URL: ${value}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Only http:// and https:// URLs are allowed, got ${parsed.protocol}`);
	}
	if (parsed.username || parsed.password) {
		throw new Error("URLs containing embedded credentials are not allowed");
	}
	return parsed;
}

function combinedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
	}, timeoutMs);
	const onAbort = () => controller.abort(parent?.reason ?? new Error("Aborted"));
	if (parent?.aborted) onAbort();
	else parent?.addEventListener("abort", onAbort, { once: true });
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timeout);
			parent?.removeEventListener("abort", onAbort);
		},
	};
}

async function readLimitedText(response: Response, maxBytes: number): Promise<{
	body: string;
	bytesRead: number;
	truncated: boolean;
}> {
	const body = response.body;
	if (!body) return { body: "", bytesRead: 0, truncated: false };

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let bytesRead = 0;
	let truncated = false;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const remaining = maxBytes - bytesRead;
			if (remaining <= 0) {
				truncated = true;
				break;
			}
			if (value.byteLength > remaining) {
				chunks.push(value.slice(0, remaining));
				bytesRead += remaining;
				truncated = true;
				break;
			}
			chunks.push(value);
			bytesRead += value.byteLength;
		}
	} finally {
		if (truncated) {
			try {
				await reader.cancel();
			} catch {
				// Ignore cancellation errors.
			}
		}
	}

	const merged = new Uint8Array(bytesRead);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return {
		body: new TextDecoder("utf-8", { fatal: false }).decode(merged),
		bytesRead,
		truncated,
	};
}

async function fetchLimited(
	inputUrl: string,
	options: {
		signal?: AbortSignal;
		timeoutMs?: number;
		maxBytes?: number;
		headers?: Record<string, string>;
	},
): Promise<LimitedFetchResult> {
	const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
	const maxBytes = clampInteger(options.maxBytes, DEFAULT_MAX_BYTES, 1_024, HARD_MAX_BYTES);
	let current = assertHttpUrl(inputUrl);
	const { signal, cleanup } = combinedSignal(options.signal, timeoutMs);

	try {
		for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
			const response = await fetch(current, {
				method: "GET",
				redirect: "manual",
				signal,
				headers: {
					"user-agent": DEFAULT_USER_AGENT,
					accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.8,*/*;q=0.5",
					...(options.headers ?? {}),
				},
			});

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (!location) throw new Error(`Redirect from ${current.toString()} did not include Location`);
				if (redirects === MAX_REDIRECTS) throw new Error(`Too many redirects while fetching ${inputUrl}`);
				current = assertHttpUrl(new URL(location, current).toString());
				continue;
			}

			const contentType = response.headers.get("content-type") ?? "";
			const { body, bytesRead, truncated } = await readLimitedText(response, maxBytes);
			return {
				finalUrl: current.toString(),
				status: response.status,
				statusText: response.statusText,
				contentType,
				body,
				bytesRead,
				fetchTruncated: truncated,
				redirects,
			};
		}
	} finally {
		cleanup();
	}

	throw new Error(`Too many redirects while fetching ${inputUrl}`);
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	hellip: "…",
};

function decodeEntities(input: string): string {
	return input.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (entity, body: string) => {
		if (body.startsWith("#x")) {
			const codePoint = Number.parseInt(body.slice(2), 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
		}
		if (body.startsWith("#")) {
			const codePoint = Number.parseInt(body.slice(1), 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
		}
		return ENTITIES[body] ?? entity;
	});
}

function normalizeWhitespace(input: string): string {
	return input
		.replace(/\r\n?/g, "\n")
		.replace(/[\t\f\v ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function inlineText(html: string): string {
	return normalizeWhitespace(decodeEntities(html.replace(/<[^>]*>/g, " "))).replace(/\n+/g, " ").trim();
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = match ? inlineText(match[1]) : undefined;
	return title || undefined;
}

function stripBoilerplate(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<head\b[\s\S]*?<\/head>/gi, "")
		.replace(/<script\b[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[\s\S]*?<\/style>/gi, "")
		.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, "");
}

function basicHtmlToText(html: string, format: OutputFormat): string {
	let text = stripBoilerplate(html);

	if (format === "markdown") {
		text = text.replace(/<a\b[^>]*href=["']?([^"'\s>]+)[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
			const cleanLabel = inlineText(label);
			const cleanHref = decodeEntities(href).trim();
			if (!cleanLabel) return cleanHref;
			if (!cleanHref || cleanHref === cleanLabel) return cleanLabel;
			return `[${cleanLabel}](${cleanHref})`;
		});
		for (let level = 6; level >= 1; level--) {
			const prefix = "#".repeat(level);
			text = text.replace(
				new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi"),
				(_match, heading: string) => `\n\n${prefix} ${inlineText(heading)}\n\n`,
			);
		}
		text = text.replace(/<li\b[^>]*>/gi, "\n- ");
	} else {
		text = text.replace(/<li\b[^>]*>/gi, "\n• ");
	}

	text = text
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|section|article|header|footer|main|aside|nav|blockquote|pre|ul|ol|li|table|thead|tbody|tr|td|th)>/gi, "\n")
		.replace(/<[^>]*>/g, " ");

	return normalizeWhitespace(decodeEntities(text));
}

async function readabilityExtract(
	html: string,
	url: string,
	format: OutputFormat,
): Promise<{ title?: string; text: string } | undefined> {
	const jsdomModule = await import("jsdom");
	const readabilityModule = await import("@mozilla/readability");
	const JSDOM = (jsdomModule as any).JSDOM;
	const VirtualConsole = (jsdomModule as any).VirtualConsole;
	const Readability = (readabilityModule as any).Readability;
	if (!JSDOM || !VirtualConsole || !Readability) return undefined;

	const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
	try {
		const article = new Readability(dom.window.document).parse();
		if (!article?.content && !article?.textContent) return undefined;

		if (format === "markdown") {
			try {
				const turndownModule = await import("turndown");
				const TurndownService = (turndownModule as any).default ?? turndownModule;
				const turndown = new TurndownService({
					headingStyle: "atx",
					codeBlockStyle: "fenced",
					bulletListMarker: "-",
				});
				return {
					title: article.title || extractTitle(html),
					text: normalizeWhitespace(turndown.turndown(article.content ?? article.textContent ?? "")),
				};
			} catch {
				return {
					title: article.title || extractTitle(html),
					text: basicHtmlToText(article.content ?? article.textContent ?? "", format),
				};
			}
		}

		return {
			title: article.title || extractTitle(html),
			text: normalizeWhitespace(article.textContent ?? basicHtmlToText(article.content ?? "", "text")),
		};
	} finally {
		dom.window.close();
	}
}

function truncateText(input: string, maxChars: number): { text: string; truncated: boolean } {
	if (input.length <= maxChars) return { text: input, truncated: false };
	return {
		text: `${input.slice(0, maxChars)}\n\n[truncated after ${maxChars} characters]`,
		truncated: true,
	};
}

function isProbablyText(contentType: string): boolean {
	const lower = contentType.toLowerCase();
	return (
		!lower ||
		lower.includes("text/") ||
		lower.includes("html") ||
		lower.includes("xml") ||
		lower.includes("json") ||
		lower.includes("javascript") ||
		lower.includes("x-www-form-urlencoded")
	);
}

async function extractPage(params: WebFetchParams, signal?: AbortSignal): Promise<ExtractedPage> {
	const format: OutputFormat = params.format ?? "markdown";
	const extract: ExtractMode = params.extract ?? "auto";
	const maxChars = clampInteger(params.max_chars, DEFAULT_MAX_CHARS, 1_000, HARD_MAX_CHARS);
	const maxBytes = clampInteger(params.max_bytes, DEFAULT_MAX_BYTES, 1_024, HARD_MAX_BYTES);

	const fetched = await fetchLimited(params.url, {
		signal,
		timeoutMs: params.timeout_ms,
		maxBytes,
	});

	if (!isProbablyText(fetched.contentType)) {
		throw new Error(`Unsupported content type for ${fetched.finalUrl}: ${fetched.contentType || "unknown"}`);
	}

	let title: string | undefined;
	let text: string;
	let extraction: ExtractedPage["extraction"] = "raw";
	const contentType = fetched.contentType.toLowerCase();

	if (contentType.includes("json")) {
		extraction = "json";
		try {
			text = JSON.stringify(JSON.parse(fetched.body), null, 2);
		} catch {
			text = fetched.body;
		}
	} else if (contentType.includes("html") || /<html[\s>]/i.test(fetched.body)) {
		title = extractTitle(fetched.body);
		if (extract !== "basic") {
			try {
				const readable = await readabilityExtract(fetched.body, fetched.finalUrl, format);
				if (readable?.text) {
					title = readable.title ?? title;
					text = readable.text;
					extraction = "readability";
				} else {
					text = basicHtmlToText(fetched.body, format);
					extraction = "html-basic";
				}
			} catch (error) {
				if (extract === "readability") {
					throw new Error(
						`Readability extraction requested but optional dependencies are unavailable or failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				text = basicHtmlToText(fetched.body, format);
				extraction = "html-basic";
			}
		} else {
			text = basicHtmlToText(fetched.body, format);
			extraction = "html-basic";
		}
	} else {
		text = normalizeWhitespace(fetched.body);
		extraction = "raw";
	}

	const truncated = truncateText(text, maxChars);
	return {
		url: params.url,
		finalUrl: fetched.finalUrl,
		status: fetched.status,
		contentType: fetched.contentType,
		title,
		text: truncated.text,
		extraction,
		bytesRead: fetched.bytesRead,
		fetchTruncated: fetched.fetchTruncated,
		outputTruncated: truncated.truncated,
		redirects: fetched.redirects,
	};
}

async function runBraveSearch(params: BraveSearchParams, signal?: AbortSignal): Promise<{
	query: string;
	results: BraveSearchResult[];
	apiQuery?: string;
}> {
	const apiKey = process.env.BRAVE_SEARCH_API_KEY;
	if (!apiKey) {
		throw new Error("BRAVE_SEARCH_API_KEY is not set. Export it before starting pi.");
	}
	const query = params.query.trim();
	if (!query) throw new Error("query must not be empty");

	const url = new URL(BRAVE_SEARCH_URL);
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(clampInteger(params.count, 10, 1, 20)));
	if (params.offset !== undefined) url.searchParams.set("offset", String(clampInteger(params.offset, 0, 0, 9)));
	if (params.country) url.searchParams.set("country", params.country);
	if (params.search_lang) url.searchParams.set("search_lang", params.search_lang);
	if (params.ui_lang) url.searchParams.set("ui_lang", params.ui_lang);
	if (params.safe_search) url.searchParams.set("safesearch", params.safe_search);
	if (params.freshness) url.searchParams.set("freshness", params.freshness);
	url.searchParams.set("text_decorations", "false");
	url.searchParams.set("spellcheck", "true");

	const fetched = await fetchLimited(url.toString(), {
		signal,
		timeoutMs: 15_000,
		maxBytes: 1_000_000,
		headers: {
			accept: "application/json",
			"x-subscription-token": apiKey,
		},
	});

	if (fetched.status < 200 || fetched.status >= 300) {
		const snippet = fetched.body.slice(0, 500);
		throw new Error(`Brave Search returned HTTP ${fetched.status}: ${snippet}`);
	}

	const payload = JSON.parse(fetched.body) as any;
	const results = ((payload.web?.results ?? []) as any[]).map((item): BraveSearchResult => ({
		title: inlineText(String(item.title ?? "Untitled")),
		url: String(item.url ?? ""),
		description: item.description ? inlineText(String(item.description)) : undefined,
		age: item.age ? String(item.age) : undefined,
		language: item.language ? String(item.language) : undefined,
		family_friendly: typeof item.family_friendly === "boolean" ? item.family_friendly : undefined,
	})).filter((item) => item.url);

	return {
		query,
		apiQuery: payload.query?.original,
		results,
	};
}

function formatSearchResults(search: { query: string; results: BraveSearchResult[] }): string {
	if (search.results.length === 0) return `No Brave Search results for: ${search.query}`;
	const lines = [`Brave Search results for: ${search.query}`, ""];
	search.results.forEach((result, index) => {
		lines.push(`${index + 1}. [${result.title}](${result.url})`);
		if (result.description) lines.push(`   ${result.description}`);
		if (result.age || result.language) {
			lines.push(`   ${[result.age, result.language].filter(Boolean).join(" · ")}`);
		}
	});
	return lines.join("\n");
}

function formatFetchedPage(page: ExtractedPage): string {
	const heading = page.title ? `# ${page.title}` : `# ${page.finalUrl}`;
	const meta = [
		`URL: ${page.finalUrl}`,
		`Status: ${page.status}`,
		`Content-Type: ${page.contentType || "unknown"}`,
		`Extraction: ${page.extraction}`,
		page.fetchTruncated ? `Fetch: truncated at ${page.bytesRead} bytes` : undefined,
		page.outputTruncated ? "Output: truncated" : undefined,
	].filter(Boolean);
	return `${heading}\n\n${meta.join("\n")}\n\n${page.text}`;
}

export default function braveWebExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "brave_search",
		label: "Brave Search",
		description:
			"Search the web with Brave Search. Use this first to discover relevant pages, then call web_fetch on promising URLs.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			count: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Number of results to return (default: 10, max: 20)" })),
			offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 9, description: "Brave result page offset (default: 0)" })),
			country: Type.Optional(Type.String({ description: "Optional country code, e.g. US, GB, DE" })),
			search_lang: Type.Optional(Type.String({ description: "Optional search language, e.g. en, ru" })),
			ui_lang: Type.Optional(Type.String({ description: "Optional UI language, e.g. en-US" })),
			safe_search: Type.Optional(Type.Union([Type.Literal("off"), Type.Literal("moderate"), Type.Literal("strict")], { description: "Safe search level" })),
			freshness: Type.Optional(Type.String({ description: "Optional freshness filter supported by Brave, e.g. pd, pw, pm, py, or date range" })),
		}),
		async execute(_toolCallId, params: BraveSearchParams, signal) {
			const search = await runBraveSearch(params, signal);
			return {
				content: [{ type: "text", text: formatSearchResults(search) }],
				details: search,
			};
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch an HTTP(S) URL and extract readable page text. Defaults to Markdown-ish text with safe byte/time/redirect limits.",
		parameters: Type.Object({
			url: Type.String({ description: "HTTP(S) URL to fetch" }),
			format: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("text")], { description: "Output format (default: markdown)" })),
			extract: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("basic"), Type.Literal("readability")], { description: "Extraction mode. auto uses Readability if optional deps are installed, otherwise basic." })),
			max_chars: Type.Optional(Type.Integer({ minimum: 1000, maximum: HARD_MAX_CHARS, description: "Maximum returned characters (default: 20000)" })),
			max_bytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: HARD_MAX_BYTES, description: "Maximum downloaded bytes (default: 2000000)" })),
			timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000, description: "Fetch timeout in milliseconds (default: 20000)" })),
		}),
		async execute(_toolCallId, params: WebFetchParams, signal) {
			const page = await extractPage(params, signal);
			return {
				content: [{ type: "text", text: formatFetchedPage(page) }],
				details: { ...page, text: undefined },
			};
		},
	});

	pi.registerTool({
		name: "search_fetch",
		label: "Search + Fetch",
		description:
			"Search Brave and fetch the top results in one call. Useful for quick research; use separate brave_search/web_fetch for more control.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			count: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Number of search results to inspect (default: 10)" })),
			fetch_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "How many top results to fetch (default: 3, max: 5)" })),
			format: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("text")], { description: "Output format (default: markdown)" })),
			extract: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("basic"), Type.Literal("readability")], { description: "Extraction mode (default: auto)" })),
			max_chars_per_page: Type.Optional(Type.Integer({ minimum: 1000, maximum: 30000, description: "Maximum returned characters per fetched page (default: 6000)" })),
			max_bytes_per_page: Type.Optional(Type.Integer({ minimum: 1024, maximum: HARD_MAX_BYTES, description: "Maximum downloaded bytes per page (default: 2000000)" })),
			timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000, description: "Fetch timeout per request in milliseconds (default: 20000)" })),
			country: Type.Optional(Type.String({ description: "Optional country code, e.g. US, GB, DE" })),
			search_lang: Type.Optional(Type.String({ description: "Optional search language, e.g. en, ru" })),
			ui_lang: Type.Optional(Type.String({ description: "Optional UI language, e.g. en-US" })),
			safe_search: Type.Optional(Type.Union([Type.Literal("off"), Type.Literal("moderate"), Type.Literal("strict")], { description: "Safe search level" })),
			freshness: Type.Optional(Type.String({ description: "Optional freshness filter supported by Brave, e.g. pd, pw, pm, py, or date range" })),
		}),
		async execute(_toolCallId, params: SearchFetchParams, signal) {
			const fetchCount = clampInteger(params.fetch_count, 3, 1, 5);
			const search = await runBraveSearch(params, signal);
			const pages: Array<ExtractedPage | { url: string; error: string }> = [];
			for (const result of search.results.slice(0, fetchCount)) {
				try {
					pages.push(
						await extractPage(
							{
								url: result.url,
								format: params.format,
								extract: params.extract,
								max_chars: params.max_chars_per_page ?? 6_000,
								max_bytes: params.max_bytes_per_page,
								timeout_ms: params.timeout_ms,
							},
							signal,
						),
					);
				} catch (error) {
					pages.push({
						url: result.url,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}

			const output = [
				formatSearchResults(search),
				"",
				"---",
				"",
				"Fetched pages:",
				...pages.map((page, index) => {
					if ("error" in page) return `\n## ${index + 1}. Fetch failed: ${page.url}\n\n${page.error}`;
					return `\n## ${index + 1}. ${page.title ?? page.finalUrl}\n\n${formatFetchedPage(page)}`;
				}),
			].join("\n");

			return {
				content: [{ type: "text", text: output }],
				details: { search, pages: pages.map((page) => ("error" in page ? page : { ...page, text: undefined })) },
			};
		},
	});
}
