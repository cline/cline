import type { ModelToolName } from "@cline/shared";

export interface ModelToolSupportInput {
	providerId: string;
	modelId?: string;
}

/**
 * Resolve stable native model-tool support. This intentionally describes
 * provider execution support, not ordinary function/tool calling support.
 */
export function supportsModelTool(
	input: ModelToolSupportInput,
	toolName: ModelToolName,
): boolean {
	if (toolName !== "web_search") {
		return false;
	}

	switch (input.providerId) {
		case "cline":
		case "cline-pass":
		case "anthropic":
		// Native OpenAI is the "openai-native" builtin id. The bare "openai" id
		// aliases to "openai-compatible" (see PROVIDER_ID_ALIASES), whose module
		// has no native web search.
		case "openai-native":
		case "gemini":
			return true;
		case "vertex":
			// Vertex Claude uses the Anthropic provider surface but is created by a
			// separate adapter today; enable this once that adapter exposes tools.
			return !input.modelId?.toLowerCase().includes("claude");
		default:
			return false;
	}
}
