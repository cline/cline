/**
 * Fixes incorrectly escaped HTML entities in AI model outputs
 * @param text String potentially containing incorrectly escaped HTML entities from AI models
 * @returns String with HTML entities converted back to normal characters
 */
export function fixModelHtmlEscaping(text: string): string {
	return text
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&apos;/g, "'")
}

/**
 * Removes invalid characters (like the replacement character �) from a string
 * @param text String potentially containing invalid characters
 * @returns String with invalid characters removed
 */
export function removeInvalidChars(text: string): string {
	return text.replace(/\uFFFD/g, "")
}

/**
 * Truncates the middle of a string, preserving an equal prefix and suffix.
 * The marker is generated after calculating how many characters are omitted.
 */
export function truncateMiddle(text: string, maxChars: number, makeMarker: (removed: number) => string): string {
	const truncation = getMiddleTruncationParts(text.length, maxChars, makeMarker)
	if (!truncation) {
		return text
	}

	const { prefixChars, suffixChars, marker } = truncation
	return `${text.slice(0, prefixChars)}${marker}${suffixChars > 0 ? text.slice(-suffixChars) : ""}`
}

export interface MiddleTruncationParts {
	prefixChars: number
	suffixChars: number
	marker: string
}

export function getMiddleTruncationParts(
	textLength: number,
	maxChars: number,
	makeMarker: (removed: number) => string,
): MiddleTruncationParts | undefined {
	if (textLength <= maxChars) {
		return undefined
	}

	if (maxChars <= 0) {
		return { prefixChars: 0, suffixChars: 0, marker: "" }
	}

	let keep = Math.max(0, Math.floor(maxChars / 2))

	while (true) {
		const removed = Math.max(0, textLength - keep * 2)
		const marker = makeMarker(removed)
		if (marker.length > maxChars) {
			return { prefixChars: 0, suffixChars: 0, marker: marker.slice(0, maxChars) }
		}

		const nextKeep = Math.max(0, Math.floor((maxChars - marker.length) / 2))
		if (nextKeep === keep) {
			return { prefixChars: keep, suffixChars: keep, marker }
		}
		keep = nextKeep
	}
}
