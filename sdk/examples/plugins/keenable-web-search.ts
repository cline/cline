/**
 * Keyless Web Search Plugin Example
 *
 * Registers a `web_search` tool backed by Keenable. It works without an API
 * key: unauthenticated calls go to Keenable's public endpoint, which is rate
 * limited per IP. Set KEENABLE_API_KEY to use the keyed endpoint instead.
 *
 * CLI usage:
 *   cline plugin install https://github.com/cline/cline/blob/main/sdk/examples/plugins/keenable-web-search.ts --cwd .
 *   cline "Search the web for recent TypeScript 6 updates"
 *
 * Provider key:
 *   KEENABLE_API_KEY         Optional. Uses the keyed Keenable endpoint. A
 *                            separate model provider key is still required
 *                            for CLI inference.
 *
 * Install this or web-search.ts, not both: each registers `web_search`.
 */

import { type AgentPlugin, createTool } from "@cline/core";

export interface KeenableSearchInput {
	query: string;
	limit?: number;
	site?: string;
	recencyDays?: number;
}

export interface KeenableSearchResult {
	title: string;
	url: string;
	snippet?: string;
	publishedAt?: string;
	source: "keenable";
}

export interface KeenableSearchOutput {
	provider: "keenable";
	authenticated: boolean;
	query: string;
	results: KeenableSearchResult[];
}

interface KeenableApiResult {
	title?: string;
	url?: string;
	snippet?: string;
	published_at?: string | null;
}

interface KeenableApiResponse {
	results?: KeenableApiResult[];
	detail?: string;
	error?: string;
	message?: string;
}

const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 10;
const KEENABLE_SEARCH_ENDPOINT = "https://api.keenable.ai/v1/search";
const KEENABLE_PUBLIC_SEARCH_ENDPOINT =
	"https://api.keenable.ai/v1/search/public";
/** App identifier the keyless endpoint requires. */
const KEENABLE_APP_TITLE = "cline";

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function clampResultLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) {
		return DEFAULT_RESULT_LIMIT;
	}
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_RESULT_LIMIT);
}

function normalizeSite(site: string | undefined): string | undefined {
	const host = site
		?.trim()
		.replace(/^https?:\/\//, "")
		.replace(/\/.*$/, "");
	return host ? host : undefined;
}

function truncateSnippet(text: string | undefined): string | undefined {
	const normalized = text?.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return undefined;
	}
	return normalized.length > 800
		? `${normalized.slice(0, 797).trimEnd()}...`
		: normalized;
}

function parseKeenableSearchInput(input: unknown): KeenableSearchInput {
	if (!input || typeof input !== "object") {
		throw new Error("web_search input must be an object");
	}
	const record = input as Record<string, unknown>;
	const query = asString(record.query);
	if (!query) {
		throw new Error("query is required");
	}
	return {
		query,
		limit: asNumber(record.limit),
		site: asString(record.site),
		recencyDays: asNumber(record.recencyDays),
	};
}

export async function searchKeenable(
	input: KeenableSearchInput,
	fetchImpl: typeof fetch = fetch,
): Promise<KeenableSearchOutput> {
	const query = input.query?.trim();
	if (!query) {
		throw new Error("query is required");
	}

	const limit = clampResultLimit(input.limit);
	const body: Record<string, unknown> = { query, max_results: limit };
	const site = normalizeSite(input.site);
	if (site) {
		body.site = site;
	}
	if (
		typeof input.recencyDays === "number" &&
		Number.isFinite(input.recencyDays) &&
		input.recencyDays > 0
	) {
		// Keenable accepts relative deltas such as `7d` on its date filters.
		body.published_after = `${Math.trunc(input.recencyDays)}d`;
	}

	const apiKey = env("KEENABLE_API_KEY");
	const response = await fetchImpl(
		apiKey ? KEENABLE_SEARCH_ENDPOINT : KEENABLE_PUBLIC_SEARCH_ENDPOINT,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(apiKey
					? { "X-API-Key": apiKey }
					: { "X-Keenable-Title": KEENABLE_APP_TITLE }),
			},
			body: JSON.stringify(body),
		},
	);

	const text = await response.text();
	let json: KeenableApiResponse = {};
	try {
		json = text ? (JSON.parse(text) as KeenableApiResponse) : {};
	} catch {
		throw new Error(
			response.ok
				? "Keenable returned invalid JSON"
				: `HTTP ${response.status}: ${text || response.statusText}`,
		);
	}
	if (!response.ok) {
		const message =
			json.detail ?? json.error ?? json.message ?? response.statusText;
		throw new Error(`HTTP ${response.status}: ${message}`);
	}

	const seen = new Set<string>();
	const results: KeenableSearchResult[] = [];
	for (const result of json.results ?? []) {
		const url = asString(result.url);
		if (!url || seen.has(url)) {
			continue;
		}
		seen.add(url);
		results.push({
			title: asString(result.title) ?? url,
			url,
			snippet: truncateSnippet(result.snippet),
			publishedAt: asString(result.published_at),
			source: "keenable",
		});
	}

	return {
		provider: "keenable",
		authenticated: Boolean(apiKey),
		query,
		results: results.slice(0, limit),
	};
}

const plugin: AgentPlugin = {
	name: "keenable-web-search",
	manifest: {
		capabilities: ["tools"],
	},

	setup(api) {
		api.registerTool(
			createTool({
				name: "web_search",
				description:
					"Search the web for current public information using Keenable. " +
					"Use this to discover relevant URLs, news, docs, and recent facts; use fetch_web_content afterward when a page needs deeper inspection. " +
					"Works without an API key; KEENABLE_API_KEY is optional.",
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
						site: {
							type: "string",
							description:
								"Optional single site to restrict results to, such as github.com.",
						},
						recencyDays: {
							type: "number",
							description:
								"Optional freshness window in days. Maps to Keenable published_after.",
						},
					},
					required: ["query"],
					additionalProperties: false,
				},
				timeoutMs: 30_000,
				retryable: true,
				maxRetries: 1,
				execute: async (input: unknown) =>
					searchKeenable(parseKeenableSearchInput(input)),
			}),
		);
	},
};

export { plugin };
export default plugin;
