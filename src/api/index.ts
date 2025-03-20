/**
 * API handler system for integrating with multiple LLM providers.
 * This module provides a unified interface for interacting with various AI model providers
 * including Anthropic, OpenAI, Google Gemini, and many others. The system uses a common
 * handler interface to abstract away provider-specific details and provide consistent
 * streaming capabilities.
 */
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
import { ApiStream, ApiStreamUsageChunk } from "./transform/stream"
import { DeepSeekHandler } from "./providers/deepseek"
import { RequestyHandler } from "./providers/requesty"
import { TogetherHandler } from "./providers/together"
import { QwenHandler } from "./providers/qwen"
import { MistralHandler } from "./providers/mistral"
import { VsCodeLmHandler } from "./providers/vscode-lm"
import { ClineHandler } from "./providers/cline"
import { LiteLlmHandler } from "./providers/litellm"
import { AskSageHandler } from "./providers/asksage"
import { XAIHandler } from "./providers/xai"
import { SambanovaHandler } from "./providers/sambanova"
import { createMessageWithReflectionFilter } from "./transform/reflection-filter"

/**
 * Core interface that all LLM API handlers must implement.
 * Defines the standard contract for generating messages and retrieving model information.
 *
 * @interface ApiHandler
 * @property {Function} createMessage - Generates streaming content based on system prompt and messages
 * @property {Function} getModel - Retrieves information about the current model
 * @property {Function} [getApiStreamUsage] - Optional method to fetch usage statistics after generation
 */
export interface ApiHandler {
	createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
	getModel(): { id: string; info: ModelInfo }
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
}

/**
 * Simplified interface for handlers that only support single-turn completions.
 * Used for more basic LLM providers that don't support chat or streaming.
 *
 * @interface SingleCompletionHandler
 * @property {Function} completePrompt - Generates a completion for a single prompt
 */
export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

/**
 * Factory function that builds the appropriate API handler based on configuration.
 * Enables the application to switch between different LLM providers without changing
 * the calling code.
 *
 * Supported providers include:
 * - Anthropic (Claude models)
 * - OpenAI (GPT models)
 * - Google (Gemini models)
 * - AWS Bedrock
 * - Google Vertex AI
 * - Various other providers like Ollama, LM Studio, etc.
 *
 * @param configuration - Configuration object specifying the provider and options
 * @returns An instance of the appropriate ApiHandler implementation
 * @default Returns AnthropicHandler if provider is not specified or recognized
 */
export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration

	// Create the appropriate handler based on the provider
	let handler: ApiHandler
	switch (apiProvider) {
		case "anthropic":
			handler = new AnthropicHandler(options)
			break
		case "openrouter":
			handler = new OpenRouterHandler(options)
			break
		case "bedrock":
			handler = new AwsBedrockHandler(options)
			break
		case "vertex":
			handler = new VertexHandler(options)
			break
		case "openai":
			handler = new OpenAiHandler(options)
			break
		case "ollama":
			handler = new OllamaHandler(options)
			break
		case "lmstudio":
			handler = new LmStudioHandler(options)
			break
		case "gemini":
			handler = new GeminiHandler(options)
			break
		case "openai-native":
			handler = new OpenAiNativeHandler(options)
			break
		case "deepseek":
			handler = new DeepSeekHandler(options)
			break
		case "requesty":
			handler = new RequestyHandler(options)
			break
		case "together":
			handler = new TogetherHandler(options)
			break
		case "qwen":
			handler = new QwenHandler(options)
			break
		case "mistral":
			handler = new MistralHandler(options)
			break
		case "vscode-lm":
			handler = new VsCodeLmHandler(options)
			break
		case "cline":
			handler = new ClineHandler(options)
			break
		case "litellm":
			handler = new LiteLlmHandler(options)
			break
		case "asksage":
			handler = new AskSageHandler(options)
			break
		case "xai":
			handler = new XAIHandler(options)
			break
		case "sambanova":
			handler = new SambanovaHandler(options)
			break
		default:
			handler = new AnthropicHandler(options)
	}

	// Wrap the handler's createMessage method with reflection filtering
	const originalCreateMessage = handler.createMessage.bind(handler)
	handler.createMessage = createMessageWithReflectionFilter(originalCreateMessage)

	return handler
}
