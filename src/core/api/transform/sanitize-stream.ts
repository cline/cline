import { ApiStream } from "./stream"

/**
 * Applies lightweight, provider-agnostic stream sanitization.
 *
 * Goals:
 * - Drop empty text chunks (""), which can cause redundant UI updates.
 * - Drop empty reasoning chunks (""), which similarly add noise.
 *
 * Notes:
 * - We intentionally do NOT trim whitespace-only text globally because some
 *   providers can stream meaningful spacing/newlines as separate chunks.
 * - We intentionally do NOT sanitize tool_calls here because several providers
 *   rely on partial tool-call sequencing semantics.
 */
export async function* sanitizeApiStream(source: ApiStream): ApiStream {
	for await (const chunk of source) {
		if (chunk.type === "text") {
			if (typeof chunk.text !== "string" || chunk.text.length === 0) {
				continue
			}
			yield chunk
			continue
		}

		if (chunk.type === "reasoning") {
			if (typeof chunk.reasoning !== "string" || chunk.reasoning.length === 0) {
				continue
			}
			yield chunk
			continue
		}

		yield chunk
	}
}
