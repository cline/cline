import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo } from "../shared/api"
import { AnthropicHandler } from "./providers/anthropic"
import { AwsBedrockHandler } from "./providers/bedrock"
import { OpenRouterHandler } from "./providers/openrouter"
import { VertexHandler } from "./providers/vertex"
import { OpenAiHandler } from "./providers/openai"
import { OllamaHandler } from "./providers/ollama"
import { GeminiHandler } from "./providers/gemini"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { ApiStream } from "./transform/stream"
import { GithHubCopilotHandler } from "./providers/github-copilot"

export interface ApiHandler {
	createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
	getModel(): { id: string; info: ModelInfo }
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration
	return new GithHubCopilotHandler({
		...options,
		githubCopilotModelId: "gpt-4o",
	})
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
		case "openai-native":
			return new OpenAiNativeHandler(options)
		default:
			return new AnthropicHandler(options)
	}
}
