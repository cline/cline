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
		case "lmstudio":
			return new LmStudioHandler(options)
		case "gemini":
			return new GeminiHandler(options)
		case "openai-native":
			return new OpenAiNativeHandler(options)
		case "deepseek":
			return new DeepSeekHandler(options)
		case "requesty":
			return new RequestyHandler(options)
		case "together":
			return new TogetherHandler(options)
		case "qwen":
			return new QwenHandler(options)
		case "mistral":
			return new MistralHandler(options)
		case "vscode-lm":
			return new VsCodeLmHandler(options)
		case "cline":
			return new ClineHandler(options)
		case "litellm":
			return new LiteLlmHandler(options)
		case "asksage":
			return new AskSageHandler(options)
		case "xai":
			return new XAIHandler(options)
		case "sambanova":
			return new SambanovaHandler(options)
		default:
			return new AnthropicHandler(options)
	}
}
