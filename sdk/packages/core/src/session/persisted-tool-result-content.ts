import type { ToolResultContent } from "@cline/shared";

/**
 * Preserve structured tool output across canonical session persistence and
 * display projections. JSON serialization belongs to the storage/wire boundary;
 * turning objects into text here loses native image and presentation metadata.
 */
export function toPersistedToolResultContent(
	output: unknown,
): ToolResultContent["content"] {
	if (typeof output === "string") {
		return output;
	}
	if (output && typeof output === "object" && !Array.isArray(output)) {
		return output as Record<string, unknown>;
	}
	if (Array.isArray(output)) {
		// Structured local and provider tool outputs are persisted as arrays even
		// when their entries are not media/text blocks (for example Cline
		// ToolOperationResult objects and Anthropic web_search_result objects).
		return output as ToolResultContent["content"];
	}
	// Keep this identical to the canonical AgentMessage codec. Undefined and
	// circular values intentionally retain that codec's existing behavior.
	return JSON.stringify(output) as ToolResultContent["content"];
}
