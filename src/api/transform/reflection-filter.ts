/**
 * Reflection filter for API responses.
 *
 * This module provides filtering capabilities to detect and prevent the reflection
 * of environment details in model responses. It can be applied to any API stream
 * as a higher-order function.
 */
import { ApiStream, ApiStreamChunk, ApiStreamTextChunk } from "./stream"

/**
 * Patterns that may indicate reflection of environment details.
 * These patterns are checked against text chunks to identify
 * potential reflections.
 */
const REFLECTION_PATTERNS = [
	// Section headers from environment_details
	/# VSCode (Open Tabs|Visible Files)/i,
	/<environment_details>/i,
	/# Current (Time|Mode|Working Directory)/i,
	/# System Information/i,
	/# Actively Running Terminals/i,

	// System information patterns
	/Operating System: [^\n]+/i,
	/Default Shell: [^\n]+/i,
	/Home Directory: [^\n]+/i,
	/Current Working Directory: [^\n]+/i,

	// File/terminal related patterns
	/final_file_content/i,
	/```terminal output/i,

	// Extended match for large blocks of file lists or terminal output
	/((\n\s*-\s+[^\n]+){5,})/i, // Sequences of list items that might be file listings
]

/**
 * Wraps an API stream with reflection filtering.
 * This function processes each text chunk in the stream,
 * checking for patterns that might indicate reflection of environment details.
 *
 * @param stream - The original API stream
 * @param options - Optional configuration for the filter
 * @returns A filtered API stream
 */
export async function* filterReflections(
	stream: ApiStream,
	options: {
		logWarnings?: boolean // Whether to log warnings when reflections are detected
		filterMode?: "remove" | "replace" // How to handle detected reflections
	} = {},
): ApiStream {
	const { logWarnings = true, filterMode = "replace" } = options

	for await (const chunk of stream) {
		// Only process text chunks
		if (chunk.type === "text") {
			// Check for reflection patterns
			const reflectionMatches = REFLECTION_PATTERNS.map((pattern) => {
				const match = chunk.text.match(pattern)
				return match ? { pattern, match } : null
			}).filter(Boolean)

			if (reflectionMatches.length > 0) {
				if (logWarnings) {
					console.warn(
						`Potential reflection detected in model response. ` +
							`Matched patterns: ${reflectionMatches.map((m) => m?.pattern.toString()).join(", ")}`,
					)
				}

				if (filterMode === "remove") {
					// Skip this chunk entirely
					continue
				} else {
					// Replace with a warning message
					yield {
						type: "text",
						text: "[Note: Some content was filtered to prevent reflection of environment details]",
					} as ApiStreamTextChunk
					continue
				}
			}
		}

		// Pass through non-text chunks or chunks without reflections
		yield chunk
	}
}

/**
 * Creates a wrapped version of an ApiHandler that applies reflection filtering
 * to all responses. This function can be used to create a provider-agnostic
 * solution for preventing reflections.
 *
 * @param createMessageFn - The original createMessage function from an ApiHandler
 * @returns A wrapped function that applies reflection filtering
 */
export function createMessageWithReflectionFilter(
	createMessageFn: (systemPrompt: string, messages: any[]) => ApiStream,
): (systemPrompt: string, messages: any[]) => ApiStream {
	return async function* (systemPrompt: string, messages: any[]): ApiStream {
		const originalStream = createMessageFn(systemPrompt, messages)
		yield* filterReflections(originalStream)
	}
}
