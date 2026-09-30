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

// A scheme followed by `//`, up to whitespace, a quote or an angle bracket.
// Parentheses and square brackets are valid URL characters (and brackets
// delimit IPv6 hosts), so they must not end a match. The scheme length is
// bounded so scanning stays linear.
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'`<>]+/gi
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?"])
const CLOSER_TO_OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" }

/**
 * Applies {@link redactUrlForLog} to every URL found in free text, such as an
 * error message.
 */
export function redactUrlsInText(text: string): string {
	return text.replace(URL_IN_TEXT, (match) => {
		const end = urlEnd(match)
		return `${redactUrlForLog(match.slice(0, end))}${match.slice(end)}`
	})
}

/**
 * Returns where the URL in `match` ends, excluding trailing sentence
 * punctuation and closing brackets that have no opener inside the URL, as in
 * "(see https://example.com/x)".
 */
function urlEnd(match: string): number {
	const balance: Record<string, number> = { "(": 0, "[": 0, "{": 0 }
	for (const char of match) {
		if (char in balance) {
			balance[char]++
		} else if (char in CLOSER_TO_OPENER) {
			balance[CLOSER_TO_OPENER[char]]--
		}
	}
	let end = match.length
	while (end > 0) {
		const char = match[end - 1]
		const opener = CLOSER_TO_OPENER[char]
		if (opener !== undefined && balance[opener] < 0) {
			balance[opener]++
		} else if (!TRAILING_PUNCTUATION.has(char)) {
			break
		}
		end--
	}
	return end
}
