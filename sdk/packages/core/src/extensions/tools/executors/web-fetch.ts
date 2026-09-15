/**
 * Web Fetch Executor
 *
 * Built-in implementation for fetching web content using native fetch.
 */

import type { AgentToolContext } from "@cline/shared";
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
 * True for loopback, IPv4/IPv6 link-local (including 169.254 IMDS), and
 * localhost. RFC1918 addresses are left allowed so internal docs hosts still work.
 */
function isBlockedFetchHostname(host: string): boolean {
	const h = host
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/%.*/, "")
		.replace(/\.+$/, "");
	if (h === "localhost" || h.endsWith(".localhost")) {
		return true;
	}

	if (isBlockedIpv4Address(h) || isBlockedIpv4Address(ipv4FromMappedIpv6(h))) {
		return true;
	}

	if (
		h === "::" ||
		h === "::1" ||
		h === "0:0:0:0:0:0:0:0" ||
		h === "0:0:0:0:0:0:0:1"
	) {
		return true;
	}

	if (h.includes(":")) {
		const first = Number.parseInt(h.split(":")[0] ?? "", 16);
		// fe80::/10 link-local
		if (first >= 0xfe80 && first <= 0xfebf) {
			return true;
		}
	}

	return false;
}

function ipv4FromMappedIpv6(host: string): string {
	const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
	if (dotted?.[1]) {
		return dotted[1];
	}
	const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
	if (!hex?.[1] || !hex[2]) {
		return "";
	}
	const hi = Number.parseInt(hex[1], 16);
	const lo = Number.parseInt(hex[2], 16);
	return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isBlockedIpv4Address(host: string): boolean {
	const parts = host.split(".");
	if (parts.length !== 4) {
		return false;
	}
	const octets = parts.map((part) => Number(part));
	if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
		return false;
	}
	const [a, b] = octets;
	if (a === 0 || a === 127) {
		return true;
	}
	if (a === 169 && b === 254) {
		return true;
	}
	return false;
}

function resolveAndAssertFetchUrl(raw: string, base?: string): string {
	let parsed: URL;
	try {
		parsed = base ? new URL(raw, base) : new URL(raw);
	} catch {
		throw new Error(`Invalid URL: ${raw}`);
	}

	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw new Error(
			`Invalid protocol: ${parsed.protocol}. Only http and https are supported.`,
		);
	}

	if (isBlockedFetchHostname(parsed.hostname)) {
		throw new Error(
			`Blocked URL: ${parsed.href} targets a loopback, link-local, or cloud-metadata address.`,
		);
	}

	return parsed.href;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

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
		maxRedirects = 5,
	} = options;

	return async (
		url: string,
		prompt: string,
		context: AgentToolContext,
	): Promise<string> => {
		let currentUrl = resolveAndAssertFetchUrl(url);

		// Create abort controller for timeout
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		let contextAbortHandler: (() => void) | undefined;

		// Combine with context abort signal
		if (context.signal) {
			contextAbortHandler = () => controller.abort();
			context.signal.addEventListener("abort", contextAbortHandler);
		}

		try {
			const requestHeaders = {
				"User-Agent": userAgent,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
				"Accept-Language": "en-US,en;q=0.9",
				...headers,
			};

			let response: Response | undefined;
			let redirectCount = 0;
			while (true) {
				response = await fetch(currentUrl, {
					method: "GET",
					headers: requestHeaders,
					redirect: "manual",
					signal: controller.signal,
				});

				if (!REDIRECT_STATUS.has(response.status)) {
					break;
				}

				const location = response.headers.get("location");
				void response.body?.cancel();

				if (!followRedirects) {
					clearTimeout(timeout);
					return `Redirect to: ${location}`;
				}

				if (!location) {
					throw new Error(
						`HTTP ${response.status}: redirect with no Location header`,
					);
				}

				if (redirectCount >= maxRedirects) {
					throw new Error(`Too many redirects (limit ${maxRedirects})`);
				}

				currentUrl = resolveAndAssertFetchUrl(location, currentUrl);
				redirectCount++;
			}

			clearTimeout(timeout);

			if (!response) {
				throw new Error("Fetch failed: no response");
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
			if (context.signal && contextAbortHandler) {
				context.signal.removeEventListener("abort", contextAbortHandler);
			}
		}
	};
}
