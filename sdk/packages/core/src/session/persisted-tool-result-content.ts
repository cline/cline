import type { ToolResultContent } from "@cline/shared";

/**
 * Preserve the runtime tool-output serialization used by canonical session
 * persistence. This intentionally remains internal to Core because the
 * historical codec accepts a wider runtime value set than the public
 * `ToolResultContent` type describes.
 */
export function toPersistedToolResultContent(
	output: unknown,
): ToolResultContent["content"] {
	if (typeof output === "string") {
		return output;
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
