import type * as LlmsProviders from "@clinebot/llms/providers";
import type { Tool } from "@clinebot/shared";

/**
 * Convert a Tool to the provider-facing definition format.
 */
export function toToolDefinition(tool: Tool): LlmsProviders.ToolDefinition {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema as Record<string, unknown>,
	};
}

/**
 * Convert an array of Tools to provider-facing definitions.
 */
export function toToolDefinitions(
	tools: Tool[],
): LlmsProviders.ToolDefinition[] {
	return tools.map(toToolDefinition);
}
