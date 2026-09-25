/**
 * Conservative chars-per-token approximation used for compaction triggering
 * and request-size diagnostics. Uses 3 chars/token (slightly over-counts vs
 * the conventional 4) so trigger thresholds fire before provider rejection
 * rather than after.
 */

export const CHARS_PER_TOKEN = 3;

export function estimateTokens(chars: number): number {
	return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

/**
 * Flat per-image token cost used in place of the char-based estimate for an
 * image block's base64 payload. Real vision-model costs depend on pixel
 * dimensions, not encoded byte size, and top out around ~1.6k tokens even
 * for a large image; this sits comfortably above typical per-image cost
 * without scaling with the base64 string length.
 */
export const ESTIMATED_TOKENS_PER_IMAGE = 1_600;

export interface TokenEstimatedRequest {
	systemPrompt?: string;
	messages: readonly unknown[];
	tools?: readonly unknown[];
}

/**
 * Build a JSON.stringify replacer that blanks the `data` field of any
 * `{ type: "image", data: string }` node, wherever it's nested in the
 * serialized value, so an image's base64 payload is never billed at
 * CHARS_PER_TOKEN. Returns the replacer alongside an `imageCount` accessor
 * so the caller can add a flat per-image token cost back in afterwards.
 */
export function createImageAwareReplacer(): {
	replacer: (key: string, value: unknown) => unknown;
	imageCount: () => number;
} {
	let count = 0;
	const replacer = (_key: string, value: unknown): unknown => {
		if (
			value !== null &&
			typeof value === "object" &&
			(value as { type?: unknown }).type === "image" &&
			typeof (value as { data?: unknown }).data === "string"
		) {
			count += 1;
			return { ...(value as Record<string, unknown>), data: "" };
		}
		return value;
	};
	return { replacer, imageCount: () => count };
}

function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	try {
		return (
			JSON.stringify(value, (_key, nestedValue: unknown) => {
				if (typeof nestedValue === "bigint") {
					return nestedValue.toString();
				}
				if (typeof nestedValue !== "object" || nestedValue === null) {
					return nestedValue;
				}
				if (seen.has(nestedValue)) {
					return "[Circular]";
				}
				seen.add(nestedValue);
				return nestedValue;
			}) ?? ""
		);
	} catch {
		return String(value ?? "");
	}
}

/**
 * Estimate the complete provider request payload so request execution and
 * pre-request policies use the same definition of input utilization.
 */
export function estimateRequestInputTokens(
	request: TokenEstimatedRequest,
): number {
	const { replacer, imageCount } = createImageAwareReplacer();
	let serialized: string;
	try {
		serialized = JSON.stringify(
			{
				systemPrompt: request.systemPrompt,
				messages: request.messages,
				tools: request.tools,
			},
			replacer,
		);
	} catch {
		serialized = [
			safeStringify(request.systemPrompt),
			safeStringify(request.messages),
			safeStringify(request.tools),
		].join("\n");
	}
	// Deliberately over-estimate slightly to leave room for provider formatting,
	// tool schema overhead, and tokenizer drift.
	return (
		estimateTokens(serialized.length) +
		imageCount() * ESTIMATED_TOKENS_PER_IMAGE
	);
}
