import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration } from "../shared/api"
import { AnthropicHandler } from "./anthropic"
import { AwsBedrockHandler } from "./bedrock"
import { OpenRouterHandler } from "./openrouter"

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<Anthropic.Messages.Message>

	createUserReadableRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): any
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration
	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler(options)
		case "openrouter":
			return new OpenRouterHandler(options)
		case "bedrock":
			return new AwsBedrockHandler(options)
		default:
			throw new Error(`Unknown API provider: ${apiProvider}`)
	}
}
