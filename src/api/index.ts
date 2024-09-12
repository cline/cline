import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo } from "../shared/api"
import { AnthropicHandler } from "./anthropic"
import { AwsBedrockHandler } from "./bedrock"
import { OpenRouterHandler } from "./openrouter"
import { VertexHandler } from "./vertex"
import { OpenAiHandler } from "./openai"
import { OllamaHandler } from "./ollama"
import { GeminiHandler } from "./gemini"

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
		case "gemini":
			return new GeminiHandler(options)
		default:
			return new AnthropicHandler(options)
	}
}
