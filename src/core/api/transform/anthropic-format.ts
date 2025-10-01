import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index.mjs"
import { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions.mjs"

/**
 * Converts an OpenAI ChatCompletionTool into an Anthropic Tool definition
 */
export function openAIToolToAnthropic(openAITool: OpenAITool): AnthropicTool {
	const func = openAITool.function

	return {
		name: func.name,
		description: func.description || "",
		input_schema: {
			type: "object",
			properties: func.parameters?.properties || {},
			required: func.parameters?.required || [],
		},
	}
}
