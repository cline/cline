/**
 * Web Search Executor
 *
 * Built-in implementation for the web_search tool, backed by the Cline
 * account API (`/api/v1/search/websearch`). Requires a Cline account auth
 * token; hosts wire this up when the session runs on the `cline` provider.
 */

import type { AgentToolContext } from "@cline/shared";
import { getClineEnvironmentConfig } from "@cline/shared";
import type { WebSearchExecutor } from "../types";

/**
 * Options for the Cline web search executor
 */
export interface ClineWebSearchExecutorOptions {
	/**
	 * Resolves the Cline account auth token used as the Bearer credential.
	 * Resolved lazily on every search so refreshed credentials are picked up.
	 */
	getAuthToken: () => Promise<string | undefined> | string | undefined;

	/**
	 * Cline API base URL (no trailing `/api/v1`).
	 * @default getClineEnvironmentConfig().apiBaseUrl
	 */
	apiBaseUrl?: string;

	/**
	 * Timeout for search requests in milliseconds
	 * @default 30000
	 */
	timeoutMs?: number;

	/**
	 * Additional headers sent with every search request
	 */
	headers?: Record<string, string>;

	/**
	 * Fetch implementation override, for tests
	 */
	fetchImpl?: typeof fetch;
}

interface WebSearchApiResult {
	title?: string;
	url?: string;
}

function extractApiErrorMessage(bodyText: string): string | undefined {
	try {
		const parsed = JSON.parse(bodyText) as Record<string, unknown>;
		for (const key of ["error", "message", "detail"]) {
			const value = parsed[key];
			if (typeof value === "string" && value.trim()) {
				return value;
			}
		}
	} catch {
		// Non-JSON body; fall through to raw text handling.
	}
	return undefined;
}

function trimTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 0x2f /* '/' */) {
		end--;
	}
	return value.slice(0, end);
}

function normalizeDomains(domains: string[] | undefined): string[] | undefined {
	const normalized = domains
		?.map((domain) => domain.trim())
		.filter((domain) => domain.length > 0);
	return normalized && normalized.length > 0 ? normalized : undefined;
}

export function formatWebSearchResults(
	results: ReadonlyArray<WebSearchApiResult>,
): string {
	let resultText = `Search completed (${results.length} results found)`;
	if (results.length > 0) {
		resultText += ":\n\n";
		results.forEach((result, index) => {
			resultText += `${index + 1}. ${result.title ?? result.url ?? "Untitled"}\n   ${result.url ?? ""}\n\n`;
		});
	}
	return resultText;
}

/**
 * Create a web search executor backed by the Cline account API
 *
 * @example
 * ```typescript
 * const webSearch = createClineWebSearchExecutor({
 *   getAuthToken: async () => resolveClineAccountToken(),
 * })
 * ```
 */
export function createClineWebSearchExecutor(
	options: ClineWebSearchExecutorOptions,
): WebSearchExecutor {
	const timeoutMs = options.timeoutMs ?? 30000;
	const fetchImpl = options.fetchImpl ?? fetch;

	return async (input, context: AgentToolContext): Promise<string> => {
		const authToken = await options.getAuthToken();
		if (!authToken) {
			throw new Error(
				"web_search requires a signed-in Cline account. Sign in with the Cline provider and try again.",
			);
		}

		const apiBaseUrl = trimTrailingSlashes(
			options.apiBaseUrl ?? getClineEnvironmentConfig().apiBaseUrl,
		);

		const requestBody: {
			query: string;
			allowed_domains?: string[];
			blocked_domains?: string[];
		} = { query: input.query };
		const allowedDomains = normalizeDomains(input.allowed_domains);
		const blockedDomains = normalizeDomains(input.blocked_domains);
		if (allowedDomains) {
			requestBody.allowed_domains = allowedDomains;
		}
		if (blockedDomains) {
			requestBody.blocked_domains = blockedDomains;
		}

		const controller = new AbortController();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		let contextAbortHandler: (() => void) | undefined;
		if (context.signal) {
			if (context.signal.aborted) {
				// The run was cancelled before this listener could register;
				// abort up front so the request never goes out.
				controller.abort();
			} else {
				contextAbortHandler = () => controller.abort();
				context.signal.addEventListener("abort", contextAbortHandler);
			}
		}

		try {
			const response = await fetchImpl(
				`${apiBaseUrl}/api/v1/search/websearch`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${authToken}`,
						"Content-Type": "application/json",
						"X-Task-ID": context.sessionId ?? "",
						...options.headers,
					},
					body: JSON.stringify(requestBody),
					signal: controller.signal,
				},
			);

			const bodyText = await response.text();
			if (!response.ok) {
				const message =
					extractApiErrorMessage(bodyText) ??
					(bodyText.trim() || response.statusText);
				throw new Error(
					`Web search failed (HTTP ${response.status}): ${message}`,
				);
			}

			let parsed: unknown;
			try {
				parsed = bodyText ? JSON.parse(bodyText) : {};
			} catch {
				throw new Error("Web search returned invalid JSON");
			}

			const data = (parsed as { data?: { results?: WebSearchApiResult[] } })
				.data;
			const results = Array.isArray(data?.results) ? data.results : [];
			return formatWebSearchResults(results);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				// Rethrow cancellation (e.g. the user aborting the run) untouched
				// so the runtime sees its cancellation signal; only aborts caused
				// by our own timer become timeout errors.
				if (context.signal?.aborted || !timedOut) {
					throw error;
				}
				throw new Error(`Web search timed out after ${timeoutMs}ms`);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
			if (context.signal && contextAbortHandler) {
				context.signal.removeEventListener("abort", contextAbortHandler);
			}
		}
	};
}
