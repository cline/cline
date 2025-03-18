/**
 * Implementation of ApiHandler for OpenRouter's model marketplace.
 * This handler provides access to multiple AI models through OpenRouter's unified API,
 * supporting a wide range of providers while handling their specific response formats
 * and usage tracking requirements.
 *
 * @see https://openrouter.ai/docs
 */
import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import delay from "delay"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { OpenRouterErrorResponse } from "./types"

/**
 * Handler for interacting with OpenRouter's model marketplace.
 * Implements the ApiHandler interface with support for:
 * - Multiple AI providers through a single API
 * - Custom error handling for OpenRouter's response format
 * - Usage statistics tracking and cost reporting
 * - Enhanced retry behavior for reliability
 */
export class OpenRouterHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	/** Tracks the most recent generation ID for fetching usage statistics */
	lastGenerationId?: string

	/**
	 * Creates a new OpenRouterHandler instance.
	 * Sets up the OpenAI-compatible client configured for OpenRouter's API.
	 *
	 * @param options - Configuration options including the OpenRouter API key and model preferences
	 */
	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: this.options.openRouterApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://cline.bot", // Optional, for including your app on openrouter.ai rankings.
				"X-Title": "Cline", // Optional. Shows in rankings on openrouter.ai.
			},
		})
	}

	/**
	 * Generates content using OpenRouter models with streaming response.
	 * Features special error handling for OpenRouter's response format and
	 * tracks generation IDs for later usage statistics retrieval.
	 *
	 * @param systemPrompt - Instructions to guide the model's behavior
	 * @param messages - Array of messages in Anthropic format
	 * @yields Streaming text content, reasoning, and usage information
	 * @throws Error when OpenRouter returns an error object in the stream
	 */
	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		this.lastGenerationId = undefined

		// Get stream from OpenRouter helper function
		const stream = await createOpenRouterStream(
			this.client,
			systemPrompt,
			messages,
			this.getModel(),
			this.options.o3MiniReasoningEffort,
			this.options.thinkingBudgetTokens,
		)

		// Process stream chunks, handling OpenRouter-specific error format
		for await (const chunk of stream) {
			// OpenRouter returns an error object instead of the OpenAI SDK throwing an error
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				console.error(`OpenRouter API Error: ${error?.code} - ${error?.message}`)
				// Include metadata in the error message if available
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`OpenRouter API Error ${error.code}: ${error.message}${metadataStr}`)
			}

			// Track generation ID for usage statistics
			if (!this.lastGenerationId && chunk.id) {
				this.lastGenerationId = chunk.id
			}

			// Handle text content
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle reasoning content if available
			if ("reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					// @ts-ignore-next-line
					reasoning: delta.reasoning,
				}
			}
		}

		// Fetch and yield usage statistics after stream completion
		const apiStreamUsage = await this.getApiStreamUsage()
		if (apiStreamUsage) {
			yield apiStreamUsage
		}
	}

	/**
	 * Retrieves usage statistics for the most recent generation.
	 * Makes a separate API call to OpenRouter's generation endpoint
	 * to get token counts and cost information.
	 *
	 * @returns Promise resolving to usage metrics or undefined if retrieval fails
	 */
	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			await delay(500) // FIXME: necessary delay to ensure generation endpoint is ready
			try {
				const generationIterator = this.fetchGenerationDetails(this.lastGenerationId)
				const generation = (await generationIterator.next()).value
				// console.log("OpenRouter generation details:", generation)
				return {
					type: "usage",
					// cacheWriteTokens: 0,
					// cacheReadTokens: 0,
					// openrouter generation endpoint fails often
					inputTokens: generation?.native_tokens_prompt || 0,
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				// ignore if fails
				console.error("Error fetching OpenRouter generation details:", error)
			}
		}
		return undefined
	}

	/**
	 * Fetches detailed information about a specific generation.
	 * Uses an aggressive retry strategy due to OpenRouter's endpoint reliability issues.
	 *
	 * @param genId - The generation ID to fetch details for
	 * @yields The generation details data from OpenRouter
	 * @throws Error if the fetch operation fails after multiple retries
	 */
	@withRetry({ maxRetries: 4, baseDelay: 250, maxDelay: 1000, retryAllErrors: true })
	async *fetchGenerationDetails(genId: string) {
		// console.log("Fetching generation details for:", genId)
		try {
			const response = await axios.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.openRouterApiKey}`,
				},
				timeout: 15_000, // this request hangs sometimes
			})
			yield response.data?.data
		} catch (error) {
			// ignore if fails
			console.error("Error fetching OpenRouter generation details:", error)
			throw error
		}
	}

	/**
	 * Determines which OpenRouter model to use based on configuration or defaults.
	 *
	 * @returns Object containing the model ID and associated model information
	 */
	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
