/**
 * Web Fetch Executor
 *
 * Built-in implementation for fetching web content using native fetch.
 */

import type { AgentToolContext } from "@bedrock-coder/shared";
import type { WebFetchExecutor } from "../types";
import {
	corporateResearchRequest,
	type CorporateResearchRequestOptions,
} from "../../../security/corporate-egress-policy";

/**
 * Options for the web fetch executor
 */
export interface WebFetchExecutorOptions {
	/**
	 * Timeout for fetch requests in milliseconds
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;

	/**
	 * Maximum response size in bytes
	 * @default 5_000_000 (5MB)
	 */
	maxResponseBytes?: number;

	/**
	 * @deprecated Corporate research always uses a fixed generic user agent.
	 */
	userAgent?: string;

	/**
	 * @deprecated Corporate research does not permit caller-provided headers.
	 */
	headers?: Record<string, string>;

	/**
	 * @deprecated Redirects are always handled manually and revalidated.
	 */
	followRedirects?: boolean;

	/**
	 * Maximum number of redirects to follow
	 * @default 5
	 */
	maxRedirects?: number;

	/** Test/host injection points for the central corporate egress guard. */
	fetch?: CorporateResearchRequestOptions["fetch"];
	resolveDns?: CorporateResearchRequestOptions["resolveDns"];
	audit?: CorporateResearchRequestOptions["audit"];
}

/**
 * Extract text content from HTML
 * Simple implementation - strips tags and normalizes whitespace
 */
function htmlToText(html: string): string {
	return (
		html
			// Remove script and style elements
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			// Remove HTML comments
			.replace(/<!--[\s\S]*?-->/g, "")
			// Replace block elements with newlines
			.replace(/<(p|div|br|hr|h[1-6]|li|tr)[^>]*>/gi, "\n")
			// Remove all remaining tags
			.replace(/<[^>]+>/g, " ")
			// Decode HTML entities
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
			// Normalize whitespace
			.replace(/\s+/g, " ")
			.replace(/\n\s+/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

/**
 * Create a web fetch executor using native fetch
 *
 * @example
 * ```typescript
 * const webFetch = createWebFetchExecutor({
 *   timeoutMs: 15000,
 *   maxResponseBytes: 2_000_000,
 * })
 *
 * const content = await webFetch(
 *   "https://docs.example.com/api",
 *   "Extract the authentication section",
 *   context
 * )
 * ```
 */
export function createWebFetchExecutor(
	options: WebFetchExecutorOptions = {},
): WebFetchExecutor {
	const {
		timeoutMs = 30000,
		maxResponseBytes = 2_000_000,
		headers = {},
		maxRedirects = 3,
		fetch,
		resolveDns,
		audit,
	} = options;
	if (Object.keys(headers).length > 0) {
		throw new Error(
			"Corporate research does not permit caller-provided request headers.",
		);
	}

	return async (
		url: string,
		prompt: string,
		context: AgentToolContext,
	): Promise<string> => {
		try {
			const response = await corporateResearchRequest(url, {
				method: "GET",
				timeoutMs,
				maxResponseBytes,
				maxRedirects,
				signal: context.signal,
				fetch,
				resolveDns,
				audit,
			});
			const contentType = response.headers.get("content-type") || "";
			const text = new TextDecoder("utf-8").decode(response.body);

			// Process content based on type
			let content: string;
			if (
				contentType.includes("text/html") ||
				contentType.includes("application/xhtml")
			) {
				content = htmlToText(text);
			} else if (contentType.includes("application/json")) {
				try {
					const json = JSON.parse(text);
					content = JSON.stringify(json, null, 2);
				} catch {
					content = text;
				}
			} else {
				content = text;
			}

			// Format output with metadata
			const outputLines = [
				`URL: ${response.url}`,
				`Content-Type: ${contentType}`,
				`Size: ${response.body.byteLength} bytes`,
				``,
				`--- Content ---`,
				content.slice(0, 50000), // Limit content size for output
			];

			if (content.length > 50000) {
				outputLines.push(
					`\n[Content truncated: showing first 50000 of ${content.length} characters]`,
				);
			}

			outputLines.push(``, `--- Analysis Request ---`, `Prompt: ${prompt}`);

			return outputLines.join("\n");
		} catch (error) {
			throw error instanceof Error
				? error
				: new Error(`Research fetch failed: ${String(error)}`);
		}
	};
}
