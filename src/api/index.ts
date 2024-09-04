import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo } from "../shared/api"
import { AnthropicHandler } from "./anthropic"
import { AwsBedrockHandler } from "./bedrock"
import { OpenRouterHandler } from "./openrouter"
import { VertexHandler } from "./vertex"
import { OpenAiHandler } from "./openai"
import { OllamaHandler } from "./ollama"

export interface ApiHandlerMessageResponse {
	message: Anthropic.Messages.Message
	userCredits?: number
}

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<ApiHandlerMessageResponse>

	createUserReadableRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): any

	getModel(): { id: string; info: ModelInfo }
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
		case "vertex":
			return new VertexHandler(options)
		case "openai":
			return new OpenAiHandler(options)
		case "ollama":
			return new OllamaHandler(options)
		default:
			return new AnthropicHandler(options)
	}
}

export function withoutImageData(
	userContent: Array<
		| Anthropic.TextBlockParam
		| Anthropic.ImageBlockParam
		| Anthropic.ToolUseBlockParam
		| Anthropic.ToolResultBlockParam
	>
): Array<
	Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
> {
	return userContent.map((part) => {
		if (part.type === "image") {
			return { ...part, source: { ...part.source, data: "..." } }
		} else if (part.type === "tool_result" && typeof part.content !== "string") {
			return {
				...part,
				content: part.content?.map((contentPart) => {
					if (contentPart.type === "image") {
						return { ...contentPart, source: { ...contentPart.source, data: "..." } }
					}
					return contentPart
				}),
			}
		}
		return part
	})
}
