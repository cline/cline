import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ModelInfo } from "../shared/api"
import { AnthropicHandler } from "./providers/anthropic"
import { AwsBedrockHandler } from "./providers/bedrock"
import { OpenRouterHandler } from "./providers/openrouter"
import { VertexHandler } from "./providers/vertex"
import { OpenAiHandler } from "./providers/openai"
import { OllamaHandler } from "./providers/ollama"
import { LmStudioHandler } from "./providers/lmstudio"
import { GeminiHandler } from "./providers/gemini"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { ApiStream } from "./transform/stream"

export interface ApiHandler {
	createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
	getModel(): { id: string; info: ModelInfo }
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration
	try {
		// Validate required credentials
		switch (apiProvider) {
			case "anthropic":
				if (!options.apiKey) {
					throw new Error("Anthropic API key is required")
				}
				return new AnthropicHandler(options)
			case "openrouter":
				if (!options.openRouterApiKey) {
					throw new Error("OpenRouter API key is required")
				}
				return new OpenRouterHandler(options)
			case "bedrock":
				if (!options.awsAccessKey || !options.awsSecretKey) {
					throw new Error("AWS credentials are required")
				}
				return new AwsBedrockHandler(options)
			case "vertex":
				if (!options.vertexProjectId) {
					throw new Error("Vertex project ID is required")
				}
				return new VertexHandler(options)
			case "openai":
				if (!options.openAiApiKey) {
					throw new Error("OpenAI API key is required")
				}
				return new OpenAiHandler(options)
			case "ollama":
				return new OllamaHandler(options)
			case "lmstudio":
				return new LmStudioHandler(options)
			case "gemini":
				if (!options.geminiApiKey) {
					throw new Error("Gemini API key is required")
				}
				return new GeminiHandler(options)
			case "openai-native":
				if (!options.openAiNativeApiKey) {
					throw new Error("OpenAI Native API key is required")
				}
				return new OpenAiNativeHandler(options)
			default:
				if (!options.apiKey) {
					throw new Error("API key is required")
				}
				return new AnthropicHandler(options)
		}
	} catch (error) {
		// Add error to configuration so it can be displayed in the UI
		configuration.error = error instanceof Error ? error.message : "Failed to initialize API provider"
		// Re-throw to maintain existing error handling behavior
		throw error
	}
}
