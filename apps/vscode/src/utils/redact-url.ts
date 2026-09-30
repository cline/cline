/**
 * Reduces a URL to its origin for log output. Paths, query strings and
 * fragments routinely carry OAuth state, authorization codes, reset tokens and
 * API keys (some MCP servers embed the key as a path segment); userinfo can
 * carry credentials. Unparseable input is replaced entirely rather than echoed.
 */
export function redactUrlForLog(url: string): string {
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
