/**
 * Reflection Filter: Improving Response Quality and Privacy
 *
 * This module provides a filtering layer that prevents language models from
 * "reflecting" or echoing back environment details in their responses.
 *
 * Purpose:
 * - Reduces noise and clutter in model responses by removing irrelevant environment details
 * - Improves workflow efficiency by eliminating the need to manually clean up reflected content
 * - Provides modest privacy benefits by filtering out file paths and environment information
 * - Maintains response focus on the actual task rather than contextual details
 *
 * Integration points:
 * - Applied to all API providers in buildApiHandler() (src/api/index.ts)
 * - Works alongside system prompt instructions as a complementary approach
 * - Provider-agnostic implementation that works with all LLM endpoints
 *
 * This module is designed to be:
 * - Efficient: Only processes text chunks, bypassing non-text content
 * - Configurable: Supports different filtering modes (remove or replace)
 * - Maintainable: Pattern-based approach makes it easy to extend with new patterns
 * - Transparent: Provides optional logging of detected reflections
 */
import { ApiStream, ApiStreamChunk, ApiStreamTextChunk } from "./stream"

/**
 * Patterns that may indicate reflection of environment details.
 * These patterns are checked against text chunks to identify
 * potential reflections.
 *
 * The patterns cover:
 * 1. Environment details section headers (e.g., "# VSCode Open Tabs")
 * 2. System information (OS, shell, directories)
 * 3. File and terminal output markers
 * 4. Lists that might be file listings (5+ items)
 *
 * When adding new patterns:
 * - Use case-insensitive patterns (/pattern/i) for better coverage
 * - Balance specificity vs. false positives
 * - Group related patterns with comments for maintainability
 * - Test thoroughly with reflection-filter.test.ts
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
 * Filters an API stream to detect and remove environment detail reflections.
 *
 * This function helps maintain cleaner, more focused responses by:
 * 1. Processes each chunk in the stream
 * 2. For text chunks, checks against REFLECTION_PATTERNS
 * 3. Handles matches according to the specified filtering mode
 * 4. Passes through non-matching chunks unchanged
 *
 * @param stream - The original API stream to be filtered
 * @param options - Configuration options for filtering behavior
 * @param options.logWarnings - Whether to log reflection detections to console (default: true)
 * @param options.filterMode - How to handle reflections: "remove" (skip) or "replace" (with warning) (default: "replace")
 * @returns A filtered stream with reflections handled according to the specified mode
 *
 * @example
 * // Basic usage with default options (replace with warning)
 * const filteredStream = filterReflections(originalStream);
 *
 * @example
 * // Silent removal of reflections
 * const filteredStream = filterReflections(originalStream, {
 *   logWarnings: false,
 *   filterMode: "remove"
 * });
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
						text: "[Note: Some content was filtered to remove environment details]",
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
 * Higher-order function that wraps an API handler's createMessage method
 * with reflection filtering capabilities.
 *
 * This is the primary integration point used in buildApiHandler() to apply
 * reflection filtering to all API providers in a consistent way.
 *
 * The returned function maintains the same signature as the original,
 * making it a drop-in replacement that improves response quality.
 *
 * @param createMessageFn - The original createMessage generator function from an ApiHandler
 * @returns A wrapped function with identical signature that applies reflection filtering
 *
 * @example
 * // In buildApiHandler():
 * const originalCreateMessage = handler.createMessage.bind(handler);
 * handler.createMessage = createMessageWithReflectionFilter(originalCreateMessage);
 */
export function createMessageWithReflectionFilter(
	createMessageFn: (systemPrompt: string, messages: any[]) => ApiStream,
): (systemPrompt: string, messages: any[]) => ApiStream {
	return async function* (systemPrompt: string, messages: any[]): ApiStream {
		const originalStream = createMessageFn(systemPrompt, messages)
		yield* filterReflections(originalStream)
	}
}
