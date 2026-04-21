/**
 * Web Fetch Executor
 *
 * Built-in implementation for fetching web content using native fetch.
 */

import type { ToolContext } from "@clinebot/shared";
import type { WebFetchExecutor } from "../types";

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
	 * User agent string
	 * @default "Mozilla/5.0 (compatible; AgentBot/1.0)"
	 */
	userAgent?: string;

	/**
	 * Additional headers
	 */
	headers?: Record<string, string>;

	/**
	 * Whether to follow redirects
	 * @default true
	 */
	followRedirects?: boolean;

	/**
	 * Maximum number of redirects to follow
	 * @default 5
	 */
	maxRedirects?: number;
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
		maxResponseBytes = 5_000_000,
		userAgent = "Mozilla/5.0 (compatible; AgentBot/1.0)",
		headers = {},
		followRedirects = true,
		// maxRedirects is available in options but native fetch handles it automatically
	} = options;

	return async (
		url: string,
		prompt: string,
		context: ToolContext,
	): Promise<string> => {
		// Validate URL
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(url);
		} catch {
			throw new Error(`Invalid URL: ${url}`);
		}

		// Only allow http and https
		if (!["http:", "https:"].includes(parsedUrl.protocol)) {
			throw new Error(
				`Invalid protocol: ${parsedUrl.protocol}. Only http and https are supported.`,
			);
		}

		// Create abort controller for timeout
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		let contextAbortHandler: (() => void) | undefined;

		// Combine with context abort signal
		if (context.abortSignal) {
			contextAbortHandler = () => controller.abort();
			context.abortSignal.addEventListener("abort", contextAbortHandler);
		}

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: {
					"User-Agent": userAgent,
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
					"Accept-Language": "en-US,en;q=0.9",
					...headers,
				},
				redirect: followRedirects ? "follow" : "manual",
				signal: controller.signal,
			});

			clearTimeout(timeout);

			// Check for redirect limit (if we're checking manually)
			if (!followRedirects && response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				return `Redirect to: ${location}`;
			}

			// Check response status
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			// Get content type
			const contentType = response.headers.get("content-type") || "";

			// Read response body with size limit
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("Failed to read response body");
			}

			const chunks: Uint8Array[] = [];
			let totalSize = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				totalSize += value.length;
				if (totalSize > maxResponseBytes) {
					reader.cancel();
					throw new Error(
						`Response too large: exceeded ${maxResponseBytes} bytes`,
					);
				}

				chunks.push(value);
			}

			// Combine chunks
			const buffer = new Uint8Array(totalSize);
			let offset = 0;
			for (const chunk of chunks) {
				buffer.set(chunk, offset);
				offset += chunk.length;
			}

			// Decode as text
			const text = new TextDecoder("utf-8").decode(buffer);

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
				`URL: ${url}`,
				`Content-Type: ${contentType}`,
				`Size: ${totalSize} bytes`,
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
			clearTimeout(timeout);

			if (error instanceof Error) {
				if (error.name === "AbortError") {
					throw new Error(`Request timed out after ${timeoutMs}ms`);
				}
				throw error;
			}
			throw new Error(`Fetch failed: ${String(error)}`);
		} finally {
			if (context.abortSignal && contextAbortHandler) {
				context.abortSignal.removeEventListener("abort", contextAbortHandler);
			}
		}
	};
}
