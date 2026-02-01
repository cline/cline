import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import type { Tool as BedrockTool } from "@aws-sdk/client-bedrock-runtime"

/**
 * Converts Anthropic tool format to AWS Bedrock Converse API format
 *
 * Anthropic format:
 * {
 *   name: "read_file",
 *   description: "Request to read...",
 *   input_schema: { type: "object", properties: {...} }
 * }
 *
 * Bedrock format:
 * {
 *   toolSpec: {
 *     name: "read_file",
 *     description: "Request to read...",
 *     inputSchema: { json: { type: "object", properties: {...} } }
 *   }
 * }
 */
export function convertToBedrockTools(tools?: AnthropicTool[]): BedrockTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined
	}

	return tools.map(
		(tool) =>
			({
				toolSpec: {
					name: tool.name,
					description: tool.description,
					inputSchema: {
						json: tool.input_schema,
					},
				},
			}) as BedrockTool,
	)
}
