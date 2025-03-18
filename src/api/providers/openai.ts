/**
 * Implementation of ApiHandler for OpenAI-compatible models.
 * This handler provides a unified interface for both OpenAI and Azure OpenAI endpoints,
 * with specialized handling for different model variants (like o3-mini and Deepseek).
 */
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import { withRetry } from "../retry"
import { ApiHandlerOptions, azureOpenAiDefaultApiVersion, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { ChatCompletionReasoningEffort } from "openai/resources/chat/completions.mjs"

/**
 * Handler for interacting with OpenAI and OpenAI-compatible APIs.
 * Implements the ApiHandler interface with support for:
 * - Standard OpenAI models
 * - Azure OpenAI deployments
 * - Special model variants (Deepseek Reasoner, o3-mini)
 * - Explicit reasoning capabilities where supported
 */
export class OpenAiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	/**
	 * Creates a new OpenAiHandler instance.
	 * Automatically detects if Azure OpenAI is being used based on the base URL
	 * and configures the appropriate client.
	 *
	 * @param options - Configuration options including API keys, base URLs, and model IDs
	 */
	constructor(options: ApiHandlerOptions) {
		this.options = options
		// Azure API shape slightly differs from the core API shape: https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
		if (this.options.openAiBaseUrl?.toLowerCase().includes("azure.com")) {
			this.client = new AzureOpenAI({
				baseURL: this.options.openAiBaseUrl,
				apiKey: this.options.openAiApiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
			})
		} else {
			this.client = new OpenAI({
				baseURL: this.options.openAiBaseUrl,
				apiKey: this.options.openAiApiKey,
			})
		}
	}

	/**
	 * Generates content using OpenAI models with streaming response.
	 * Supports specialized handling for different model types:
	 * - Standard OpenAI/Azure OpenAI models
	 * - Deepseek Reasoner models (using R1 format)
	 * - o3-mini models (using developer role and reasoning effort)
	 *
	 * @param systemPrompt - Instructions to guide the model's behavior
	 * @param messages - Array of messages in Anthropic format (converted to OpenAI format)
	 * @yields Streaming text content, reasoning, and usage information
	 */
	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.options.openAiModelId ?? ""
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")
		const isO3Mini = modelId.includes("o3-mini")

		// Default message preparation
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		let temperature: number | undefined = this.options.openAiModelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
		let reasoningEffort: ChatCompletionReasoningEffort | undefined = undefined

		// Special handling for Deepseek Reasoner models
		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		// Special handling for o3-mini models
		if (isO3Mini) {
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
			temperature = undefined // does not support temperature
			reasoningEffort = (this.options.o3MiniReasoningEffort as ChatCompletionReasoningEffort) || "medium"
		}

		// Create streaming completion request
		const stream = await this.client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			reasoning_effort: reasoningEffort,
			stream: true,
			stream_options: { include_usage: true },
		})

		// Process the event stream
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			// Handle text content
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle reasoning content (for models that support it)
			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			// Handle usage information
			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	/**
	 * Retrieves the model configuration for the current OpenAI model.
	 * Uses the model ID from options or falls back to defaults.
	 *
	 * @returns Object containing the model ID and associated model information
	 */
	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: this.options.openAiModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}
