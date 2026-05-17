/**
 * Web Search Plugin Example
 *
 * Registers a `web_search` tool backed by Exa.
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp examples/plugins/web-search.ts .cline/plugins/web-search.ts
 *   EXA_API_KEY=... clite "Search the web for recent TypeScript 6 updates"
 *
 * Provider key:
 *   EXA_API_KEY              Enables Exa search. A separate model provider key
 *                            is still required for CLI inference.
 */

import { type AgentPlugin, createTool } from "@cline/core";

export interface WebSearchInput {
	query: string;
	limit?: number;
	domains?: string[];
	recencyDays?: number;
	country?: string;
}

export interface WebSearchResult {
	title: string;
	url: string;
	snippet?: string;
	publishedAt?: string;
	author?: string;
	score?: number;
	source: "exa";
}

export interface WebSearchOutput {
	provider: "exa";
	query: string;
	results: WebSearchResult[];
	requestId?: string;
}

interface ExaSearchResult {
	title?: string;
	url?: string;
	publishedDate?: string;
	author?: string;
	score?: number;
	text?: string;
	highlights?: string[];
	summary?: string;
}

interface ExaSearchResponse {
	requestId?: string;
	results?: ExaSearchResult[];
	error?: string;
}

const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 10;
const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function clampResultLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) {
		return DEFAULT_RESULT_LIMIT;
	}
	const integer = Math.trunc(limit);
	return Math.min(Math.max(integer, 1), MAX_RESULT_LIMIT);
}

function normalizeDomains(domains: string[] | undefined): string[] | undefined {
	const normalized = domains
		?.map((domain) => domain.trim().replace(/^https?:\/\//, ""))
		.map((domain) => domain.replace(/\/.*$/, ""))
		.filter(Boolean);
	return normalized && normalized.length > 0
		? [...new Set(normalized)]
		: undefined;
}

function isoDateDaysAgo(days: number | undefined): string | undefined {
	if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
		return undefined;
	}
	const date = new Date();
	date.setUTCDate(date.getUTCDate() - Math.trunc(days));
	return date.toISOString();
}

function truncateSnippet(text: string | undefined): string | undefined {
	if (!text) {
		return undefined;
	}
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return undefined;
	}
	return normalized.length > 800
		? `${normalized.slice(0, 797).trimEnd()}...`
		: normalized;
}

function extractErrorMessage(body: unknown): string | undefined {
	if (!body || typeof body !== "object") {
		return undefined;
	}
	const record = body as Record<string, unknown>;
	for (const key of ["error", "message", "detail"] as const) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}
	return undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function hasResultUrl(
	result: ExaSearchResult,
): result is ExaSearchResult & { url: string } {
	return typeof result.url === "string" && result.url.trim().length > 0;
}

function parseWebSearchInput(input: unknown): WebSearchInput {
	if (!input || typeof input !== "object") {
		throw new Error("web_search input must be an object");
	}
	const record = input as Record<string, unknown>;
	const query = asString(record.query);
	if (!query) {
		throw new Error("query is required");
	}

	const domains = Array.isArray(record.domains)
		? record.domains.flatMap((domain) => {
				const value = asString(domain);
				return value ? [value] : [];
			})
		: undefined;

	return {
		query,
		limit: asNumber(record.limit),
		domains,
		recencyDays: asNumber(record.recencyDays),
		country: asString(record.country),
	};
}

async function readJsonResponse<T>(response: Response): Promise<T> {
	const text = await response.text();
	let body: unknown = {};
	try {
		body = text ? (JSON.parse(text) as unknown) : {};
	} catch {
		if (!response.ok) {
			throw new Error(
				`HTTP ${response.status}: ${text || response.statusText}`,
			);
		}
		throw new Error("Search provider returned invalid JSON");
	}

	if (!response.ok) {
		const message = extractErrorMessage(body) ?? (text || response.statusText);
		throw new Error(`HTTP ${response.status}: ${message}`);
	}

	return body as T;
}

function resolveExaApiKey(): string {
	const exaApiKey = env("EXA_API_KEY");
	if (!exaApiKey) {
		throw new Error("Set EXA_API_KEY to use web_search");
	}
	return exaApiKey;
}

async function searchExa(
	input: WebSearchInput,
	apiKey: string,
	limit: number,
	domains: string[] | undefined,
): Promise<WebSearchOutput> {
	const body: Record<string, unknown> = {
		query: input.query,
		numResults: limit,
		contents: {
			highlights: true,
		},
	};
	if (domains) {
		body.includeDomains = domains;
	}
	const startPublishedDate = isoDateDaysAgo(input.recencyDays);
	if (startPublishedDate) {
		body.startPublishedDate = startPublishedDate;
	}
	if (input.country) {
		body.userLocation = input.country.toLowerCase();
	}

	const response = await fetch(EXA_SEARCH_ENDPOINT, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const json = await readJsonResponse<ExaSearchResponse>(response);

	if (json.error) {
		throw new Error(json.error);
	}

	return {
		provider: "exa",
		query: input.query,
		requestId: json.requestId,
		results: (json.results ?? [])
			.filter(hasResultUrl)
			.slice(0, limit)
			.map((result) => ({
				title: result.title || result.url || "Untitled",
				url: result.url,
				snippet: truncateSnippet(
					result.highlights?.join("\n") ?? result.summary ?? result.text,
				),
				publishedAt: result.publishedDate,
				author: result.author,
				score: result.score,
				source: "exa",
			})),
	};
}

export async function searchWeb(
	input: WebSearchInput,
): Promise<WebSearchOutput> {
	if (!input.query || !input.query.trim()) {
		throw new Error("query is required");
	}

	const limit = clampResultLimit(input.limit);
	const domains = normalizeDomains(input.domains);
	const apiKey = resolveExaApiKey();

	return searchExa(input, apiKey, limit, domains);
}

const plugin: AgentPlugin = {
	name: "web-search",
	manifest: {
		capabilities: ["tools"],
	},

	setup(api) {
		api.registerTool(
			createTool({
				name: "web_search",
				description:
					"Search the web for current public information using Exa. " +
					"Use this to discover relevant URLs, news, docs, and recent facts; use fetch_web_content afterward when a page needs deeper inspection. " +
					"Requires EXA_API_KEY in the plugin host environment.",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description:
								"Search query. Use precise terms and include dates when recency matters.",
						},
						limit: {
							type: "number",
							description: `Number of results to return, from 1 to ${MAX_RESULT_LIMIT}. Defaults to ${DEFAULT_RESULT_LIMIT}.`,
						},
						domains: {
							type: "array",
							items: { type: "string" },
							description:
								"Optional domains to restrict results to, such as github.com or docs.exa.ai.",
						},
						recencyDays: {
							type: "number",
							description:
								"Optional freshness window in days. Maps to Exa startPublishedDate.",
						},
						country: {
							type: "string",
							description:
								"Optional lowercase two-letter country code for localized results, such as us.",
						},
					},
					required: ["query"],
					additionalProperties: false,
				},
				timeoutMs: 30_000,
				retryable: true,
				maxRetries: 1,
				execute: async (input: unknown) =>
					searchWeb(parseWebSearchInput(input)),
			}),
		);
	},
};

export { plugin };
export default plugin;
