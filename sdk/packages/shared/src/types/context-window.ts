/**
 * Error-message sub-strings that indicate a request exceeded the model's hard
 * context / input-token limit. Used to force a compaction-and-retry when the
 * provider rejects a request because the conversation is too large (see #9660).
 *
 * Matched against the lowercased error message. Kept deliberately specific to
 * context / token-limit overflow so unrelated 4xx errors (auth, invalid
 * request, rate limit) never trigger a needless compaction.
 */
export const CONTEXT_WINDOW_ERROR_PATTERNS = [
	"prompt is too long", // Anthropic: "prompt is too long: 228307 tokens > 200000 maximum"
	"input is too long", // Anthropic variant
	"context length", // OpenAI: "maximum context length is ..."
	"context window", // generic
	"maximum context", // generic
	"context_length_exceeded", // OpenAI error code
	"too many tokens", // generic
	"reduce the length of the messages", // OpenAI tail
	"maximum number of tokens", // Gemini: "... exceeds the maximum number of tokens allowed"
] as const;

/**
 * The "<count> tokens > <limit> maximum" shape (Anthropic / Bedrock). Requires
 * both a token count and a comparison to a maximum, so it will not fire on
 * generic messages that merely contain the word "tokens".
 */
const TOKENS_OVER_MAXIMUM_PATTERN =
	/\btokens?\b[^.]*?(?:>|exceeds?|greater than)\s*[\d,]+\s*(?:tokens?\s*)?(?:maximum|max\b|limit)/;

/**
 * Returns `true` when `error` looks like a context-window / token-limit
 * overflow — i.e. the conversation is too large for the model's hard limit and
 * must be compacted before the request can succeed. Operates on the error
 * message string (the SDK surfaces provider errors as strings).
 */
export function isContextWindowExceededError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	const normalized = message.toLowerCase();
	if (normalized.length === 0) {
		return false;
	}
	if (
		CONTEXT_WINDOW_ERROR_PATTERNS.some((pattern) =>
			normalized.includes(pattern),
		)
	) {
		return true;
	}
	return TOKENS_OVER_MAXIMUM_PATTERN.test(normalized);
}

/**
 * Attempts to parse the model's real hard token limit out of a context-overflow
 * error message, e.g. "prompt is too long: 228307 tokens > 200000 maximum"
 * yields `200000`. Returns `undefined` when no limit can be read.
 *
 * This lets recovery target a compaction under the provider's *actual* limit
 * even when the user configured a too-high context window (the #9660 case).
 */
export function parseContextWindowLimitFromError(
	error: unknown,
): number | undefined {
	const message = error instanceof Error ? error.message : String(error ?? "");
	const match = message
		.toLowerCase()
		.match(
			/(?:>|exceeds?|greater than)\s*([\d,]+)\s*(?:tokens?\s*)?(?:maximum|max\b|limit)/,
		);
	if (!match?.[1]) {
		return undefined;
	}
	const limit = Number.parseInt(match[1].replace(/,/g, ""), 10);
	return Number.isFinite(limit) && limit > 0 ? limit : undefined;
}
