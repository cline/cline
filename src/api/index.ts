import { Anthropic } from "@anthropic-ai/sdk"

import { ProviderSettings, ModelInfo } from "../shared/api"
import { GlamaHandler } from "./providers/glama"
import { AnthropicHandler } from "./providers/anthropic"
import { AwsBedrockHandler } from "./providers/bedrock"
import { OpenRouterHandler } from "./providers/openrouter"
import { VertexHandler } from "./providers/vertex"
import { AnthropicVertexHandler } from "./providers/anthropic-vertex"
import { OpenAiHandler } from "./providers/openai"
import { OllamaHandler } from "./providers/ollama"
import { LmStudioHandler } from "./providers/lmstudio"
import { GeminiHandler } from "./providers/gemini"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { DeepSeekHandler } from "./providers/deepseek"
import { MistralHandler } from "./providers/mistral"
import { VsCodeLmHandler } from "./providers/vscode-lm"
import { ApiStream } from "./transform/stream"
import { UnboundHandler } from "./providers/unbound"
import { RequestyHandler } from "./providers/requesty"
import { HumanRelayHandler } from "./providers/human-relay"
import { FakeAIHandler } from "./providers/fake-ai"
import { XAIHandler } from "./providers/xai"
import { GroqHandler } from "./providers/groq"
import { ChutesHandler } from "./providers/chutes"
import { LiteLLMHandler } from "./providers/litellm"

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

export interface ApiHandlerCreateMessageMetadata {
	mode?: string
	taskId: string
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
		case "glama":
			return new GlamaHandler(options)
		case "openrouter":
			return new OpenRouterHandler(options)
		case "bedrock":
			return new AwsBedrockHandler(options)
		case "vertex":
			if (options.apiModelId?.startsWith("claude")) {
				return new AnthropicVertexHandler(options)
			} else {
				return new VertexHandler(options)
			}
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
		case "chutes":
			return new ChutesHandler(options)
		case "litellm":
			return new LiteLLMHandler(options)
		default:
			return new AnthropicHandler(options)
	}
}
