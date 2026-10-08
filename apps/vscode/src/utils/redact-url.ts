import { createHash } from "node:crypto"

/**
 * Reduces a URL to its origin for log output, followed by a short fingerprint
 * of the full URL. Paths, query strings and fragments routinely carry OAuth
 * state, authorization codes, reset tokens and API keys (some MCP servers
 * embed the key as a path segment); userinfo can carry credentials.
 * Unparseable input is replaced entirely rather than echoed.
 *
 * The fingerprint (3 hex digits of SHA-256) lets a reader tell whether two
 * log lines with the same origin were the same URL, without revealing it.
 * At 12 bits it is a differentiator, not an identifier.
 */
export function redactUrlForLog(url: string): string {
	const fingerprint = createHash("sha256").update(url).digest("hex").slice(0, 3)
	return `${redactedText(url)} (${fingerprint})`
}

function redactedText(url: string): string {
	try {
		const parsed = new URL(url)
		if (parsed.origin === "null") {
			// Non-hierarchical and file schemes (mailto:, data:, file:, ...): keep only the scheme.
			return `${parsed.protocol}<redacted>`
		}
		return parsed.origin
	} catch {
		return "<invalid url>"
	}
}
