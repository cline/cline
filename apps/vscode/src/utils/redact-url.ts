/**
 * Reduces a URL to `origin + pathname` for log output. Query strings and
 * fragments routinely carry OAuth state, authorization codes and device codes;
 * userinfo can carry credentials. Unparseable input is replaced entirely
 * rather than echoed.
 */
export function redactUrlForLog(url: string): string {
	try {
		const parsed = new URL(url)
		if (parsed.origin === "null") {
			// Non-hierarchical schemes (mailto:, data:, ...): keep only the scheme.
			return `${parsed.protocol}<redacted>`
		}
		return `${parsed.origin}${parsed.pathname}`
	} catch {
		return "<invalid url>"
	}
}
