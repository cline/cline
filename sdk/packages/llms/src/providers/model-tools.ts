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
		case "openai":
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
