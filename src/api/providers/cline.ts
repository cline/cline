/**
 * Implementation of ApiHandler for Cline's API service.
 * This handler provides access to AI models through Cline's API,
 * using a compatible interface with OpenRouter while providing
 * Cline-specific error handling and usage tracking.
 *
 * @see https://api.cline.bot
 */
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import axios from "axios"
import { OpenRouterErrorResponse } from "./types"

/**
 * Handler for interacting with Cline's API service.
 * Implements the ApiHandler interface with support for:
 * - Streaming response generation
 * - Error handling for Cline's response format
 * - Usage statistics tracking
 * - Reasoning/thinking content processing
 */
export class ClineHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	/** Tracks the most recent generation ID for fetching usage statistics */
	lastGenerationId?: string

	/**
	 * Creates a new ClineHandler instance.
	 * Sets up the OpenAI-compatible client configured for Cline's API.
	 *
	 * @param options - Configuration options including the Cline API key
	 */
	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.cline.bot/v1",
			apiKey: this.options.clineApiKey || "",
		})
	}

	/**
	 * Generates content using Cline's API with streaming response.
	 * Features special error handling for Cline's response format and
	 * tracks generation IDs for later usage statistics retrieval.
	 *
	 * @param systemPrompt - Instructions to guide the model's behavior
	 * @param messages - Array of messages in Anthropic format
	 * @yields Streaming text content, reasoning, and usage information
	 * @throws Error when Cline API returns an error object in the stream
	 */
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		this.lastGenerationId = undefined

		// Use the OpenRouter-compatible stream creation helper
		const stream = await createOpenRouterStream(
			this.client,
			systemPrompt,
			messages,
			this.getModel(),
			this.options.o3MiniReasoningEffort,
			this.options.thinkingBudgetTokens,
		)

		// Process stream chunks
		for await (const chunk of stream) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				console.error(`Cline API Error: ${error?.code} - ${error?.message}`)
				// Include metadata in the error message if available
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`Cline API Error ${error.code}: ${error.message}${metadataStr}`)
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
	 * Makes a direct API call to Cline's generation endpoint
	 * to get token counts and cost information.
	 *
	 * @returns Promise resolving to usage metrics or undefined if retrieval fails
	 */
	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			try {
				const response = await axios.get(`https://api.cline.bot/v1/generation?id=${this.lastGenerationId}`, {
					headers: {
						Authorization: `Bearer ${this.options.clineApiKey}`,
					},
					timeout: 15_000, // this request hangs sometimes
				})

				const generation = response.data
				return {
					type: "usage",
					inputTokens: generation?.native_tokens_prompt || 0,
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				// ignore if fails
				console.error("Error fetching cline generation details:", error)
			}
		}
		return undefined
	}

	/**
	 * Determines which model to use based on configuration or defaults.
	 * Currently uses the same model selection logic as OpenRouter.
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
