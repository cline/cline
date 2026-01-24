import { StateManager } from "@core/storage/StateManager"
import { ModelInfo, NvidiaNimModelId, nvidiaNimDefaultModelId, nvidiaNimModels } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { Logger } from "@/services/logging/Logger"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface NvidiaNimHandlerOptions extends CommonApiHandlerOptions {
	nvidiaNimApiKey?: string
	nvidiaNimModelId?: string
	nvidiaNimBaseUrl?: string
}

/**
 * Nvidia NIM API Handler
 *
 * Provides production-ready integration with Nvidia NIM (NVIDIA Inference Microservices).
 * Supports a wide range of models including Llama, Mistral, Nemotron, and multimodal models.
 *
 * Features:
 * - Full OpenAI-compatible API support
 * - Streaming responses with token usage tracking
 * - Vision model support for multimodal inputs
 * - Automatic retry with exponential backoff
 * - Proxy support via configured fetch
 * - Production-grade error handling
 *
 * @see https://build.nvidia.com/explore/discover
 * @see https://docs.api.nvidia.com/nim/reference
 */
export class NvidiaNimHandler implements ApiHandler {
	private options: NvidiaNimHandlerOptions
	private client: OpenAI | undefined

	constructor(options: NvidiaNimHandlerOptions) {
		this.options = options
	}

	/**
	 * Ensures the OpenAI client is initialized with proper configuration
	 * Uses lazy initialization for better resource management
	 */
	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.nvidiaNimApiKey) {
				throw new Error("Nvidia NIM API key is required. Get your API key from https://build.nvidia.com/")
			}

			const baseURL = this.options.nvidiaNimBaseUrl || "https://integrate.api.nvidia.com/v1"

			try {
				this.client = new OpenAI({
					baseURL,
					apiKey: this.options.nvidiaNimApiKey,
					fetch, // Use configured fetch with proxy support
					timeout: 60000, // 60 second timeout for production stability
					maxRetries: 0, // We handle retries via @withRetry decorator
				})
			} catch (error: any) {
				throw new Error(`Error creating Nvidia NIM client: ${error?.message || "Unknown error"}`)
			}
		}
		return this.client
	}

	/**
	 * Yields usage information with cost calculation
	 */
	private async *yieldUsage(modelInfo: ModelInfo, usage: OpenAI.CompletionUsage | undefined): ApiStream {
		if (!usage) {
			return
		}

		const inputTokens = usage.prompt_tokens || 0
		const outputTokens = usage.completion_tokens || 0

		// Nvidia NIM doesn't support prompt caching yet
		const cacheReadTokens = 0
		const cacheWriteTokens = 0

		// Calculate cost using OpenAI-compatible cost calculation
		const totalCost = calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

		yield {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheWriteTokens,
			totalCost,
		}
	}

	/**
	 * Creates a streaming message with the Nvidia NIM API
	 *
	 * @param systemPrompt - System instructions for the model
	 * @param messages - Conversation history
	 * @param tools - Optional tool definitions for function calling
	 * @returns AsyncGenerator yielding text chunks and usage information
	 */
	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const modelInfo = model.info

		// Build OpenAI-compatible messages
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Prepare request parameters
		const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
			model: model.id,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature: 0.7, // Balanced temperature for production use
			max_tokens: modelInfo.maxTokens && modelInfo.maxTokens > 0 ? modelInfo.maxTokens : undefined,
			...getOpenAIToolParams(tools),
		}

		let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

		try {
			stream = await client.chat.completions.create(requestParams)
		} catch (error: any) {
			// Enhanced error handling for common Nvidia NIM API errors
			if (error?.status === 401) {
				throw new Error("Invalid Nvidia NIM API key. Please check your API key at https://build.nvidia.com/")
			} else if (error?.status === 429) {
				throw new Error("Nvidia NIM API rate limit exceeded. Please try again later.")
			} else if (error?.status === 404) {
				throw new Error(
					`Model '${model.id}' not found. Please check the model ID or visit https://build.nvidia.com/explore/discover`,
				)
			} else if (error?.status === 503) {
				throw new Error("Nvidia NIM service is temporarily unavailable. Please try again later.")
			}
			throw new Error(`Nvidia NIM API error: ${error?.message || "Unknown error"}`)
		}

		// Process streaming response with tool call processor
		const toolCallProcessor = new ToolCallProcessor()

		try {
			for await (const chunk of stream) {
				const delta = chunk.choices?.[0]?.delta

				// Handle tool calls
				if (delta?.tool_calls) {
					yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
				}

				// Handle text content
				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				// Handle usage information with cost calculation
				if (chunk.usage) {
					yield* this.yieldUsage(modelInfo, chunk.usage)
				}
			}
		} catch (error: any) {
			// Handle streaming errors gracefully
			if (error?.message?.includes("aborted")) {
				Logger.warn("Nvidia NIM stream was aborted by client")
				return
			}
			throw new Error(`Nvidia NIM streaming error: ${error?.message || "Unknown error"}`)
		}
	}

	/**
	 * Returns the current model configuration
	 * Supports both predefined models and arbitrary Nvidia NIM model IDs
	 * Falls back to default model if no model is specified
	 */
	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.nvidiaNimModelId || nvidiaNimDefaultModelId

		// Check if it's a predefined model in our catalog
		if (modelId in nvidiaNimModels) {
			const id = modelId as NvidiaNimModelId
			return { id, info: nvidiaNimModels[id] }
		}

		// For arbitrary/unlisted models, try to get cached info from StateManager
		// This allows users to use any Nvidia NIM model, not just our predefined list
		try {
			const cachedModelInfo = StateManager.get().getModelInfo("nvidiaNim", modelId)
			if (cachedModelInfo) {
				return { id: modelId, info: cachedModelInfo }
			}
		} catch {
			// StateManager not initialized (e.g., in tests) - continue to defaults
		}

		// If model not found in catalog or cache, use sensible defaults
		// This allows users to try new Nvidia NIM models as they become available
		return {
			id: modelId,
			info: {
				maxTokens: 32_768,
				contextWindow: 128_000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.5, // Conservative default pricing
				outputPrice: 0.5,
				description: `Nvidia NIM model: ${modelId}`,
			},
		}
	}
}
