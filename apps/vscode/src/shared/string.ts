/**
 * Unicode punctuation normalisation helpers
 * Makes patch matching resilient to visually identical but different Unicode code-points
 */
const PUNCT_EQUIV: Record<string, string> = {
	// Hyphen / dash variants
	"-": "-",
	"\u2010": "-", // HYPHEN
	"\u2011": "-", // NO-BREAK HYPHEN
	"\u2012": "-", // FIGURE DASH
	"\u2013": "-", // EN DASH
	"\u2014": "-", // EM DASH
	"\u2212": "-", // MINUS SIGN
	// Double quotes
	"\u0022": '"', // QUOTATION MARK
	"\u201C": '"', // LEFT DOUBLE QUOTATION MARK
	"\u201D": '"', // RIGHT DOUBLE QUOTATION MARK
	"\u201E": '"', // DOUBLE LOW-9 QUOTATION MARK
	"\u00AB": '"', // LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
	"\u00BB": '"', // RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
	// Single quotes
	"\u0027": "'", // APOSTROPHE
	"\u2018": "'", // LEFT SINGLE QUOTATION MARK
	"\u2019": "'", // RIGHT SINGLE QUOTATION MARK
	"\u201B": "'", // SINGLE HIGH-REVERSED-9 QUOTATION MARK
	// Spaces
	"\u00A0": " ", // NO-BREAK SPACE
	"\u202F": " ", // NARROW NO-BREAK SPACE
}

/**
 * Canonicalize a string by normalizing unicode punctuation and quotes
 */
export function canonicalize(s: string): string {
	// First normalize unicode and punctuation
	let normalized = s.normalize("NFC").replace(/./gu, (c) => PUNCT_EQUIV[c] ?? c)

	// Then normalize escaped/unescaped quotes to handle cases where:
	// - patch has ` but file has \`
	// - patch has ' but file has \'
	// - patch has " but file has \"
	normalized = normalized
		.replace(/\\`/g, "`") // \` -> `
		.replace(/\\'/g, "'") // \' -> '
		.replace(/\\"/g, '"') // \" -> "

	return normalized
}

/**
 * Preserve the escaping style from original text when applying new text
 * If original has \`, preserve that style in the replacement
 */
export function preserveEscaping(originalText: string, newText: string): string {
	// Check if original has escaped backticks, quotes, or apostrophes
	const hasEscapedBacktick = originalText.includes("\\`")
	const hasEscapedSingleQuote = originalText.includes("\\'")
	const hasEscapedDoubleQuote = originalText.includes('\\"')

	let result = newText

	// Apply escaping to match original style
	if (hasEscapedBacktick && !newText.includes("\\`")) {
		// Escape backslashes first, then backticks
		result = result.replace(/\\/g, "\\\\").replace(/`/g, "\\`")
	}
	if (hasEscapedSingleQuote && !newText.includes("\\'")) {
		// Escape backslashes first, then single quotes
		result = result.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
	}
	if (hasEscapedDoubleQuote && !newText.includes('\\"')) {
		// Escape backslashes first, then double quotes
		result = result.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
	}

	return result
}
