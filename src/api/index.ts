import { Anthropic } from "@anthropic-ai/sdk"

import type { ProviderSettings, ModelInfo } from "@roo-code/types"

import { ApiStream } from "./transform/stream"

import {
	GlamaHandler,
	AnthropicHandler,
	AwsBedrockHandler,
	CerebrasHandler,
	OpenRouterHandler,
	VertexHandler,
	AnthropicVertexHandler,
	OpenAiHandler,
	LmStudioHandler,
	GeminiHandler,
	OpenAiNativeHandler,
	DeepSeekHandler,
	MoonshotHandler,
	MistralHandler,
	VsCodeLmHandler,
	UnboundHandler,
	RequestyHandler,
	HumanRelayHandler,
	FakeAIHandler,
	XAIHandler,
	GroqHandler,
	HuggingFaceHandler,
	ChutesHandler,
	LiteLLMHandler,
	ClaudeCodeHandler,
	SambaNovaHandler,
	IOIntelligenceHandler,
	DoubaoHandler,
	ZAiHandler,
	FireworksHandler,
	RooHandler,
	FeatherlessHandler,
} from "./providers"
import { NativeOllamaHandler } from "./providers/native-ollama"

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

export interface ApiHandlerCreateMessageMetadata {
	mode?: string
	taskId: string
	previousResponseId?: string
	/**
	 * When true, the provider must NOT fall back to internal continuity state
	 * (e.g., lastResponseId) if previousResponseId is absent.
	 * Used to enforce "skip once" after a condense operation.
	 */
	suppressPreviousResponseId?: boolean
}

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream

	getModel(): { id: string; info: ModelInfo }

	/**
	 * Counts tokens for content blocks
	 * All providers extend BaseProvider which provides a default tiktoken implementation,
	 * but they can override this to use their native token counting endpoints
	 *
	 * @param content The content to count tokens for
	 * @returns A promise resolving to the token count
	 */
	countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number>
}

export function buildApiHandler(configuration: ProviderSettings): ApiHandler {
	const { apiProvider, ...options } = configuration

	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler(options)
		case "claude-code":
			return new ClaudeCodeHandler(options)
		case "glama":
			return new GlamaHandler(options)
		case "openrouter":
			return new OpenRouterHandler(options)
		case "bedrock":
			return new AwsBedrockHandler(options)
		case "vertex":
			return options.apiModelId?.startsWith("claude")
				? new AnthropicVertexHandler(options)
				: new VertexHandler(options)
		case "openai":
			return new OpenAiHandler(options)
		case "ollama":
			return new NativeOllamaHandler(options)
		case "lmstudio":
			return new LmStudioHandler(options)
		case "gemini":
			return new GeminiHandler(options)
		case "openai-native":
			return new OpenAiNativeHandler(options)
		case "deepseek":
			return new DeepSeekHandler(options)
		case "doubao":
			return new DoubaoHandler(options)
		case "moonshot":
			return new MoonshotHandler(options)
		case "vscode-lm":
			return new VsCodeLmHandler(options)
		case "mistral":
			return new MistralHandler(options)
		case "unbound":
			return new UnboundHandler(options)
		case "requesty":
			return new RequestyHandler(options)
		case "human-relay":
			return new HumanRelayHandler()
		case "fake-ai":
			return new FakeAIHandler(options)
		case "xai":
			return new XAIHandler(options)
		case "groq":
			return new GroqHandler(options)
		case "huggingface":
			return new HuggingFaceHandler(options)
		case "chutes":
			return new ChutesHandler(options)
		case "litellm":
			return new LiteLLMHandler(options)
		case "cerebras":
			return new CerebrasHandler(options)
		case "sambanova":
			return new SambaNovaHandler(options)
		case "zai":
			return new ZAiHandler(options)
		case "fireworks":
			return new FireworksHandler(options)
		case "io-intelligence":
			return new IOIntelligenceHandler(options)
		case "roo":
			// Never throw exceptions from provider constructors
			// The provider-proxy server will handle authentication and return appropriate error codes
			return new RooHandler(options)
		case "featherless":
			return new FeatherlessHandler(options)
		default:
			apiProvider satisfies "gemini-cli" | undefined
			return new AnthropicHandler(options)
	}
}
