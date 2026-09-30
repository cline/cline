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

// A scheme followed by `//`, up to whitespace, a quote or a bracket.
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()[\]{}]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?]+$/

/**
 * Applies {@link redactUrlForLog} to every URL found in free text, such as an
 * error message.
 */
export function redactUrlsInText(text: string): string {
	return text.replace(URL_IN_TEXT, (match) => {
		const trailing = match.match(TRAILING_PUNCTUATION)?.[0] ?? ""
		const url = trailing ? match.slice(0, -trailing.length) : match
		return `${redactUrlForLog(url)}${trailing}`
	})
}
